import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type MaskingArea, workbenchSchema } from "@vera/shared";
import { afterEach, expect, it } from "vitest";
import {
  ContextPolicy,
  createMaskingResolver,
  openDb,
  type SessionHost,
  SessionService,
  ToolRegistry,
} from "../index.js";
import type { LlmRequest } from "../llm/gateway.js";
import { ReplayGateway } from "../llm/replay.js";
import { readTool } from "../tools/read.js";

const secret = "fixture-mqtt-private-password-283";
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});
async function setup(agent: boolean, exports: boolean, artifact = false, value = secret) {
  const root = await mkdtemp(join(tmpdir(), "vera-mask04-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".vera"));
  await mkdir(join(root, "scripts"));
  await writeFile(join(root, "input.txt"), `password=${value}`);
  await writeFile(
    join(root, "scripts/mask.jsonl"),
    [
      {
        toolCalls: [
          {
            name: artifact ? "artifact_save" : "read",
            args: artifact
              ? { name: "report.txt", content: value, description: value }
              : { path: "input.txt" },
          },
        ],
      },
      { text: `Result ${value} tail` },
    ]
      .map((step) => JSON.stringify(step))
      .join("\n"),
  );
  const handle = await openDb(join(root, ".vera/vera.db"), {
    workbenchId: "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C",
    appVersion: "0",
  });
  cleanups.push(async () => handle.close());
  const replay = new ReplayGateway({ dir: join(root, "scripts"), now: () => 0 });
  const app = { privacy: { mask: { agent, exports } } };
  let config = workbenchSchema.parse({ format: 1, id: "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C", name: "Mask" });
  const resolve = createMaskingResolver(() => app);
  const requests: LlmRequest[] = [];
  const host: SessionHost = {
    root,
    db: handle.db,
    clock: { now: () => new Date(), sleep: async () => {} },
    model: () => "replay/mask",
    prompt: () => "Test",
    scrub: (s) => s.replaceAll(value, "[REDACTED]"),
    gateway: {
      selectedModel: (p) => replay.selectedModel(p),
      capabilities: (m, o) => replay.capabilities(m, o),
      models: (p, s) => replay.models(p, s),
      stream: async function* (request) {
        requests.push({ ...request, messages: structuredClone(request.messages) });
        yield* replay.stream(request);
      },
    },
  };
  Object.assign(host, {
    masking: (area: MaskingArea) => resolve(config, area),
    knownSecrets: () => [value],
  });
  const service = new SessionService(host);
  cleanups.push(() => service.close());
  await service.waitReady();
  return {
    service,
    root,
    requests,
    app,
    host,
    override: (value: "default" | "on" | "off") => {
      config = workbenchSchema.parse({ ...config, privacy: { mask: { agent: value } } });
    },
  };
}

it.each([true, false])("sends the real read result to the fake provider using agent=%s", async (agent) => {
  const f = await setup(agent, !agent);
  const id = f.service.create().id;
  f.service.send(id, "Read input");
  expect(await f.service.waitIdle(id)).toEqual({ stopReason: "end" });
  const result = f.requests.at(-1)?.messages.find((m) => m.role === "toolResult");
  expect(JSON.stringify(result)).toContain(agent ? "[REDACTED]" : secret);
  if (agent) expect(JSON.stringify(result)).not.toContain(secret);
  const text = f.service
    .get(id)
    .snapshot.items.filter((i) => i.kind === "assistant")
    .at(-1);
  expect(JSON.stringify(text)).toContain(agent ? "[REDACTED]" : secret);
});

it.each([true, false])("stores artifact bytes using exports=%s independently of agent", async (exports) => {
  const f = await setup(!exports, exports, true);
  const id = f.service.create().id;
  f.service.send(id, "Save artifact");
  expect(await f.service.waitIdle(id)).toEqual({ stopReason: "end" });
  const artifact = f.service.listArtifacts(id)[0];
  expect(artifact).toBeDefined();
  expect(await readFile(join(f.root, ".vera/artifacts", id, "report.txt"), "utf8")).toBe(
    exports ? "[REDACTED]" : secret,
  );
  expect(artifact?.description).toBe(exports ? "[REDACTED]" : secret);
});

it("searches retained history with live inheritance and overrides, isolated per workbench", async () => {
  const a = await setup(false, true),
    b = await setup(true, false);
  const id = a.service.create().id;
  a.service.send(id, "Read input");
  await a.service.waitIdle(id);
  expect(a.service.search(secret).map((s) => s.id)).toEqual([id]);
  a.app.privacy.mask.agent = true;
  expect(a.service.search(secret)).toEqual([]);
  a.override("off");
  expect(a.service.search(secret).map((s) => s.id)).toEqual([id]);
  expect(b.service.search(secret)).toEqual([]);
  a.override("on");
  a.app.privacy.mask.agent = false;
  expect(a.service.search(secret)).toEqual([]);
});

it.each([true, false])(
  "resolves agent policy at async tool publication after initial=%s",
  async (initial) => {
    const f = await setup(initial, !initial);
    let release = () => {},
      entered = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    f.host.registry = new ToolRegistry([
      {
        ...readTool,
        execute: async (ctx, args, signal) => {
          const result = await readTool.execute(ctx, args, signal);
          entered();
          await held;
          return result;
        },
        publish: (_ctx, _args, result) => {
          expect(result).toContain(secret);
          return result;
        },
      },
    ]);
    const id = f.service.create().id;
    f.service.send(id, "Read input");
    await started;
    f.app.privacy.mask.agent = !initial;
    release();
    await f.service.waitIdle(id);
    const result = f.requests.at(-1)?.messages.find((m) => m.role === "toolResult");
    expect(JSON.stringify(result)).toContain(initial ? secret : "[REDACTED]");
  },
);

it("masks a raw artifact export when read by the agent and reprojects retained raw history", async () => {
  const f = await setup(false, false, true);
  const id = f.service.create().id;
  f.service.send(id, "Save artifact");
  await f.service.waitIdle(id);
  const artifact = f.service.listArtifacts(id)[0];
  const raw = await f.service.openArtifact(artifact?.artifactId ?? "");
  expect(raw.content).toBe(secret);
  await writeFile(join(f.root, "input.txt"), raw.content);
  await writeFile(
    join(f.root, "scripts/mask.jsonl"),
    [{ toolCalls: [{ name: "read", args: { path: "input.txt" } }] }, { text: "Read" }]
      .map((step) => JSON.stringify(step))
      .join("\n"),
  );
  f.app.privacy.mask.agent = true;
  f.service.send(id, "Read exported artifact");
  await f.service.waitIdle(id);
  const request = f.requests.at(-1);
  expect(JSON.stringify(request?.messages)).not.toContain(secret);
  expect(JSON.stringify(request?.messages)).toContain("[REDACTED]");
  expect((await f.service.openArtifact(artifact?.artifactId ?? "")).content).toBe(secret);
});

it("budgets actual masked historical and compaction requests after a short-secret off-to-on change", async () => {
  const f = await setup(false, false, false, "q");
  f.host.registry = new ToolRegistry([readTool]);
  await writeFile(join(f.root, "input.txt"), "safe");
  const id = f.service.create().id;
  for (let turn = 0; turn < 2; turn++) {
    f.service.send(id, `${"q".repeat(500)} ${turn}`);
    expect(await f.service.waitIdle(id)).toEqual({ stopReason: "end" });
  }
  const before = f.requests.length;
  f.host.gateway.capabilities = () => ({
    contextWindow: 10000,
    maxOutputTokens: 1000,
    safetyMargin: 1024,
    input: ["text" as const],
    inputBudget: 7976,
    supportsTools: true,
  });
  f.app.privacy.mask.agent = true;
  f.service.send(id, "Read again");
  await f.service.waitIdle(id);
  const sent = f.requests.slice(before);
  expect(sent.length).toBeGreaterThan(0);
  for (const request of sent)
    expect(new ContextPolicy().prepare(request, f.host.gateway.capabilities(request.model), false).fits).toBe(
      true,
    );
  expect(sent.some((request) => request.tools.length === 0)).toBe(true);
});

it("rechecks masking expansion after async durable publication before provider dispatch", async () => {
  const f = await setup(false, false, false, "q");
  f.host.registry = new ToolRegistry([readTool]);
  f.host.gateway.capabilities = () => ({
    contextWindow: 6000,
    maxOutputTokens: 1000,
    safetyMargin: 1024,
    input: ["text" as const],
    inputBudget: 3976,
    supportsTools: true,
  });
  const id = f.service.create().id;
  f.service.subscribe(id, 0, (_seq, event) => {
    if (event.type === "usage.updated" && event.contextTokens) f.app.privacy.mask.agent = true;
  });
  f.service.send(id, "q".repeat(1000));
  expect(await f.service.waitIdle(id)).toEqual({ stopReason: "limit" });
  expect(f.requests).toHaveLength(0);
});

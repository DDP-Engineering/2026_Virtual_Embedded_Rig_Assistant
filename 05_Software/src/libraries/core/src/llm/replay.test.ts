import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Message } from "@earendil-works/pi-ai";
import { afterEach, beforeAll, expect, it } from "vitest";
import { testConnection } from "./connection.js";
import type { LlmEvent, LlmGateway } from "./gateway.js";

let ReplayGateway: typeof import("./replay.js")["ReplayGateway"];
beforeAll(async () => {
  expect(existsSync(new URL("./replay.ts", import.meta.url)), "scripted model gateway exists").toBe(true);
  ({ ReplayGateway } = await import("./replay.js"));
});
let dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
  dirs = [];
});
async function fixture(text: string) {
  const dir = await mkdtemp(join(tmpdir(), "vera-replay-"));
  dirs.push(dir);
  await writeFile(join(dir, "echo.jsonl"), text);
  return dir;
}
async function stream(
  gateway: LlmGateway,
  messages: Message[],
  model = "replay/echo",
  signal = new AbortController().signal,
) {
  const out: LlmEvent[] = [];
  for await (const e of gateway.stream({ model, system: "s", messages, tools: [], signal })) out.push(e);
  return out;
}
it("preserves declared replay token usage and rejects invalid fixture measurements", async () => {
  const dir = await fixture(JSON.stringify({ text: "Done", usage: { input: 100, output: 12 } }));
  const events = await stream(new ReplayGateway({ dir, now: () => 0 }), []);
  expect(events.find((event) => event.type === "done")).toMatchObject({
    message: { usage: { input: 100, output: 12, totalTokens: 112 } },
  });
  await writeFile(join(dir, "echo.jsonl"), JSON.stringify({ text: "Done", usage: { input: -1, output: 2 } }));
  await expect(new ReplayGateway({ dir, now: () => 0 }).models("replay")).rejects.toThrow();
});
it("passes every connection step for scripted tools and fails tools for text-only model", async () => {
  const dir = await fixture(
    `${JSON.stringify({
      match: "(?i)echo",
      text: "OK ".repeat(40),
      toolCalls: [{ name: "echo", args: { text: "OK" } }],
    })}\n`,
  );
  const gateway = new ReplayGateway({ dir, now: () => 0 });
  expect(
    (await testConnection(gateway, "replay", "echo", undefined, () => 0)).steps.map((s) => s.status),
  ).toEqual(["pass", "pass", "pass", "pass"]);
  await writeFile(join(dir, "echo.jsonl"), `${JSON.stringify({ text: "OK ".repeat(40) })}\n`);
  expect(
    (await testConnection(gateway, "replay", "echo", undefined, () => 0)).steps.find(
      (s) => s.step === "tools",
    )?.status,
  ).toBe("fail");
});
it("fails tool support when echo arguments violate the offered strict schema", async () => {
  const dir = await fixture(
    `${JSON.stringify({ text: "OK ".repeat(40), toolCalls: [{ name: "echo", args: { text: "OK", extra: true } }] })}\n`,
  );
  const gateway = new ReplayGateway({ dir, now: () => 0 });
  const result = await testConnection(gateway, "replay", "echo", undefined, () => 0);
  expect(result.steps.find((s) => s.step === "tools")?.status).toBe("fail");
  expect(result.steps.find((s) => s.step === "authentication")?.status).toBe("pass");
});
it("derives steps statelessly, selects by match, substitutes successful artifact results and aborts", async () => {
  const dir = await fixture(
    JSON.stringify({
      match: "(?i)echo",
      prompt: "Echo",
      toolCalls: [{ name: "artifact_save", args: { name: "report" } }],
    }) +
      "\n" +
      JSON.stringify({ text: "See {{artifact:report}}." }) +
      "\n",
  );
  const gateway = new ReplayGateway({ dir, now: () => 0 });
  const messages: Message[] = [{ role: "user", content: "ECHO", timestamp: 0 }];
  const a = await stream(gateway, messages, "replay/auto"),
    b = await stream(gateway, messages, "replay/auto");
  expect(a).toEqual(b);
  const done = a.find((e) => e.type === "done");
  if (done?.type !== "done") throw Error("done");
  const result: Message = {
    role: "toolResult",
    toolCallId: "x",
    toolName: "artifact_save",
    content: [{ type: "text", text: JSON.stringify({ name: "report", ref: "artifact:report" }) }],
    isError: false,
    timestamp: 0,
  };
  const next = await stream(gateway, [...messages, done.message, result]);
  expect(
    next
      .filter((e) => e.type === "text")
      .map((e) => (e.type === "text" ? e.delta : ""))
      .join(""),
  ).toBe("See artifact:report.");
  expect(
    (await stream(gateway, [{ role: "user", content: "missing", timestamp: 0 }], "replay/auto")).at(-1),
  ).toMatchObject({ type: "error", error: { code: "NOT_FOUND" } });
  const abort = new AbortController();
  abort.abort();
  expect(await stream(gateway, messages, "replay/echo", abort.signal)).toMatchObject([
    { type: "error", aborted: true },
  ]);
});

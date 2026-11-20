// REQ-DATA-22f13161
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { ReplayGateway } from "../llm/replay.js";
import { openDb } from "../storage/db.js";
import { type SessionHost, SessionService } from "./service.js";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

it("records the send time of sent and queued prompts, keeps it across restart and adds nothing to the model request", async () => {
  const root = await mkdtemp(join(tmpdir(), "vera-prompt-time-"));
  await mkdir(join(root, ".vera"));
  await writeFile(join(root, "board.txt"), "Board uses 3.3 V.\n");
  const path = join(root, ".vera/vera.db");
  const options = { workbenchId: "wb_test", appVersion: "0" };
  let storage = await openDb(path, options);
  const gateway = new ReplayGateway({ dir: resolve("tests/fixtures/llm-scripts"), now: () => 123 });
  let now = 1_763_657_640_000;
  const host: SessionHost = {
    root,
    db: storage.db,
    gateway,
    clock: { now: () => new Date(now), sleep: async () => {} },
    model: () => "replay/read-then-answer",
    prompt: () => "test",
  };
  let service = new SessionService(host);
  await service.waitReady();
  cleanup.push(async () => {
    await service.close();
    storage.close();
    await rm(root, { recursive: true, force: true });
  });
  const id = service.create().id;
  const original = gateway.stream.bind(gateway);
  const stream = vi.spyOn(gateway, "stream");
  let release!: () => void, started!: () => void;
  const held = new Promise<void>((r) => {
    release = r;
  });
  const ready = new Promise<void>((r) => {
    started = r;
  });
  stream.mockImplementationOnce(async function* (request) {
    started();
    await held;
    yield* original(request);
  });
  const sent = service.send(id, "Read the board");
  await ready;
  now += 60_000;
  const queued = service.send(id, "Next");
  now += 60_000;
  release();
  await service.waitIdle(id);
  const times = () =>
    Object.fromEntries(
      service
        .get(id)
        .snapshot.items.filter((item) => item.kind === "user")
        .map((item) => [item.id, item.timestamp]),
    );
  expect(times()).toEqual({
    [sent.messageId]: 1_763_657_640_000,
    [queued.messageId]: 1_763_657_700_000,
  });
  const event = service
    .exportSession(id)
    .events.map((row) => row.event)
    .find((e) => e.type === "message.user" && e.messageId === sent.messageId);
  expect(event).toMatchObject({ timestamp: 1_763_657_640_000 });
  // The prompt the model receives is the user's text only.
  const first = stream.mock.calls[0]?.[0].messages.at(-1);
  expect(first?.role).toBe("user");
  const content = first?.role === "user" ? first.content : undefined;
  const text =
    typeof content === "string" ? content : content?.map((part) => ("text" in part ? part.text : ""));
  expect([text].flat().join("")).toBe("Read the board");

  await service.close();
  storage.close();
  storage = await openDb(path, options);
  host.db = storage.db;
  service = new SessionService(host);
  await service.waitReady();
  expect(times()).toEqual({
    [sent.messageId]: 1_763_657_640_000,
    [queued.messageId]: 1_763_657_700_000,
  });
});

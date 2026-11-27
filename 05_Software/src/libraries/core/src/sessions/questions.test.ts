import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PermissionMode } from "@vera/shared";
import { afterEach, expect, it, vi } from "vitest";
import { openDb, type SessionHost, SessionService } from "../index.js";
import { ReplayGateway } from "../llm/replay.js";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  try {
    for (const close of cleanup.splice(0).reverse()) await close();
  } finally {
    vi.useRealTimers();
  }
});

async function setup(
  recommended: unknown = 2,
  timeout: number | null = 1,
  write = false,
  aboutPlan = false,
  hasPlan = aboutPlan,
) {
  const root = await mkdtemp(join(tmpdir(), "vera-question-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".vera"));
  await mkdir(join(root, "scripts"));
  await writeFile(join(root, "target.txt"), "before");
  const replay = [
    ...(hasPlan
      ? [{ toolCalls: [{ name: "todo", args: { items: [{ text: "Inspect board", status: "pending" }] } }] }]
      : []),
    {
      toolCalls: [
        {
          name: "ask_user",
          args: {
            question: "Which profile?",
            choices: ["Quiet", "Fast"],
            recommended,
            ...(aboutPlan && { aboutPlan }),
          },
        },
      ],
    },
    ...(write
      ? [
          { toolCalls: [{ name: "read", args: { path: "target.txt" } }] },
          { toolCalls: [{ name: "write", args: { path: "target.txt", content: "changed" } }] },
        ]
      : []),
    { text: "Model received {{source}}: {{answer}}" },
  ];
  await writeFile(
    join(root, "scripts/question.jsonl"),
    replay.map((step) => JSON.stringify(step)).join("\n"),
  );
  const handle = await openDb(join(root, ".vera/vera.db"), { workbenchId: "wb_test", appVersion: "0" });
  cleanup.push(async () => handle.close());
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(new Date("2026-11-23T12:00:00Z"));
  const live = vi.fn<NonNullable<SessionHost["onLiveActivity"]>>();
  const service = new SessionService({
    root,
    db: handle.db,
    gateway: new ReplayGateway({ dir: join(root, "scripts"), now: Date.now }),
    clock: { now: () => new Date(), sleep: async () => {} },
    model: () => "replay/question",
    prompt: () => "Test",
    questionTimeoutMinutes: () => timeout,
    onLiveActivity: live,
  } as SessionHost);
  cleanup.push(() => service.close());
  await service.waitReady();
  async function ask(mode?: PermissionMode) {
    const { id } = service.create(null, mode);
    const request = vi.waitFor(() => expect(service.get(id).snapshot.questions?.[0]).toBeDefined(), {
      timeout: 600,
      interval: 10,
    });
    const turn = service.send(id, "Ask about a profile");
    await request;
    const question = service.get(id).snapshot.questions[0];
    if (!question) throw Error("Missing pending question");
    return { id, question, turn };
  }
  return { service, root, live, ask };
}

it("marks a pending plan decision in the snapshot and live observation until settlement", async () => {
  const { service, ask, live } = await setup(2, null, false, true);
  const { id, question } = await ask();
  expect(question.aboutPlan).toBe(true);
  expect(service.list().find((item) => item.id === id)?.pendingPlanDecision).toBe(true);
  const request = live.mock.calls.find(([, event]) => event.type === "question.requested")?.[1];
  expect(request).toMatchObject({
    type: "question.requested",
    questionId: question.questionId,
    aboutPlan: true,
  });
  service.answerQuestion(id, question.questionId, { kind: "choice", choice: 1 });
  await service.waitIdle(id);
  expect(service.list().find((item) => item.id === id)?.pendingPlanDecision).toBeUndefined();
});

it("rejects a plan decision request when the session has no plan", async () => {
  const { service, live } = await setup(2, null, false, true, false);
  const { id } = service.create();
  service.send(id, "Ask for a decision about the plan");
  await service.waitIdle(id);
  const snapshot = service.get(id).snapshot;
  expect(snapshot.questions).toEqual([]);
  expect(snapshot.items).toContainEqual(
    expect.objectContaining({ kind: "tool", name: "ask_user", status: "error" }),
  );
  expect(live.mock.calls.some(([, event]) => event.type === "question.requested")).toBe(false);
});

it.each([
  [{ kind: "choice", choice: 2 } as const, "Fast"],
  [{ kind: "choice", choice: 1 } as const, "Quiet"],
  [{ kind: "text", text: "Custom profile" } as const, "Custom profile"],
  [{ kind: "cancel" } as const, undefined],
])("routes %o to the originating turn and records the user outcome", async (reply, answer) => {
  const { service, ask } = await setup();
  const { id, question, turn } = await ask();
  expect(question.turnId).toBe(turn.turnId);
  service.answerQuestion(id, question.questionId, reply);
  expect(() => service.answerQuestion(id, question.questionId, reply)).toThrow(
    expect.objectContaining({ code: "CONFLICT" }),
  );
  expect(await service.waitIdle(id)).toEqual({ stopReason: "end" });
  const snapshot = service.get(id).snapshot;
  expect(snapshot.questions[0]?.outcome).toMatchObject(
    answer === undefined ? { source: "user", kind: "cancelled" } : { source: "user", answer },
  );
  expect(snapshot.items.at(-1)).toMatchObject({
    kind: "assistant",
    text: answer === undefined ? "Model received user: {{answer}}" : `Model received user: ${answer}`,
  });
});

it("keeps the deadline after renderer unsubscribe and reload and rejects an answer at expiry", async () => {
  const { service, ask, live } = await setup();
  const { id, question } = await ask();
  expect(Date.parse(question.deadline ?? "") - Date.now()).toBeGreaterThan(59_900);
  expect(Date.parse(question.deadline ?? "") - Date.now()).toBeLessThanOrEqual(60_000);
  const first = vi.fn();
  service.subscribe(id, 0, first)();
  expect(first).toHaveBeenCalledWith(
    expect.any(Number),
    expect.objectContaining({ type: "question.requested" }),
  );
  const { seq } = service.get(id);
  const reloaded = vi.fn();
  const off = service.subscribe(id, seq, reloaded);
  const requests = live.mock.calls.filter(([, event]) => event.type === "question.requested");
  expect(requests).toHaveLength(1);
  const event = requests[0]?.[1];
  expect(event).toMatchObject({ type: "question.requested", questionId: question.questionId });
  if (event?.type !== "question.requested") throw Error("Missing live question event");
  expect(event.pending()).toBe(true);

  // Move the clock without dispatching the timer to exercise a delayed timer callback.
  vi.setSystemTime(new Date(question.deadline ?? ""));
  expect(() => service.answerQuestion(id, question.questionId, { kind: "choice", choice: 1 })).toThrow(
    expect.objectContaining({ code: "CONFLICT" }),
  );
  await service.waitIdle(id);
  expect(event.pending()).toBe(false);
  off();
  expect(reloaded.mock.calls.filter(([, e]) => e.type === "question.settled")).toEqual([
    [
      expect.any(Number),
      expect.objectContaining({
        outcome: { kind: "choice", choice: 2, answer: "Fast", source: "automatic" },
      }),
    ],
  ]);
  expect(service.get(id).snapshot.items.at(-1)).toMatchObject({ text: "Model received automatic: Fast" });
});

it("opens independent waits, accepts a reply before the deadline, and cancels the other on stop", async () => {
  const { service, ask } = await setup();
  const a = await ask();
  const b = await ask();
  const deadline = Date.parse(a.question.deadline ?? "");
  vi.setSystemTime(deadline - 1);
  expect(() => service.answerQuestion(a.id, b.question.questionId, { kind: "cancel" })).toThrow(
    expect.objectContaining({ code: "CONFLICT" }),
  );
  expect(() => service.answerQuestion(a.id, a.question.questionId, { kind: "choice", choice: 3 })).toThrow(
    expect.objectContaining({ code: "INVALID" }),
  );
  service.answerQuestion(a.id, a.question.questionId, { kind: "choice", choice: 1 });
  expect(service.stop(b.id)).toBe(true);
  await vi.advanceTimersByTimeAsync(120_000);
  expect(await service.waitIdle(a.id)).toEqual({ stopReason: "end" });
  expect(await service.waitIdle(b.id)).toEqual({ stopReason: "aborted" });
  expect(service.get(a.id).snapshot.questions[0]?.outcome).toMatchObject({ answer: "Quiet", source: "user" });
  expect(service.get(b.id).snapshot.questions[0]?.outcome).toEqual({ kind: "cancelled", source: "stopped" });
});

it.each([
  [null, 2],
  [1, 0],
  [1, 3],
  [1, 1.5],
  [1, "2"],
  [1, null],
] as const)(
  "does not apply an ineligible recommendation (timeout %s, choice %s)",
  async (timeout, recommended) => {
    const { service, ask } = await setup(recommended, timeout);
    const { id, question } = await ask();
    expect(question.deadline).toBeNull();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(service.get(id).snapshot.questions[0]?.outcome).toBeNull();
    service.answerQuestion(id, question.questionId, { kind: "cancel" });
    await service.waitIdle(id);
  },
);

it("keeps ordinary sends out of the steering queue while an answer is pending", async () => {
  const { service, ask } = await setup(2, null);
  const { id, question } = await ask();
  expect(() => service.send(id, "x".repeat(2001))).toThrow(expect.objectContaining({ code: "BUSY" }));
  await expect(service.sendWithImages(id, "Answer", ["invalid.png"])).rejects.toMatchObject({ code: "BUSY" });
  expect(service.get(id).snapshot.items.some((item) => item.kind === "user" && item.pending)).toBe(false);
  expect(service.get(id).snapshot.questions[0]?.outcome).toBeNull();
  service.answerQuestion(id, question.questionId, { kind: "cancel" });
  expect(await service.waitIdle(id)).toEqual({ stopReason: "end" });
});

it("keeps clarification pending when the user leaves Bypass", async () => {
  const { service, ask } = await setup(2, null);
  const { id, question } = await ask("bypass");
  service.setMode(id, "ask");
  expect(service.get(id).snapshot.questions[0]?.outcome).toBeNull();
  service.answerQuestion(id, question.questionId, { kind: "choice", choice: 1 });
  expect(await service.waitIdle(id)).toEqual({ stopReason: "end" });
  expect(service.get(id).snapshot.questions[0]?.outcome).toMatchObject({ answer: "Quiet", source: "user" });
});

it("applies a timer in the background without satisfying a separate approval", async () => {
  const { service, ask, root } = await setup(2, 1, true);
  const { id } = await ask();
  await vi.advanceTimersByTimeAsync(60_001);
  await vi.waitFor(() => expect(service.get(id).snapshot.approvals[0]?.decision).toBeNull());
  const snapshot = service.get(id).snapshot;
  expect(snapshot.questions[0]?.outcome).toMatchObject({ answer: "Fast", source: "automatic" });
  expect(snapshot.status).toBe("awaiting_approval");
  expect(await readFile(join(root, "target.txt"), "utf8")).toBe("before");
  const approval = snapshot.approvals[0];
  if (!approval) throw Error("Missing approval");
  service.decideApproval({
    sessionId: id,
    approvalId: approval.approvalId,
    requestSha256: approval.requestSha256,
    decision: "denied",
  });
  await service.waitIdle(id);
  expect(await readFile(join(root, "target.txt"), "utf8")).toBe("before");
});

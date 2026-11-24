import { EventEmitter } from "node:events";
import type { LiveSessionActivity } from "@vera/core";
import type { HelpLanguage, Settings } from "@vera/shared";
import { expect, it, vi } from "vitest";
import { notificationOptions, windowsNotificationAppId } from "./session-notification-copy.js";
import { SessionNotifications } from "./session-notifications.js";

const first = { folder: "/private/one", config: { id: "wb_00000000000000000000000001" } };
const second = { folder: "/private/two", config: { id: "wb_00000000000000000000000002" } };
const sessionId = "ses_00000000000000000000000003";
const turn = { type: "turn.completed", turnId: "123", title: "Session title" } as const;
const resolved = { type: "approval.decided", approvalId: "approval-id" } as const;
const questionId = "q_01JB8Z6Q4M7N2K5R9T3V8X1Y0C";
const question = { type: "question.requested", questionId, turnId: "turn", pending: () => true } as const;
const settled = { type: "question.settled", questionId, turnId: question.turnId } as const;
const flush = async () => Promise.resolve();

class Notice extends EventEmitter {
  show = vi.fn();
  close = vi.fn();
}

function harness(platform = "linux", portable = false) {
  const prefs: Settings["notifications"] = {
    turnCompletion: "background",
    approvalRequests: true,
    questionRequests: true,
  };
  const window = { visible: true, focused: false, minimized: false };
  const shown = { folder: first.folder, workbenchId: first.config.id, sessionId };
  const native: Notice[] = [];
  const supported = vi.fn(() => true);
  const activate = vi.fn();
  const create = vi.fn(() => {
    const notice = new Notice();
    native.push(notice);
    return notice;
  });
  const failed = vi.fn();
  const notices = new SessionNotifications({
    platform,
    portable,
    preferences: () => prefs,
    language: () => "en",
    window: () => window,
    shownSession: () => shown,
    supported,
    create,
    activate,
    failed,
  });
  const publish = (event: LiveSessionActivity, workbench = first) =>
    notices.observe(workbench, sessionId, event);
  return { notices, publish, window, shown, prefs, native, supported, create, activate, failed };
}

it("notifies once for a pending plan decision in another visible session and opens Plan", async () => {
  const h = harness();
  h.window.focused = true;
  h.shown.sessionId = "ses_00000000000000000000000004";
  const plan = { ...question, aboutPlan: true } as const;
  h.publish(plan);
  h.publish(plan);
  await flush();
  expect(h.native).toHaveLength(1);
  h.native[0]?.emit("click");
  expect(h.notices.takeActivation(h.activate.mock.calls[0]?.[0])).toMatchObject({
    workbenchId: first.config.id,
    sessionId,
    questionId,
    aboutPlan: true,
  });

  const same = harness();
  same.window.focused = true;
  same.publish(plan);
  await flush();
  expect(same.native).toHaveLength(0);

  const background = harness();
  background.window.focused = false;
  background.publish(plan);
  await flush();
  expect(background.native).toHaveLength(1);
  const notice = background.native[0];
  notice?.emit("show");
  background.publish(settled);
  await flush();
  expect(notice?.close).toHaveBeenCalledOnce();
  notice?.emit("click");
  expect(background.activate).not.toHaveBeenCalled();
});

it.each([
  ["win32", true, false],
  ["win32", false, true],
  ["linux", true, true],
  ["linux", false, true],
] as const)("checks session alert availability on %s in portable=%s", async (platform, portable, native) => {
  const h = harness(platform, portable);
  h.window.minimized = true;
  h.publish(turn);
  h.publish({ type: "approval.requested", approvalId: "pending", pending: () => true });
  h.publish(question);
  await flush();
  expect(h.supported).toHaveBeenCalledTimes(native ? 3 : 0);
  expect(h.create).toHaveBeenCalledTimes(native ? 3 : 0);
});

it("applies completion preference to the actual visible, minimized and focused state", async () => {
  for (const policy of ["never", "background", "always"] as const) {
    for (const visible of [false, true]) {
      for (const focused of [false, true]) {
        for (const minimized of [false, true]) {
          const h = harness();
          h.prefs.turnCompletion = policy;
          Object.assign(h.window, { visible, focused, minimized });
          h.publish(turn);
          await flush();
          const foreground = visible && focused && !minimized;
          expect(h.native).toHaveLength(
            Number(policy === "always" || (policy === "background" && !foreground)),
          );
          expect(h.activate).not.toHaveBeenCalled();
        }
      }
    }
  }
});

it("deduplicates concurrent workbenches independently and consumes only the clicked route", async () => {
  const h = harness();
  for (const workbench of [first, second, first, second, { ...first, folder: "/private/copy" }])
    h.publish(turn, workbench);
  for (let index = 0; index < 25; index++) {
    h.publish({ ...turn, turnId: `burst-${index}` }, first);
    h.publish({ ...turn, turnId: `burst-${index}` }, second);
  }
  await flush();
  expect(h.native).toHaveLength(53);
  expect(h.activate).not.toHaveBeenCalled();
  h.native[1]?.emit("click");
  h.native[1]?.emit("click");
  expect(h.activate).toHaveBeenCalledOnce();
  const token = h.activate.mock.calls[0]?.[0];
  expect(harness().notices.takeActivation(token)).toBeUndefined();
  expect(h.notices.takeActivation(token)).toMatchObject({
    workbenchId: second.config.id,
    folder: second.folder,
    sessionId,
  });
  expect(h.notices.takeActivation(token)).toBeUndefined();
});

it("rechecks pending after a same-stack automatic decision and before dispatch", async () => {
  const h = harness();
  const pending = vi.fn(() => true);
  const request = { type: "approval.requested", approvalId: resolved.approvalId, pending } as const;
  h.publish(request);
  pending.mockReturnValue(false);
  h.publish(resolved);
  await flush();
  pending.mockReturnValue(true);
  h.publish(request);
  h.publish({ ...request, approvalId: "resolved-before-dispatch", pending: () => false });
  await flush();
  expect(h.native).toHaveLength(0);
  expect(h.activate).not.toHaveBeenCalled();
});

it("alerts once for an outstanding delegated approval and invalidates a click after settlement", async () => {
  const h = harness("win32");
  const pending = vi.fn(() => true);
  const request = { type: "approval.requested", approvalId: resolved.approvalId, pending } as const;
  h.publish(request, second);
  h.publish(request, second);
  await flush();
  expect(h.native).toHaveLength(1);
  const notice = h.native[0];
  notice?.emit("show");
  notice?.emit("close", { reason: "timedOut" });
  notice?.emit("click");
  expect(h.activate).toHaveBeenCalledOnce();
  const token = h.activate.mock.calls[0]?.[0];
  pending.mockReturnValue(false);
  h.publish(resolved, second);
  await flush();
  expect(notice?.close).toHaveBeenCalledOnce();
  expect(h.notices.takeActivation(token)).toBeUndefined();
  notice?.emit("click");
  expect(h.activate).toHaveBeenCalledOnce();
  pending.mockReturnValue(true);
  h.publish({ ...request, approvalId: "still-pending" }, second);
  await flush();
  h.native[1]?.emit("click");
  const validToken = h.activate.mock.calls[1]?.[0];
  expect(h.notices.takeActivation(validToken)).toMatchObject({
    workbenchId: second.config.id,
    folder: second.folder,
    sessionId,
    pending,
  });
});

it("waits for asynchronous native creation before dismissing a resolved request", async () => {
  const h = harness("win32");
  h.publish({ type: "approval.requested", approvalId: resolved.approvalId, pending: () => true });
  await flush();
  const notice = h.native[0];
  h.publish(resolved);
  expect(notice?.close).not.toHaveBeenCalled();
  notice?.emit("click");
  notice?.emit("show");
  await flush();
  expect(notice?.close).toHaveBeenCalledOnce();
  expect(h.activate).not.toHaveBeenCalled();
});

it("honors the approval toggle and suppresses approvals while focused even with Always", async () => {
  const h = harness();
  h.prefs.turnCompletion = "always";
  const request = {
    type: "approval.requested",
    approvalId: resolved.approvalId,
    pending: () => true,
  } as const;
  h.window.focused = true;
  h.publish(request);
  await flush();
  h.window.focused = false;
  h.prefs.approvalRequests = false;
  h.publish({ ...request, approvalId: "off" });
  await flush();
  expect(h.native).toHaveLength(0);
});

it("contains unsupported, throwing and asynchronous native failures", async () => {
  const h = harness();
  h.supported.mockReturnValueOnce(false);
  h.publish({ ...turn, turnId: "unsupported" });
  await flush();
  expect(h.create).not.toHaveBeenCalled();
  h.create.mockImplementationOnce(() => {
    throw Error("create");
  });
  h.publish({ ...turn, turnId: "create" });
  h.create.mockImplementationOnce(() => {
    const notice = new Notice();
    notice.show.mockImplementation(() => {
      throw Error("show");
    });
    return notice;
  });
  h.publish({ ...turn, turnId: "show" });
  await flush();
  expect(h.failed).toHaveBeenCalledTimes(2);
  h.publish({ ...turn, turnId: "async" });
  await flush();
  h.native[0]?.emit("failed", {}, "private platform diagnostic");
  h.native[0]?.emit("click");
  expect(h.failed).toHaveBeenCalledTimes(3);
  expect(h.activate).not.toHaveBeenCalled();
});

it("still drops a resolved target when native dismissal fails", async () => {
  const h = harness();
  const pending = vi.fn(() => true);
  h.publish({ type: "approval.requested", approvalId: resolved.approvalId, pending });
  await flush();
  const notice = h.native[0];
  notice?.emit("show");
  notice?.close.mockImplementation(() => {
    throw Error("dismiss failed");
  });
  pending.mockReturnValue(false);
  h.publish(resolved);
  await flush();
  notice?.emit("click");
  expect(h.failed).toHaveBeenCalledOnce();
  expect(h.activate).not.toHaveBeenCalled();
});

it("uses only generic localized text and an opaque Windows tag in native notifications", () => {
  const id = "a4d20c3c7b284d24b7783c62d7d6d4f2";
  const languages = ["en", "ro", "de", "fr"] as const satisfies readonly HelpLanguage[];
  for (const kind of ["completion", "approval", "question"] as const) {
    const bodies = new Set<string>();
    for (const language of languages) {
      const payload = notificationOptions(kind, language, id, "linux");
      expect(Object.keys(payload).sort()).toEqual(["body", "id", "silent", "title"]);
      expect(payload).toMatchObject({ title: "VERA", silent: true });
      bodies.add(payload.body ?? "");
      const windows = notificationOptions(kind, language, id, "win32");
      expect(windows.toastXml).toContain(`launch="type=click&amp;tag=${id}"`);
      expect(windows.toastXml).toContain('<audio silent="true"/>');
      expect(windows.toastXml).not.toMatch(/<actions|<input|apv_|ses_|wb_|private|tool|command/i);
    }
    expect(bodies.size).toBe(languages.length);
  }
  expect(windowsNotificationAppId(false)).toBe("engineering.ddp.vera");
  expect(windowsNotificationAppId(true)).toBe("engineering.ddp.vera.test");
});

it("dispatches once per live pending question across workbenches using only its own preference", async () => {
  const h = harness();
  h.prefs.turnCompletion = "never";
  h.prefs.approvalRequests = false;
  for (const workbench of [first, second, first, second]) h.publish(question, workbench);
  await flush();
  expect(h.native).toHaveLength(2);
  h.native[1]?.emit("click");
  const token = h.activate.mock.calls[0]?.[0];
  expect(h.notices.takeActivation(token)).toMatchObject({
    folder: second.folder,
    workbenchId: second.config.id,
    sessionId,
    questionId,
  });
  expect(h.notices.takeActivation(token)).toBeUndefined();

  const disabled = harness();
  disabled.prefs.questionRequests = false;
  disabled.publish(question);
  disabled.publish(turn);
  disabled.publish({ type: "approval.requested", approvalId: "pending", pending: () => true });
  await flush();
  expect(disabled.native).toHaveLength(2);
});

it("suppresses foreground and already settled questions, including out-of-order and dispatch races", async () => {
  const h = harness();
  h.window.focused = true;
  h.publish(question);
  await flush();
  expect(h.supported).not.toHaveBeenCalled();
  h.window.focused = false;
  h.publish(question);
  h.publish({ ...question, pending: () => false }, second);
  h.publish({ ...settled, questionId: "settled-first" });
  h.publish({ ...question, questionId: "settled-first" });
  h.publish({ ...question, questionId: "settled-in-dispatch" });
  h.publish({ ...settled, questionId: "settled-in-dispatch" });
  await flush();
  expect(h.supported).not.toHaveBeenCalled();
});

it.each(["before show", "after show", "after click"])(
  "invalidates question activation when settlement arrives %s, even if Windows retains its banner",
  async (when) => {
    const h = harness("win32");
    const pending = vi.fn(() => true);
    h.publish({ ...question, pending }, second);
    await flush();
    const notice = h.native[0]!;
    if (when !== "before show") {
      notice.emit("show");
      notice.emit("close", { reason: "timedOut" });
    }
    if (when === "after click") notice.emit("click");
    pending.mockReturnValue(false);
    h.publish(settled, second);
    if (when === "before show") notice.emit("show");
    await flush();
    expect(notice.close).toHaveBeenCalledOnce();
    notice.emit("click");
    expect(h.activate).toHaveBeenCalledTimes(when === "after click" ? 1 : 0);
    expect(h.notices.takeActivation(h.activate.mock.calls[0]?.[0])).toBeUndefined();
  },
);

it("checks an exact question's pending state even before a settlement reaches the presenter", async () => {
  const h = harness();
  const pending = vi.fn(() => true);
  h.publish({ ...question, pending });
  h.publish({ ...question, pending }, second);
  await flush();
  h.native[0]?.emit("click");
  pending.mockReturnValue(false);
  h.native[1]?.emit("click");
  expect(h.activate).toHaveBeenCalledOnce();
  expect(h.notices.takeActivation(h.activate.mock.calls[0]?.[0])).toBeUndefined();
});

it("keeps native capability and creation failures outside question publication", async () => {
  const h = harness();
  h.supported.mockReturnValueOnce(false).mockReturnValueOnce(true);
  h.create.mockImplementationOnce(() => {
    throw Error("native unavailable");
  });
  h.publish(question);
  h.publish(question, second);
  await flush();
  expect(h.supported).toHaveBeenCalledTimes(2);
  expect(h.failed).toHaveBeenCalledOnce();
  expect(h.activate).not.toHaveBeenCalled();
});

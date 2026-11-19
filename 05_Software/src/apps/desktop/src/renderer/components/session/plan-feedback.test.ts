// @vitest-environment jsdom
import userEvent from "@testing-library/user-event";
import {
  applySessionEvent,
  channels,
  emptySessionState,
  type SessionEvent,
  type SessionState,
  veraError,
} from "@vera/shared";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "../../api/index.js";
import { PlanTab } from "./plan-tab.js";
import "../../i18n.js";

vi.mock("../../api/index.js", () => ({ api: { invoke: vi.fn(), subscribe: vi.fn() } }));
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close = function () {
  this.removeAttribute("open");
  this.dispatchEvent(new Event("close"));
};
const workbenchId = "wb_00000000000000000000000001",
  sessionId = "ses_00000000000000000000000001";
let state: SessionState, seq: number, number: number, root: Root, container: HTMLDivElement;
let notify: (event: SessionEvent) => void;
let privacy: (event: { type: "settings.changed" }) => void;
function emit(event: SessionEvent) {
  state = applySessionEvent(state, event);
  seq++;
  notify(event);
}
function button(text: string) {
  const found = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => node.textContent === text || node.getAttribute("aria-label") === text,
  );
  expect(found, text).toBeTruthy();
  return found as HTMLButtonElement;
}
function field(label: string) {
  const found = container.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${label}"]`);
  expect(found, label).toBeTruthy();
  return found as HTMLTextAreaElement;
}
async function render(props: { sessionId?: string; readOnly?: boolean; archived?: boolean } = {}) {
  await act(async () => root.render(createElement(PlanTab, { workbenchId, sessionId, ...props })));
}
async function open(step = 2) {
  await act(async () => button(`Add comment to step ${step}`).click());
}
async function feedback(text: string) {
  const user = userEvent.setup();
  await act(async () => user.type(field("Feedback"), text));
}
const saves = () =>
  vi.mocked(api.invoke).mock.calls.filter(([channel]) => channel === "session.plan.comment.save");
beforeEach(() => {
  state = {
    ...emptySessionState(),
    planRevision: 1,
    todos: [
      { id: "same", text: "A😀B\nμC", status: "pending" },
      { id: "same", text: "A😀B\nμC", status: "pending" },
      { text: "", status: "done" },
    ],
  };
  seq = 1;
  number = 0;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.mocked(api.subscribe).mockImplementation((...args: unknown[]) => {
    if (args[0] === "session") notify = args[3] as typeof notify;
    if (args[0] === "app") privacy = args[1] as typeof privacy;
    return () => {};
  });
  vi.mocked(api.invoke).mockImplementation(async (channel, raw) => {
    if (channel === "session.get") return { snapshot: structuredClone(state), seq } as never;
    if (channel === "session.revision") return { seq } as never;
    if (channel === "session.plan.comment.save") {
      const change = channels[channel].request.parse(raw);
      const previous =
        "commentId" in change
          ? state.planComments.find((comment) => comment.id === change.commentId)
          : undefined;
      const comment =
        change.action === "create"
          ? { id: `pc_${++number}`, text: change.text, target: change.target }
          : change.action === "edit"
            ? { ...previous!, text: change.text }
            : { ...previous!, target: change.target };
      emit({ type: "plan.comments.saved", comments: [comment] });
      return {} as never;
    }
    if (channel === "session.plan.comment.delete") {
      const request = channels[channel].request.parse(raw);
      emit({ type: "plan.comment.removed", commentId: request.commentId });
      return {} as never;
    }
    if (channel === "session.plan.review.restore") {
      const request = channels[channel].request.parse(raw);
      const review = state.planReviews.find((review) => review.id === request.reviewId);
      if (!review) throw veraError("NOT_FOUND");
      emit({
        type: "plan.review.restored",
        reviewId: review.id,
        expectedFeedbackRevision: request.expectedFeedbackRevision,
        comments: review.comments.map((comment) => ({
          ...comment,
          id: `restored_${comment.id}`,
          restoredFrom: { reviewId: review.id, commentId: comment.id },
        })),
      });
      return {} as never;
    }
    return {} as never;
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.resetAllMocks();
});

it("saves exact multiline feedback on one duplicate occurrence, edits without retargeting and deletes only that draft", async () => {
  await render();
  await open();
  await feedback("Vérifier 😀\n μC ");
  await act(async () => button("Save draft").click());
  expect(saves()[0]?.[1]).toEqual({
    workbenchId,
    sessionId,
    action: "create",
    expectedFeedbackRevision: 0,
    text: "Vérifier 😀\n μC ",
    target: { revision: 1, stepIndex: 1, stepText: "A😀B\nμC", range: null },
  });
  expect(container.querySelectorAll("dialog[open]")).toHaveLength(0);
  await act(async () => button("Drafts: 1").click());
  await act(async () => button("Edit feedback").click());
  await act(async () => userEvent.setup().clear(field("Feedback")));
  await feedback("Changed\n😀");
  await act(async () => button("Save draft").click());
  expect(saves()[1]?.[1]).toEqual({
    workbenchId,
    sessionId,
    action: "edit",
    expectedFeedbackRevision: 1,
    commentId: "pc_1",
    text: "Changed\n😀",
  });
  await act(async () => button("Drafts: 1").click());
  await act(async () => button("Delete feedback").click());
  expect(state.planComments).toEqual([]);
  expect(state.todos).toHaveLength(3);
  expect(vi.mocked(api.invoke).mock.calls.some(([channel]) => channel === "session.send")).toBe(false);
});

it("captures a backwards keyboard UTF16 fragment and permits an empty whole step", async () => {
  await render();
  await open();
  field("Step text").setSelectionRange(1, 3, "backward");
  await act(async () => button("Use selected text").click());
  await feedback("Emoji");
  await act(async () => button("Save draft").click());
  expect(state.planComments[0]?.target.range).toEqual({ start: 1, end: 3, quote: "😀" });
  await open(3);
  await feedback("Empty whole step");
  await act(async () => button("Save draft").click());
  expect(state.planComments[1]?.target).toEqual({ revision: 1, stepIndex: 2, stepText: "", range: null });
});

it("maps native textarea CRLF selection back to exact original UTF16 offsets without normalizing targets", async () => {
  const original = "A\r\n😀B\rtail";
  state.todos = [{ text: original, status: "pending" }];
  await render();
  await open(1);
  expect(field("Step text").value).toBe("A\n😀B\ntail");
  field("Step text").setSelectionRange(2, 4, "backward");
  await act(async () => button("Use selected text").click());
  await feedback("Exact emoji");
  await act(async () => button("Save draft").click());
  expect(state.planComments[0]?.target).toEqual({
    revision: 1,
    stepIndex: 0,
    stepText: original,
    range: { start: 3, end: 5, quote: "😀" },
  });
  await open(1);
  field("Step text").setSelectionRange(0, field("Step text").value.length);
  await act(async () => button("Use selected text").click());
  await feedback("All original line endings");
  await act(async () => button("Save draft").click());
  expect(state.planComments[1]?.target.range).toEqual({ start: 0, end: original.length, quote: original });
});

it("retains stale text and old quotes until explicit re-anchor, including an identical replacement", async () => {
  await render();
  await open();
  await feedback("Keep feedback");
  await act(async () => button("Save draft").click());
  await act(async () => emit({ type: "todo.updated", items: [...state.todos] }));
  expect(container.textContent).toContain("Needs re-anchor");
  expect(button("Review plan").disabled).toBe(true);
  await act(async () => button("Re-anchor").click());
  await act(async () =>
    userEvent
      .setup()
      .selectOptions(container.querySelector('select[aria-label="Step"]') as HTMLSelectElement, "0"),
  );
  await act(async () => button("Entire step").click());
  await act(async () => button("Save re-anchor").click());
  expect(state.planComments[0]?.text).toBe("Keep feedback");
  expect(state.planComments[0]?.target.stepIndex).toBe(0);
  expect(state.planComments[0]?.target.revision).toBe(2);
  expect(button("Review plan").disabled).toBe(false);
});

it("reconciles a lost review acknowledgement using the original pair with no duplicate activation", async () => {
  await render();
  await open();
  await feedback("Revise");
  await act(async () => button("Save draft").click());
  const base = vi.mocked(api.invoke).getMockImplementation();
  if (!base) throw Error("missing API fixture");
  let calls = 0,
    release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.mocked(api.invoke).mockImplementation(async (channel, raw) => {
    if (channel !== "session.plan.review") return base(channel, raw);
    calls++;
    channels[channel].request.parse(raw);
    if (calls === 1) {
      emit({
        type: "plan.review.submitted",
        review: {
          id: "review",
          expectedPlanRevision: 1,
          expectedFeedbackRevision: 1,
          plan: [...state.todos],
          comments: [...state.planComments],
          turnId: "turn",
          messageId: "user",
          submittedAt: new Date(0).toISOString(),
          stopReason: null,
        },
      });
      await held;
      throw veraError("OFFLINE");
    }
    return { reviewId: "review", turnId: "turn", messageId: "user" } as never;
  });
  await act(async () => {
    button("Review plan").click();
    button("Review plan").click();
  });
  expect(calls).toBe(1);
  await act(async () => {
    release();
    await held;
  });
  await open(1);
  await feedback("Later draft, not part of the unknown acknowledgement");
  await act(async () => button("Save draft").click());
  expect(button("Review plan").disabled).toBe(true);
  await act(async () => button("Retry review").click());
  expect(calls).toBe(2);
  expect(
    vi
      .mocked(api.invoke)
      .mock.calls.filter(([channel]) => channel === "session.plan.review")
      .map(([, request]) => request),
  ).toEqual(Array(2).fill({ workbenchId, sessionId, expectedPlanRevision: 1, expectedFeedbackRevision: 1 }));
});

it("keeps editor feedback through privacy refresh but hides its old capture until explicit recapture", async () => {
  await render();
  await open();
  await feedback("Keep unsent feedback");
  field("Step text").setSelectionRange(1, 3);
  await act(async () => button("Use selected text").click());
  state = { ...state, todos: [{ text: "Masked step", status: "pending" }] };
  await act(async () => privacy({ type: "settings.changed" }));
  expect(field("Feedback").value).toBe("Keep unsent feedback");
  expect(container.textContent).not.toContain("😀");
  expect(button("Save draft").disabled).toBe(true);
  await act(async () =>
    userEvent
      .setup()
      .selectOptions(container.querySelector('select[aria-label="Step"]') as HTMLSelectElement, "0"),
  );
  await act(async () => button("Entire step").click());
  expect(button("Save draft").disabled).toBe(false);
});

it("locks all mutations for archived/read-only contexts and review for absent feedback", async () => {
  await render();
  expect(button("Review plan").disabled).toBe(true);
  for (const props of [{ readOnly: true }, { archived: true }]) {
    await render(props);
    expect(button("Add comment to step 1").disabled).toBe(true);
  }
  state = { ...state, mode: "read-only" };
  await render();
  expect(button("Add comment to step 1").disabled).toBe(false);
});

it("captures pointer text before focus changes, rejecting ranges spanning distinct duplicate rows", async () => {
  await render();
  const spans = container.querySelectorAll(".plan-text");
  const first = spans[0]?.firstChild,
    second = spans[1]?.firstChild;
  if (!first || !second) throw Error("missing plan text nodes");
  const selection = window.getSelection();
  selection?.setBaseAndExtent(second, 3, second, 1);
  await act(async () =>
    button("Add comment to step 2").dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })),
  );
  selection?.removeAllRanges();
  await open();
  await feedback("Pointer quote");
  await act(async () => {
    button("Save draft").click();
    button("Save draft").click();
  });
  expect(saves()).toHaveLength(1);
  expect(state.planComments[0]?.target.range?.quote).toBe("😀");
  const refreshed = container.querySelectorAll(".plan-text");
  const start = refreshed[0]?.firstChild,
    end = refreshed[1]?.firstChild;
  if (!start || !end) throw Error("missing refreshed plan text nodes");
  selection?.setBaseAndExtent(start, 1, end, 3);
  await act(async () =>
    button("Add comment to step 2").dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })),
  );
  await open();
  await feedback("Whole step fallback");
  await act(async () => button("Save draft").click());
  expect(state.planComments[1]?.target.range).toBeNull();
  selection?.removeAllRanges();
});

it("retains text on conflict, reconciles and requires explicit target recapture before retry", async () => {
  await render();
  await open();
  await feedback("Do not discard\n😀");
  const base = vi.mocked(api.invoke).getMockImplementation();
  if (!base) throw Error("missing API fixture");
  let conflicted = false;
  vi.mocked(api.invoke).mockImplementation(async (channel, raw) => {
    if (channel === "session.plan.comment.save" && !conflicted) {
      conflicted = true;
      emit({ type: "todo.updated", items: [...state.todos] });
      throw veraError("CONFLICT");
    }
    return base(channel, raw);
  });
  await act(async () => button("Save draft").click());
  expect(field("Feedback").value).toBe("Do not discard\n😀");
  expect(container.querySelector('dialog [role="alert"]')).toBeTruthy();
  expect(button("Save draft").disabled).toBe(true);
  await act(async () => button("Entire step").click());
  await act(async () => button("Save draft").click());
  expect(state.planComments[0]?.target.revision).toBe(2);
  expect(state.planComments[0]?.text).toBe("Do not discard\n😀");
});

it("shows immutable unsuccessful history after the plan is cleared and restores drafts without submitting", async () => {
  const comment = {
    id: "original",
    text: "Old feedback",
    target: {
      revision: 1,
      stepIndex: 1,
      stepText: state.todos[1]?.text ?? "",
      range: { start: 1, end: 3, quote: "😀" },
    },
  };
  state = applySessionEvent(state, {
    type: "plan.review.submitted",
    review: {
      id: "failed",
      expectedPlanRevision: 1,
      expectedFeedbackRevision: 0,
      plan: [...state.todos],
      comments: [comment],
      turnId: "failed-turn",
      messageId: "failed-user",
      submittedAt: new Date(0).toISOString(),
      stopReason: "error",
    },
  });
  await render();
  expect(button("Submitted: 1")).toBeTruthy();
  expect(container.textContent).not.toContain("Old feedback");
  await act(async () => emit({ type: "todo.updated", items: [] }));
  expect(container.querySelectorAll("[data-plan-step]")).toHaveLength(0);
  await act(async () => button("Previous reviews").click());
  expect(container.textContent).toContain("Old feedback");
  expect(container.textContent).toContain("Review failed");
  expect(container.querySelectorAll("[data-plan-step] button")).toHaveLength(0);
  await act(async () => button("Restore feedback").click());
  expect(state.planComments[0]?.restoredFrom).toEqual({ reviewId: "failed", commentId: "original" });
  expect(container.textContent).toContain("Needs re-anchor");
  expect(button("Review plan").disabled).toBe(true);
  expect(
    vi
      .mocked(api.invoke)
      .mock.calls.some(([channel]) => channel === "session.send" || channel === "session.plan.review"),
  ).toBe(false);
});

it("ignores an old save acknowledgement after navigation, leaving the new session editor untouched", async () => {
  await render();
  await open();
  await feedback("Old scope");
  const base = vi.mocked(api.invoke).getMockImplementation();
  if (!base) throw Error("missing API fixture");
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.mocked(api.invoke).mockImplementation(async (channel, raw) => {
    if (channel === "session.plan.comment.save") {
      await held;
      return {} as never;
    }
    return base(channel, raw);
  });
  await act(async () => button("Save draft").click());
  await render({ sessionId: "ses_00000000000000000000000002" });
  await open(1);
  await feedback("New unsaved feedback");
  const reads = vi.mocked(api.invoke).mock.calls.filter(([channel]) => channel === "session.get").length;
  await act(async () => {
    release();
    await held;
  });
  expect(field("Feedback").value).toBe("New unsaved feedback");
  expect(vi.mocked(api.invoke).mock.calls.filter(([channel]) => channel === "session.get")).toHaveLength(
    reads,
  );
});

it("owns Escape locally and restores the opener or stable toolbar focus after refresh", async () => {
  await render();
  const opener = button("Add comment to step 2");
  opener.focus();
  await open();
  const globalKey = vi.fn();
  window.addEventListener("keydown", globalKey);
  try {
    await act(async () =>
      field("Feedback").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    expect(globalKey).not.toHaveBeenCalled();
    await act(async () =>
      container.querySelector("dialog")?.dispatchEvent(new Event("cancel", { cancelable: true })),
    );
    expect(document.activeElement).toBe(opener);
    await open();
    await feedback("Survives refresh");
    await act(async () => privacy({ type: "settings.changed" }));
    await act(async () => button("Cancel").click());
    expect(document.activeElement).toBe(container.querySelector('.plan-actions[tabindex="-1"]'));
  } finally {
    window.removeEventListener("keydown", globalKey);
  }
});

it.each([
  "no-plan",
  "no-feedback",
  "stale",
  "active-id",
  "running",
  "approval-status",
  "queued",
  "pending-approval",
])("refuses pointer and keyboard review activation for %s", async (reason) => {
  const target = { revision: 1, stepIndex: 0, stepText: state.todos[0]?.text ?? "", range: null };
  state = { ...state, planComments: [{ id: "draft", text: "Pending", target, stale: false }] };
  if (reason === "no-plan") state.todos = [];
  if (reason === "no-feedback") state.planComments = [];
  if (reason === "stale") state.planComments[0] = { id: "draft", text: "Pending", target, stale: true };
  if (reason === "active-id") state.activeTurnId = "active";
  if (reason === "running") state.status = "running";
  if (reason === "approval-status") state.status = "awaiting_approval";
  if (reason === "queued")
    state.items = [{ kind: "user", id: "queued", text: "Not delivered", pending: true }];
  if (reason === "pending-approval") {
    state = applySessionEvent(state, {
      type: "approval.requested",
      approvalId: "approval",
      callId: "call",
      requestSha256: "a".repeat(64),
      tool: "edit",
      path: "file",
      diff: "",
      bytes: 0,
    });
    state.status = "idle";
  }
  await render();
  expect(button("Review plan").disabled).toBe(true);
  await act(async () => {
    button("Review plan").click();
    button("Review plan").focus();
    await userEvent.setup().keyboard("{Enter}");
  });
  expect(
    vi
      .mocked(api.invoke)
      .mock.calls.some(([channel]) => channel === "session.plan.review" || channel === "session.send"),
  ).toBe(false);
});

it("opens distinct draft/submitted indicators for exact duplicate occurrences and retains removed context", async () => {
  const target = {
    revision: 1,
    stepIndex: 1,
    stepText: state.todos[1]?.text ?? "",
    range: { start: 1, end: 3, quote: "😀" },
  };
  state = applySessionEvent(state, {
    type: "plan.review.submitted",
    review: {
      id: "previous",
      expectedPlanRevision: 1,
      expectedFeedbackRevision: 0,
      plan: [...state.todos],
      comments: [{ id: "submitted", text: "Submitted text", target }],
      turnId: "finished",
      messageId: "user",
      submittedAt: new Date(0).toISOString(),
      stopReason: "end",
    },
  });
  state = applySessionEvent(state, {
    type: "plan.comments.saved",
    comments: [{ id: "draft", text: "Draft text", target: { ...target, stepIndex: 0, range: null } }],
  });
  await render();
  const rows = container.querySelectorAll(".plan-tab > .plan-list > li");
  expect(rows[0]?.textContent).toContain("Drafts: 1");
  expect(rows[0]?.textContent).not.toContain("Submitted: 1");
  expect(rows[1]?.textContent).toContain("Submitted: 1");
  expect(rows[1]?.textContent).not.toContain("Drafts: 1");
  expect(rows[2]?.querySelector(".disclosure-toggle")).toBeNull();
  await act(async () => button("Submitted: 1").click());
  expect(rows[1]?.querySelector("blockquote")?.textContent).toBe("😀");
  expect(rows[1]?.querySelector(".plan-comments .plan-status")?.textContent).toContain("Submitted");
  await act(async () => button("Drafts: 1").click());
  expect(rows[0]?.querySelector("blockquote")?.textContent).toBe(target.stepText);
  expect(rows[0]?.querySelector(".plan-comments .plan-status")?.textContent).toContain("Draft");
  await act(async () => emit({ type: "todo.updated", items: [] }));
  expect(container.textContent).toContain("Needs re-anchor");
  expect(container.textContent).toContain("Draft text");
  await act(async () => button("Previous reviews").click());
  expect(container.textContent).toContain("Submitted text");
});

it("retains saved drafts and exposes a fresh explicit retry after preacceptance refusal and navigation", async () => {
  await render();
  await open();
  await feedback("Retained\n😀");
  await act(async () => button("Save draft").click());
  const before = structuredClone(state.planComments),
    base = vi.mocked(api.invoke).getMockImplementation();
  if (!base) throw Error("missing API fixture");
  let attempted = false;
  vi.mocked(api.invoke).mockImplementation(async (channel, raw) => {
    if (channel !== "session.plan.review") return base(channel, raw);
    if (!attempted) {
      attempted = true;
      throw veraError("INVALID");
    }
    const request = channels[channel].request.parse(raw);
    emit({
      type: "plan.review.submitted",
      review: {
        id: "accepted",
        expectedPlanRevision: request.expectedPlanRevision,
        expectedFeedbackRevision: request.expectedFeedbackRevision,
        plan: [...state.todos],
        comments: state.planComments.map(({ stale: _stale, ...comment }) => comment),
        turnId: "turn",
        messageId: "user",
        submittedAt: new Date(0).toISOString(),
        stopReason: "end",
      },
    });
    return { reviewId: "accepted", turnId: "turn", messageId: "user" } as never;
  });
  await act(async () => button("Review plan").click());
  expect(container.querySelector('[role="alert"]')).toBeTruthy();
  expect(state.planComments).toEqual(before);
  expect(state.planReviews).toEqual([]);
  await render({ sessionId: "ses_00000000000000000000000002" });
  await render();
  await act(async () => button("Drafts: 1").click());
  expect(container.textContent).toContain("Retained\n😀");
  await act(async () => button("Review plan").click());
  expect(state.planComments).toEqual([]);
  expect(state.planReviews).toHaveLength(1);
  const requests = vi.mocked(api.invoke).mock.calls.filter(([channel]) => channel === "session.plan.review");
  expect(requests).toHaveLength(2);
  expect(requests[0]?.[1]).toEqual(requests[1]?.[1]);
});

it("locks feedback edits during save and retains the unchanged text when that save fails", async () => {
  await render();
  await open();
  await feedback("Accepted input\n😀");
  const base = vi.mocked(api.invoke).getMockImplementation();
  if (!base) throw Error("missing API fixture");
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.mocked(api.invoke).mockImplementation(async (channel, raw) => {
    if (channel === "session.plan.comment.save") {
      await held;
      throw veraError("OFFLINE");
    }
    return base(channel, raw);
  });
  await act(async () => button("Save draft").click());
  expect(field("Feedback").readOnly).toBe(true);
  expect(button("Save draft").disabled).toBe(true);
  await act(async () => {
    release();
    await held;
  });
  expect(field("Feedback").value).toBe("Accepted input\n😀");
  expect(field("Feedback").readOnly).toBe(false);
});

// @vitest-environment jsdom
import userEvent from "@testing-library/user-event";
import { emptySessionState, type Response, type SessionQuestion } from "@vera/shared";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "../../api/index.js";
import i18n from "../../i18n.js";
import { QuestionCard } from "./question-card.js";
import { confirmPendingQuestionFocus, pendingQuestionFocus } from "./question-focus.js";

vi.mock("../../api/index.js", () => ({ api: { invoke: vi.fn().mockResolvedValue({}) } }));
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const target = { questionId: "q_01JB8Z6Q4M7N2K5R9T3V8X1Y0C", sessionId: "session", workbenchId: "bench" };
const question: SessionQuestion = {
  questionId: target.questionId,
  question: "Which profile?",
  callId: "call",
  turnId: "turn",
  choices: ["Quiet", "Fast"],
  recommended: 2,
  deadline: "2026-11-24T13:30:42Z",
  outcome: null,
};

let root: Root;
let container: HTMLDivElement;
beforeEach(async () => {
  await i18n.changeLanguage("en");
  vi.mocked(api.invoke).mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render(value = question) {
  await act(async () =>
    root.render(createElement(QuestionCard, { ...target, question: value, disabled: false })),
  );
}
const radio = (index: number) => container.querySelectorAll<HTMLInputElement>("input[type=radio]")[index]!;
const button = (index: number) => container.querySelectorAll<HTMLButtonElement>("button")[index]!;

it.each([1, 2])("marks a recommendation and waits for an explicit choice %s submission", async (choice) => {
  await render();
  const user = userEvent.setup();
  expect(radio(1).closest("label")?.textContent).toContain("Recommended");
  expect(container.textContent).toContain("Recommended answer applies at");
  expect(button(0).disabled).toBe(true);
  await act(async () => user.click(radio(choice - 1)));
  expect(api.invoke).not.toHaveBeenCalled();
  await act(async () => user.click(button(0)));
  expect(api.invoke).toHaveBeenCalledExactlyOnceWith("session.question.answer", {
    ...target,
    reply: { kind: "choice", choice },
  });
});

it("takes the typed text after a choice was highlighted and renders the settled user answer", async () => {
  await render();
  const user = userEvent.setup();
  const input = container.querySelector<HTMLInputElement>("input[type=text]")!;
  await act(async () => {
    await user.click(radio(1));
    await user.type(input, " Custom profile ");
    await user.click(button(0));
  });
  expect(api.invoke).toHaveBeenCalledExactlyOnceWith("session.question.answer", {
    ...target,
    reply: { kind: "text", text: "Custom profile" },
  });
  await render({ ...question, outcome: { kind: "text", answer: "Custom profile", source: "user" } });
  expect(container.querySelector("[role=status]")?.textContent).toBe("User answer: Custom profile");
  expect(container.querySelector("button")).toBeNull();
});

it("submits cancellation independently of choice", async () => {
  await render({ ...question, deadline: null });
  expect(container.textContent).not.toContain("Recommended answer applies at");
  await act(async () => button(1).click());
  expect(api.invoke).toHaveBeenCalledExactlyOnceWith("session.question.answer", {
    ...target,
    reply: { kind: "cancel" },
  });
});

it("finds only the pending question with the exact workbench, session and turn", async () => {
  await render();
  const state = { ...emptySessionState(), activeTurnId: "turn", questions: [question] };
  const find = (candidate = state, workbench = target.workbenchId, session = target.sessionId) =>
    pendingQuestionFocus(target, workbench, session, candidate, container);
  expect(find()?.dataset.pendingQuestion).toBe(question.questionId);
  expect(find(state, "other")).toBeUndefined();
  expect(find(state, target.workbenchId, "another session")).toBeUndefined();
  expect(find({ ...state, activeTurnId: "new" })).toBeUndefined();
  const answered = {
    ...question,
    outcome: { kind: "choice", answer: "Fast", choice: 2, source: "automatic" },
  } as const;
  expect(find({ ...state, questions: [answered] })).toBeUndefined();
  await render(answered);
  expect(container.querySelector("[role=status]")?.textContent).toBe("Automatic answer: Fast");
});

const currentActivity: Response<"session.activity"> = [
  {
    name: "Correct workbench",
    workbenchId: target.workbenchId,
    folder: "/bench",
    foreground: true,
    sessions: [{ id: target.sessionId, pendingQuestionId: target.questionId, title: "", status: "running" }],
  },
];

it("confirms the pending card against fresh activity and ignores other owners, sessions and requests", async () => {
  await render();
  const card = container.querySelector<HTMLElement>("[data-pending-question]")!;
  const activity = currentActivity[0]!;
  const session = activity.sessions[0]!;
  const finish = vi.fn();
  for (const rows of [
    [],
    [{ ...activity, workbenchId: "other" }],
    [{ ...activity, sessions: [{ ...session, id: "other" }] }],
    [{ ...activity, sessions: [{ ...session, pendingQuestionId: "another question" }] }],
  ]) {
    vi.mocked(api.invoke).mockResolvedValueOnce(rows);
    await confirmPendingQuestionFocus(target, card, container, finish);
    expect(finish).toHaveBeenLastCalledWith(undefined);
  }
  vi.mocked(api.invoke).mockRejectedValueOnce(Error("Activity unavailable"));
  await confirmPendingQuestionFocus(target, card, container, finish);
  expect(finish).toHaveBeenLastCalledWith(undefined);
  vi.mocked(api.invoke).mockResolvedValueOnce(currentActivity);
  await confirmPendingQuestionFocus(target, card, container, finish);
  expect(finish).toHaveBeenLastCalledWith(card);
  expect(vi.mocked(api.invoke).mock.calls.every(([channel]) => channel === "session.activity")).toBe(true);
});

it("rejects a late pending Activity response once the live question card settles", async () => {
  await render();
  const card = container.querySelector<HTMLElement>("[data-pending-question]")!;
  let respond!: (activity: typeof currentActivity) => void;
  const response = new Promise<typeof currentActivity>((resolve) => {
    respond = resolve;
  });
  vi.mocked(api.invoke).mockReturnValueOnce(response);
  const finish = vi.fn();
  const confirmation = confirmPendingQuestionFocus(target, card, container, finish);
  await render({ ...question, outcome: { kind: "choice", answer: "Fast", choice: 2, source: "automatic" } });
  respond(currentActivity);
  await confirmation;
  expect(finish).toHaveBeenCalledExactlyOnceWith(undefined);
  expect(container.querySelector("button")).toBeNull();
  expect(api.invoke).toHaveBeenCalledExactlyOnceWith("session.activity", {});
});

it("validates and applies question focus in the same continuation", async () => {
  await render();
  const card = container.querySelector<HTMLElement>("[data-pending-question]")!;
  let respond!: (activity: typeof currentActivity) => void;
  vi.mocked(api.invoke).mockReturnValueOnce(
    new Promise<typeof currentActivity>((resolve) => {
      respond = resolve;
    }),
  );
  const focused = vi.fn((verified: HTMLElement | undefined) => {
    if (!verified) return;
    expect(verified.dataset.pendingQuestion).toBe(target.questionId);
    verified.focus();
  });
  const confirmation = confirmPendingQuestionFocus(target, card, container, focused);
  respond(currentActivity);
  queueMicrotask(() => card.removeAttribute("data-pending-question"));
  await confirmation;
  expect(focused).toHaveBeenCalledExactlyOnceWith(card);
  expect(document.activeElement).toBe(card);
});

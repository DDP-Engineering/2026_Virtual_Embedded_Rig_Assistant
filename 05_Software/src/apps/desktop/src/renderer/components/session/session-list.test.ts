// @vitest-environment jsdom
// REQ-UX-a6ba4f23 REQ-UX-f025500b REQ-UX-3ff00682 REQ-UX-2feba215 REQ-FUNC-573f5873 REQ-UX-ab0d5e61
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import type { SessionSummary } from "@vera/shared";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import i18n from "../../i18n.js";
import { SessionList } from "./session-list.js";

vi.mock("../../api/index.js", async () => {
  const { createMockApi } = await import("../../mocks/mockApi.js");
  return { api: createMockApi().api, usingMocks: true };
});
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLDivElement | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  container?.remove();
  container = undefined;
  localStorage.clear();
});

const workbenchId = "wb_01ARZ3NDEKTSV4RRFFQ69G5FAV";
const id = (n: number) => `ses_${String(n).padStart(26, "0")}`;
function session(
  n: number,
  extra: Partial<SessionSummary> & { parent?: number; outcome?: "running" | "completed" | "error" } = {},
): SessionSummary {
  const { parent, outcome, ...rest } = extra;
  return {
    id: id(n),
    title: `Session ${n}`,
    createdAt: "2026-11-25T10:00:00.000Z",
    updatedAt: "2026-11-25T10:00:00.000Z",
    modelRef: null,
    mode: "ask",
    status: "idle",
    archived: false,
    ...(parent === undefined
      ? {}
      : { delegation: { parentSessionId: id(parent), turnId: `turn-${n}`, status: outcome ?? "completed" } }),
    ...rest,
  };
}

async function render(
  sessions: SessionSummary[],
  props: {
    active?: string;
    move?: (id: string, offset: -1 | 1) => Promise<boolean>;
    select?: (id: string) => void;
    openLinked?: (id: string) => void;
  } = {},
) {
  await act(async () => i18n.changeLanguage("en"));
  if (!container) {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  }
  const client = new QueryClient();
  await act(async () =>
    root?.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(SessionList, {
          workbenchId,
          sessions,
          active: props.active,
          select: props.select ?? vi.fn(),
          openLinked: props.openLinked,
          create: vi.fn(),
          rename: async () => true,
          remove: async () => true,
          archive: async () => true,
          move: props.move ?? (async () => true),
          disabled: false,
        }),
      ),
    ),
  );
  return container as HTMLDivElement;
}
const row = (view: HTMLElement, n: number) => view.querySelector<HTMLElement>(`[data-session="${id(n)}"]`);
const group = (view: HTMLElement, n: number) =>
  view.querySelector<HTMLElement>(`[data-session-children="${id(n)}"]`);
const toggle = (view: HTMLElement, n: number) =>
  view.querySelector<HTMLButtonElement>(`[data-session-toggle="${id(n)}"]`);

it("nests delegated children under a listed parent and keeps other sessions top-level", async () => {
  const view = await render([
    session(1),
    session(2, { parent: 1, outcome: "running" }),
    session(4),
    session(3, { parent: 1 }),
    session(5, { parent: 7 }),
    session(6, { parent: 8 }),
    session(8, { archived: true }),
  ]);
  expect(
    [...(group(view, 1)?.querySelectorAll<HTMLElement>("[data-session]") ?? [])].map(
      (b) => b.dataset.session,
    ),
  ).toEqual([id(2), id(3)]);
  expect(group(view, 1)?.getAttribute("role")).toBe("group");
  expect(group(view, 1)?.getAttribute("aria-label")).toBe("Delegated sessions of Session 1");
  // A missing or archived parent leaves its child visible as a top-level row.
  for (const n of [4, 5, 6]) expect(row(view, n)?.closest("[data-session-children]")).toBeNull();
  expect(row(view, 8)?.closest(".archived-sessions")).not.toBeNull();
  expect(toggle(view, 4)).toBeNull();
  expect(row(view, 2)?.querySelector("[data-delegated-status]")?.textContent).toBe("Running");
  expect(row(view, 3)?.querySelector("[data-delegated-status]")?.textContent).toBe("Completed");
});

it("opens a child row through linked navigation and other rows through selection", async () => {
  const select = vi.fn();
  const openLinked = vi.fn();
  const view = await render([session(1), session(2, { parent: 1 })], { select, openLinked });
  await act(async () => row(view, 2)?.click());
  expect(openLinked).toHaveBeenCalledWith(id(2));
  await act(async () => row(view, 1)?.click());
  expect(select).toHaveBeenCalledWith(id(1));
  expect(select).not.toHaveBeenCalledWith(id(2));
});

it("expands and collapses children by mouse and keyboard and remembers collapsed parents", async () => {
  const sessions = [session(1), session(2, { parent: 1 }), session(3, { parent: 1 })];
  let view = await render(sessions);
  const control = toggle(view, 1);
  expect(control?.getAttribute("aria-expanded")).toBe("true");
  expect(control?.getAttribute("aria-label")).toBe("Delegated sessions of Session 1");
  expect(control?.getAttribute("aria-controls")).toBe(group(view, 1)?.id);
  const user = userEvent.setup();
  await user.click(control as HTMLButtonElement);
  expect(control?.getAttribute("aria-expanded")).toBe("false");
  expect(group(view, 1)).toBeNull();
  control?.focus();
  await user.keyboard("{Enter}");
  expect(control?.getAttribute("aria-expanded")).toBe("true");
  expect(row(view, 2)).not.toBeNull();
  await user.keyboard(" ");
  expect(control?.getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(control);
  // Restart: a new sidebar for the same workbench keeps the parent collapsed.
  await act(async () => root?.unmount());
  root = createRoot(container as HTMLDivElement);
  view = await render(sessions);
  expect(toggle(view, 1)?.getAttribute("aria-expanded")).toBe("false");
  expect(row(view, 2)).toBeNull();
});

it("expands a collapsed parent when one of its children becomes active", async () => {
  const sessions = [session(1), session(2, { parent: 1 })];
  let view = await render(sessions);
  await userEvent.setup().click(toggle(view, 1) as HTMLButtonElement);
  expect(row(view, 2)).toBeNull();
  view = await render(sessions, { active: id(2) });
  expect(toggle(view, 1)?.getAttribute("aria-expanded")).toBe("true");
  expect(row(view, 2)?.getAttribute("aria-current")).toBe("page");
  // The reveal happens once per opened session: the user can still collapse the open child's parent.
  await userEvent.setup().click(toggle(view, 1) as HTMLButtonElement);
  expect(toggle(view, 1)?.getAttribute("aria-expanded")).toBe("false");
  view = await render([...sessions], { active: id(2) });
  expect(toggle(view, 1)?.getAttribute("aria-expanded")).toBe("false");
  expect(row(view, 2)).toBeNull();
});

it("shows the most urgent child state on a collapsed parent", async () => {
  const sessions = [
    session(1),
    session(2, { parent: 1, status: "running" }),
    session(3, { parent: 1, status: "awaiting_approval" }),
    session(4),
    session(5, { parent: 4 }),
  ];
  let view = await render(sessions);
  expect(view.querySelector("[data-session-child-attention]")).toBeNull();
  const user = userEvent.setup();
  await user.click(toggle(view, 1) as HTMLButtonElement);
  await user.click(toggle(view, 4) as HTMLButtonElement);
  const attention = row(view, 1)?.querySelector("[data-session-child-attention]");
  expect(attention?.getAttribute("data-session-child-attention")).toBe("awaiting_approval");
  expect(row(view, 1)?.textContent).toContain("Delegated session: Awaiting approval");
  // Idle children need no attention.
  expect(row(view, 4)?.querySelector("[data-session-child-attention]")).toBeNull();
  const urgent = () =>
    row(view, 1)
      ?.querySelector("[data-session-child-attention]")
      ?.getAttribute("data-session-child-attention");
  // A waiting question outranks an approval; a failure outranks a running child.
  view = await render([
    ...sessions.slice(0, 2),
    { ...sessions[2], pendingQuestionId: "qst_01ARZ3NDEKTSV4RRFFQ69G5FAV" } as SessionSummary,
  ]);
  expect(urgent()).toBe("awaiting_question");
  view = await render([...sessions.slice(0, 2), { ...sessions[2], status: "error" } as SessionSummary]);
  expect(urgent()).toBe("error");
  // Expanded again, the parent no longer repeats its children's state.
  await user.click(toggle(view, 1) as HTMLButtonElement);
  expect(row(view, 1)?.querySelector("[data-session-child-attention]")).toBeNull();
});

it("moves sessions among their siblings and disables Move at a sibling-group edge", async () => {
  const move = vi.fn(async () => true);
  const view = await render([session(1), session(2, { parent: 1 }), session(3, { parent: 1 }), session(4)], {
    move,
  });
  const menu = (n: number) => row(view, n)?.closest(".session-entry")?.querySelector(".session-actions");
  const action = (n: number, name: string) =>
    menu(n)?.querySelector<HTMLButtonElement>(`[data-action="move-session-${name}"]`);
  expect(action(2, "up")?.disabled).toBe(true);
  expect(action(2, "down")?.disabled).toBe(false);
  expect(action(3, "down")?.disabled).toBe(true);
  // The parent's next top-level sibling is session 4, past its children.
  expect(action(1, "down")?.disabled).toBe(false);
  expect(action(4, "up")?.disabled).toBe(false);
  expect(action(4, "down")?.disabled).toBe(true);
  await act(async () => action(2, "down")?.click());
  expect(move).toHaveBeenCalledWith(id(2), 1);
});

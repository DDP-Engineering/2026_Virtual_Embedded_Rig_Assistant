// @vitest-environment jsdom
// REQ-UX-a318156e
import { emptySessionState } from "@vera/shared";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import i18n from "../../i18n.js";
import { HelpContext } from "../help.js";
import { Transcript } from "./transcript.js";

vi.mock("../../api/index.js", () => ({ api: { invoke: vi.fn().mockResolvedValue({}) } }));
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

it("opens a cited help page in Help instead of the document viewer", async () => {
  await i18n.changeLanguage("en");
  const state = emptySessionState();
  state.items.push({
    kind: "assistant",
    id: "answer",
    turnId: "turn",
    text: "Switch modes in the composer [[help:permissions]] and see [[help:plugin/serial-monitor]].",
    streaming: false,
    citations: [
      { ref: "help:permissions", valid: true },
      { ref: "help:plugin/serial-monitor", valid: true },
    ],
  });
  const open = vi.fn();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(
      createElement(
        HelpContext.Provider,
        { value: open },
        createElement(Transcript, {
          state,
          detail: "verbose",
          reasoning: {},
          updates: {},
          retry: () => {},
          search: "",
          sessionId: "session",
        }),
      ),
    ),
  );
  const chips = [...container.querySelectorAll<HTMLElement>('[data-citation-kind="help"]')];
  expect(chips).toHaveLength(2);
  await act(async () => chips[0]?.click());
  await act(async () => chips[1]?.click());
  expect(open.mock.calls).toEqual([["permissions"], ["plugin/serial-monitor"]]);
  await act(async () => root.unmount());
  container.remove();
});

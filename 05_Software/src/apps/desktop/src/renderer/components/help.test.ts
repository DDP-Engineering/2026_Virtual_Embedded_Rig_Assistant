// @vitest-environment jsdom
// REQ-UX-3de89feb, REQ-UX-2eb10026
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Request } from "@vera/shared";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "../api/index.js";
import i18n from "../i18n.js";
import { HelpView, helpCitationKey } from "./help.js";
import { Markdown } from "./session/markdown.js";

vi.mock("../api/index.js", () => ({ api: { invoke: vi.fn() } }));
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close = function () {
  this.removeAttribute("open");
};
const pages: Record<string, string> = {
  "en/index": "# VERA help\n\nStart with [Permissions](permissions.md) or [the web](https://example.com/).\n",
  "en/permissions": "# Permissions\n\nRead-only.\n",
  "fr/index": "# Aide de VERA\n\nVoir [Autorisations](permissions.md).\n",
};
let root: Root;
let container: HTMLDivElement;
afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  vi.clearAllMocks();
  await i18n.changeLanguage("en");
});
function serve() {
  vi.mocked(api.invoke).mockImplementation((async (channel: string, request: unknown) => {
    if (channel === "help.list") {
      const { language } = request as Request<"help.list">;
      return ["index", "permissions"].map((page) => {
        const served = pages[`${language}/${page}`] ? language : "en";
        return { page, title: /^# (.+)$/m.exec(pages[`${served}/${page}`] ?? "")?.[1], language: served };
      });
    }
    const { page, language } = request as { page: string; language: string };
    const served = pages[`${language}/${page}`] ? language : "en";
    const content = pages[`${served}/${page}`] ?? "";
    return { page, language: served, title: /^# (.+)$/m.exec(content)?.[1], content };
  }) as never);
}
function Harness() {
  const [page, setPage] = useState("index");
  return createElement(HelpView, { page, open: setPage });
}
async function render() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client }, createElement(Harness)));
  });
}

it("lists pages on the right and renders the page in the interface language, else English", async () => {
  await i18n.changeLanguage("fr");
  serve();
  await render();
  await vi.waitFor(() => expect(container.querySelector(".help-page h1")?.textContent).toBe("Aide de VERA"));
  expect(api.invoke).toHaveBeenCalledWith("help.read", { page: "index", language: "fr" });
  const list = [...container.querySelectorAll<HTMLButtonElement>(".help-pages [data-help-page]")];
  expect(list.map((entry) => entry.textContent)).toEqual(["Aide de VERA", "Permissions"]);
  expect(list[0]?.getAttribute("aria-current")).toBe("page");
  // The page list follows the page in document order, so it sits on the right.
  const view = container.querySelector(".help-view");
  expect(view?.firstElementChild?.classList.contains("help-page")).toBe(true);
  await act(async () => list[1]?.click());
  await vi.waitFor(() => expect(container.querySelector(".help-page h1")?.textContent).toBe("Permissions"));
  expect(container.querySelector('[data-help-page="permissions"]')?.getAttribute("aria-current")).toBe(
    "page",
  );
});

it("opens another help page from an internal link and keeps external links confirmed", async () => {
  serve();
  await render();
  await vi.waitFor(() => expect(container.querySelector(".help-page h1")?.textContent).toBe("VERA help"));
  expect(container.querySelector(".help-page [data-web-source]")?.getAttribute("data-web-source")).toBe(
    "https://example.com/",
  );
  await act(async () =>
    container.querySelector<HTMLElement>('.help-page [data-help-link="permissions"]')?.click(),
  );
  await vi.waitFor(() => expect(container.querySelector(".help-page h1")?.textContent).toBe("Permissions"));
});

// REQ-UX-a318156e
it("shows an issued help citation as a valid chip whose key opens the page in Help", async () => {
  expect(helpCitationKey("help:permissions")).toBe("permissions");
  expect(helpCitationKey("help:plugin/serial-monitor")).toBe("plugin/serial-monitor");
  expect(helpCitationKey("docs/a.pdf#p=2")).toBeUndefined();
  const opened: string[] = [];
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(Markdown, {
        text: "See [[help:permissions]].",
        citations: [{ ref: "help:permissions", valid: true }],
        onCitation: (ref: string) => opened.push(helpCitationKey(ref) ?? ref),
      }),
    );
  });
  const chip = container.querySelector<HTMLElement>('[data-citation="valid"][data-citation-kind="help"]');
  expect(chip?.textContent).toContain("permissions");
  await act(async () => chip?.click());
  expect(opened).toEqual(["permissions"]);
});

// REQ-UX-d753f9fb
import { expect, it } from "vitest";
import { screenHelpPage } from "./help-pages.js";

const home = {
  help: false,
  settings: false,
  section: "appearance",
  plugins: false,
  workbench: false,
  chat: false,
};
it("maps every screen to the help page that explains it", () => {
  expect(screenHelpPage(home)).toBe("getting-started");
  expect(screenHelpPage({ ...home, help: true, settings: true })).toBe("index");
  expect(screenHelpPage({ ...home, settings: true, section: "providers" })).toBe("providers");
  expect(screenHelpPage({ ...home, settings: true, section: "shortcuts" })).toBe("shortcuts");
  for (const section of ["web", "appearance", "notifications", "updates", "data", "about"])
    expect(screenHelpPage({ ...home, settings: true, section })).toBe("settings");
  expect(screenHelpPage({ ...home, plugins: true, workbench: true })).toBe("plugins");
  expect(screenHelpPage({ ...home, workbench: true })).toBe("workbenches");
  expect(screenHelpPage({ ...home, workbench: true, chat: true })).toBe("chat-and-sessions");
});

/** What is on screen, as far as F1 needs it. */
export interface HelpScreen {
  help: boolean;
  settings: boolean;
  /** The Settings section shown while `settings` is true. */
  section: string;
  plugins: boolean;
  /** A workbench overview, New Workbench or the workbench editor is shown. */
  workbench: boolean;
  chat: boolean;
}

/** The help page that explains the current screen, for F1 (REQ-UX-d753f9fb). */
export function screenHelpPage(screen: HelpScreen): string {
  if (screen.help) return "index";
  if (screen.settings)
    return screen.section === "providers"
      ? "providers"
      : screen.section === "shortcuts"
        ? "shortcuts"
        : "settings";
  if (screen.plugins) return "plugins";
  if (screen.chat) return "chat-and-sessions";
  return screen.workbench ? "workbenches" : "getting-started";
}

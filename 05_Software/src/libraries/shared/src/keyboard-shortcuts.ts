import { z } from "zod";

export const shortcutCommands = [
  "newSession",
  "newWorkbench",
  "openWorkbench",
  "settings",
  "shortcuts",
  "toggleSidebar",
  "toggleRightPanel",
  "find",
  "focusComposer",
  "focusModel",
] as const;
export type ShortcutCommand = (typeof shortcutCommands)[number];
export const defaultShortcuts: Record<ShortcutCommand, readonly string[]> = {
  newSession: ["Mod+N", "Mod+Shift+O"],
  newWorkbench: [],
  openWorkbench: ["Mod+O"],
  settings: ["Mod+,"],
  shortcuts: ["Mod+/"],
  toggleSidebar: ["Mod+B", "Mod+Shift+S"],
  toggleRightPanel: ["Mod+Shift+B"],
  find: ["Mod+F"],
  focusComposer: [],
  focusModel: ["Mod+Shift+M"],
};
export type ShortcutOverrides = Partial<Record<ShortcutCommand, string[]>>;
// Preserve native editing, window and reload commands. Other aliases are app-local.
const reserved = new Set([
  "Mod+A",
  "Mod+C",
  "Mod+V",
  "Mod+X",
  "Mod+Z",
  "Mod+Y",
  "Mod+Q",
  "Mod+W",
  "Mod+R",
  "Mod+Shift+Z",
  "Mod+Shift+W",
  "Mod+Shift+Q",
  "Mod+Shift+R",
  "Mod+Shift+I",
  "Mod+Shift+J",
]);
export const shortcutBindingSchema = z
  .string()
  .regex(/^Mod\+(?:Alt\+)?(?:Shift\+)?[A-Z0-9,/]$/)
  .refine((value) => !reserved.has(value), "reserved shortcut");
export function commandBindings(command: ShortcutCommand, overrides?: ShortcutOverrides): readonly string[] {
  return overrides?.[command] ?? defaultShortcuts[command];
}
export const shortcutOverridesSchema = z
  .partialRecord(z.enum(shortcutCommands), z.array(shortcutBindingSchema).max(4))
  .superRefine((overrides, context) => {
    const used = new Set<string>();
    for (const command of shortcutCommands)
      for (const binding of commandBindings(command, overrides)) {
        if (used.has(binding))
          context.addIssue({ code: "custom", path: [command], message: "shortcut conflict" });
        used.add(binding);
      }
  });

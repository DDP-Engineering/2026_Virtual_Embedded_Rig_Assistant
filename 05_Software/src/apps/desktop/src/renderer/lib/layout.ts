import { z } from "zod";

export const layoutKey = "vera.ui.layout";
export const layoutSchema = z.strictObject({
  version: z.literal(1),
  sidebar: z.number().min(12).max(24),
  right: z.number().min(14).max(28),
  // The Source tab has its own wider width; a layout saved before it existed takes the default.
  source: z.number().min(20).max(90).default(36),
  sidebarCollapsed: z.boolean(),
  rightCollapsed: z.boolean(),
});
export type Layout = z.infer<typeof layoutSchema>;
export const defaultLayout: Layout = {
  version: 1,
  sidebar: 17,
  right: 22,
  source: 36,
  sidebarCollapsed: false,
  rightCollapsed: true,
};
export function readLayout(storage: Pick<Storage, "getItem">): { layout: Layout; readOnly: boolean } {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(layoutKey) ?? "null");
    if (
      parsed &&
      typeof parsed === "object" &&
      "version" in parsed &&
      typeof parsed.version === "number" &&
      parsed.version > 1
    )
      return { layout: { ...defaultLayout }, readOnly: true };
    const result = layoutSchema.safeParse(parsed);
    return { layout: result.success ? result.data : { ...defaultLayout }, readOnly: false };
  } catch {
    return { layout: { ...defaultLayout }, readOnly: false };
  }
}
export function saveLayout(storage: Pick<Storage, "setItem">, layout: Layout, readOnly: boolean): void {
  if (readOnly) return;
  try {
    storage.setItem(layoutKey, JSON.stringify(layoutSchema.parse(layout)));
  } catch {
    /* Unavailable storage keeps this view functional. */
  }
}

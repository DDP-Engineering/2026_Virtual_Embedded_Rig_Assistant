import { z } from "zod";

export const layoutKey = "vera.ui.layout";
export const layoutSchema = z.strictObject({
  version: z.literal(1),
  sidebar: z.number().min(12).max(24),
  right: z.number().min(14).max(28),
  sidebarCollapsed: z.boolean(),
  rightCollapsed: z.boolean(),
});
export type Layout = z.infer<typeof layoutSchema>;
export const defaultLayout: Layout = {
  version: 1,
  sidebar: 17,
  right: 22,
  sidebarCollapsed: false,
  rightCollapsed: true,
};
/** The stored layout, or the defaults when it is missing or not in the current format. */
export function readLayout(storage: Pick<Storage, "getItem">): Layout {
  try {
    const result = layoutSchema.safeParse(JSON.parse(storage.getItem(layoutKey) ?? "null"));
    return result.success ? result.data : { ...defaultLayout };
  } catch {
    return { ...defaultLayout };
  }
}
export function saveLayout(storage: Pick<Storage, "setItem">, layout: Layout): void {
  try {
    storage.setItem(layoutKey, JSON.stringify(layoutSchema.parse(layout)));
  } catch {
    /* Unavailable storage keeps this view functional. */
  }
}

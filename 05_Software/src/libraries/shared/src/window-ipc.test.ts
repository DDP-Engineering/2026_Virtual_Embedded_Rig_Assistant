import { expect, it } from "vitest";
import { channels } from "./ipc.js";

it("accepts only fixed native menu roles and bounded window-local coordinates", () => {
  const channel = channels["window.menu" as keyof typeof channels];
  expect(channel).toBeDefined();
  for (const menu of ["file", "edit", "view", "help"])
    expect(channel?.request.safeParse({ menu, x: 8, y: 40 }).success).toBe(true);
  for (const request of [
    { menu: "file", x: -1, y: 40 },
    { menu: "file", x: 1.5, y: 40 },
    { menu: "file", x: 8, y: 40000 },
    { menu: "execute", x: 8, y: 40 },
    { menu: "file", x: 8, y: 40, template: [] },
  ])
    expect(channel?.request.safeParse(request).success).toBe(false);
});

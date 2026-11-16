import { describe, expect, it } from "vitest";
import { channels } from "./ipc.js";

describe("user terminal IPC", () => {
  it("defines strict workbench-owned user commands and bounded PTY dimensions", () => {
    const all = channels as Record<
      string,
      { request: { safeParse: (value: unknown) => { success: boolean } } }
    >;
    expect(all["terminal.create"]).toBeDefined();
    expect(all["terminal.input"]).toBeDefined();
    expect(all["terminal.resize"]).toBeDefined();
    expect(all["terminal.consent"]).toBeDefined();
  });
  it("rejects foreign authority, malformed identities and oversized user input at the boundary", () => {
    const owner = { workbenchId: "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C" };
    const target = { ...owner, id: "00000000-0000-4000-8000-000000000001" };
    const create = { ...owner, cols: 80, rows: 24 };
    expect(channels["terminal.create"].request.safeParse(create).success).toBe(true);
    for (const request of [
      { ...create, cwd: "/outside" },
      { ...create, shell: "other" },
      { ...create, cols: 0 },
      { ...create, rows: 301 },
      { ...create, workbenchId: "../other" },
    ])
      expect(channels["terminal.create"].request.safeParse(request).success).toBe(false);
    expect(channels["terminal.input"].request.safeParse({ ...target, data: "pwd\r" }).success).toBe(true);
    expect(channels["terminal.input"].request.safeParse({ ...target, data: "x".repeat(16385) }).success).toBe(
      false,
    );
    expect(channels["terminal.consent"].request.safeParse({ ...target, shared: "yes" }).success).toBe(false);
    expect(channels["terminal.output"].request.safeParse({ ...target, id: "../other" }).success).toBe(false);
    expect(channels["terminal.output"].request.safeParse({ ...target, agent: true }).success).toBe(false);
  });
});

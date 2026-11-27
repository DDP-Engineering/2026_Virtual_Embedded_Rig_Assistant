import { describe, expect, it } from "vitest";
import { channels } from "./ipc.js";

describe("user terminal IPC", () => {
  it("bounds clipboard text and accepts only explicit shell blocks on owned terminal targets", () => {
    expect(
      channels["app.clipboard.write"].request.parse({ text: "Știință 🧪\r\n```bash\nls\n```" }).text,
    ).toContain("🧪");
    for (const input of [{ text: 3 }, { text: "x".repeat(10_000_001) }, { text: "x", read: true }])
      expect(channels["app.clipboard.write"].request.safeParse(input).success).toBe(false);
    const request = {
      workbenchId: "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C",
      id: "00000000-0000-4000-8000-000000000001",
      shell: "powershell",
      text: "Get-Content README.MD -TotalCount 10",
    };
    expect(channels["terminal.execute"].request.safeParse(request).success).toBe(true);
    for (const invalid of [
      { ...request, shell: "typescript" },
      { ...request, text: "" },
      { ...request, text: "x".repeat(16385) },
      { ...request, text: "\u001b[200~" },
      { ...request, workbenchId: "../other" },
      { ...request, cwd: "/outside" },
    ])
      expect(channels["terminal.execute"].request.safeParse(invalid).success).toBe(false);
  });
  it("requires host-reported dispatch eligibility on terminal summaries and snapshots", () => {
    const summary = {
      id: "00000000-0000-4000-8000-000000000001",
      number: 1,
      shell: "bash",
      shared: false,
      running: true,
    };
    for (const dispatchEligible of [true, false]) {
      const terminal = { ...summary, dispatchEligible };
      const revision = { output: 7, masking: 1 };
      expect(channels["terminal.list"].response.safeParse([terminal]).success).toBe(true);
      expect(
        channels["terminal.output"].response.safeParse({ ...terminal, output: "$ ", start: 0, revision })
          .success,
      ).toBe(true);
      const unchanged = { ...terminal, revision, start: 0, output: "", unchanged: true };
      expect(channels["terminal.output"].response.safeParse(unchanged).success).toBe(true);
      expect(channels["terminal.output"].response.safeParse({ ...unchanged, output: "buffer" }).success).toBe(
        false,
      );
    }
    for (const terminal of [summary, { ...summary, dispatchEligible: "yes" }])
      expect(channels["terminal.list"].response.safeParse([terminal]).success).toBe(false);
  });
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
    expect(
      channels["terminal.output"].request.safeParse({ ...target, revision: { output: 2, masking: 0 } })
        .success,
    ).toBe(true);
    for (const revision of [
      { output: -1, masking: 0 },
      { output: 1 },
      { output: 1, masking: 0, agent: true },
    ])
      expect(channels["terminal.output"].request.safeParse({ ...target, revision }).success).toBe(false);
  });
});

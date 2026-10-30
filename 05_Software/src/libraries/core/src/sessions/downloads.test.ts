// REQ-SEC-1a37ade3, REQ-FUNC-b975a8b5, REQ-DATA-fd1933a1
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PermissionMode } from "@vera/shared";
import { afterEach, expect, it, vi } from "vitest";
import * as core from "../index.js";
import { ReplayGateway } from "../llm/replay.js";

const closes: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of closes.splice(0).reverse()) await close();
});
async function setup(mode: PermissionMode = "ask", disabledTools: string[] = []) {
  const root = await mkdtemp(join(tmpdir(), "vera-pdf-session-"));
  closes.push(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".vera"));
  await mkdir(join(root, "scripts"));
  const url = "https://datasheets.example.org/chip.pdf";
  await writeFile(
    join(root, "scripts/download.jsonl"),
    [
      { toolCalls: [{ name: "web_download", args: { url, filename: "chip.pdf" } }] },
      { text: "Download complete." },
    ]
      .map((step) => JSON.stringify(step))
      .join("\n"),
  );
  const handle = await core.openDb(join(root, ".vera/vera.db"), { workbenchId: "wb_test", appVersion: "0" });
  closes.push(async () => handle.close());
  const settings = { enabled: true, provider: "brave" as const, authentication: "api-key" as const };
  const access = new core.ConfiguredWebProvider({ config: () => settings, getKey: async () => undefined });
  closes.push(() => access.close());
  const transfer = vi.fn(async (_source: string, _signal: AbortSignal) => ({
    data: Buffer.from("%PDF-1.7\nfixture"),
    finalUrl: url,
  }));
  const downloads = new core.PdfDownloads(root, {
    access,
    transfer,
    pdf: async () => ({ kind: "pdf", pages: ["Datasheet"] }),
  });
  const gateway = new ReplayGateway({ dir: join(root, "scripts"), now: () => Date.now() });
  await gateway.models("replay", new AbortController().signal);
  const catalogs: string[][] = [];
  const host: core.SessionHost = {
    root,
    db: handle.db,
    downloads,
    disabledTools,
    gateway: {
      models: (id, signal) => gateway.models(id, signal),
      selectedModel: (id) => gateway.selectedModel(id),
      capabilities: (id) => gateway.capabilities(id),
      async *stream(request) {
        catalogs.push(request.tools?.map((tool) => tool.name) ?? []);
        yield* gateway.stream(request);
      },
    },
    clock: { now: () => new Date(), sleep: async () => {} },
    model: () => "replay/download",
    prompt: () => "Test PDF download",
  };
  const service = new core.SessionService(host);
  closes.push(() => service.close());
  await service.waitReady();
  const session = service.create(null, mode);
  return { root, handle, service, session, downloads, transfer, host, settings, access, catalogs };
}
async function waiting(service: core.SessionService, id: string) {
  await expect
    .poll(() => service.get(id).snapshot.approvals.find((approval) => !approval.decision))
    .toBeDefined();
  const approval = service.get(id).snapshot.approvals.find((entry) => !entry.decision);
  if (!approval) throw Error("Missing PDF approval");
  return approval;
}
it.each(["approved", "denied"] as const)(
  "Ask %s binds the source/destination and sends no request before approval",
  async (decision) => {
    const h = await setup();
    h.service.send(h.session.id, "Download this datasheet");
    const approval = await waiting(h.service, h.session.id);
    expect(h.transfer).not.toHaveBeenCalled();
    expect(approval).toMatchObject({
      tool: "web_download",
      download: { url: "https://datasheets.example.org/chip.pdf", maxBytes: 100 * 1024 * 1024 },
    });
    expect(approval.path).toMatch(/^\.vera\/downloads\/[a-f0-9-]+\/chip.pdf$/);
    const stored = h.handle.db.prepare("SELECT request_json FROM approvals").get() as {
      request_json: string;
    };
    expect(JSON.parse(stored.request_json)).toMatchObject({
      beforeSha256: null,
      afterSha256: null,
      protected: true,
    });
    h.service.decideApproval({
      sessionId: h.session.id,
      approvalId: approval.approvalId,
      requestSha256: approval.requestSha256,
      decision,
    });
    expect(await h.service.waitIdle(h.session.id)).toEqual({ stopReason: "end" });
    expect(h.transfer).toHaveBeenCalledTimes(decision === "approved" ? 1 : 0);
    expect(await h.service.listDownloads()).toHaveLength(decision === "approved" ? 1 : 0);
    if (decision === "approved") {
      const tool = h.service.get(h.session.id).snapshot.items.find((entry) => entry.kind === "tool");
      expect(tool).toMatchObject({ name: "web_download", status: "ok" });
      expect(JSON.stringify(tool)).not.toContain("%PDF-");
      await h.service.delete(h.session.id);
      expect(await h.service.listDownloads()).toHaveLength(1);
    }
  },
);
it("keeps protected managed downloads behind approval in Auto-edit", async () => {
  const h = await setup("auto-edit");
  h.service.send(h.session.id, "Download PDF");
  await waiting(h.service, h.session.id);
  expect(h.transfer).not.toHaveBeenCalled();
  h.service.stop(h.session.id);
  await h.service.waitIdle(h.session.id);
});
it("uses existing Bypass approval without weakening the managed destination", async () => {
  const h = await setup("bypass");
  h.service.send(h.session.id, "Download PDF");
  await h.service.waitIdle(h.session.id);
  expect(h.transfer).toHaveBeenCalledOnce();
  expect(h.service.get(h.session.id).snapshot.approvals).toEqual([
    expect.objectContaining({ tool: "web_download", decision: "approved", by: "mode" }),
  ]);
  expect((await h.service.listDownloads())[0]?.path).toMatch(/^\.vera\/downloads\//);
});
it.each(["read-only", "disabled"] as const)(
  "hides %s downloads from the model and rejects fabricated calls",
  async (restriction) => {
    const h = await setup(
      restriction === "read-only" ? "read-only" : "bypass",
      restriction === "disabled" ? ["web_download"] : [],
    );
    h.service.send(h.session.id, "Try to download");
    await h.service.waitIdle(h.session.id);
    expect(h.catalogs.flat()).not.toContain("web_download");
    expect(h.transfer).not.toHaveBeenCalled();
    expect(await h.service.listDownloads()).toEqual([]);
  },
);
it("rechecks tool availability after approval and before publication", async () => {
  const h = await setup();
  h.service.send(h.session.id, "Download PDF");
  const approval = await waiting(h.service, h.session.id);
  h.host.disabledTools = ["web_download"];
  h.service.decideApproval({
    sessionId: h.session.id,
    approvalId: approval.approvalId,
    requestSha256: approval.requestSha256,
    decision: "approved",
  });
  await h.service.waitIdle(h.session.id);
  expect(h.transfer).not.toHaveBeenCalled();
  expect(await h.service.listDownloads()).toEqual([]);
});
it("revokes a running download when the session changes from Bypass", async () => {
  const h = await setup("bypass");
  h.transfer.mockImplementation(
    async (_url, signal) =>
      new Promise((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
      ),
  );
  h.service.send(h.session.id, "Download PDF");
  await vi.waitFor(() => expect(h.transfer).toHaveBeenCalledOnce());
  h.service.setMode(h.session.id, "ask");
  await h.service.waitIdle(h.session.id);
  expect(await h.service.listDownloads()).toEqual([]);
});

// REQ-DATA-fd1933a1, REQ-SEC-1a37ade3, REQ-FUNC-4c3f4f0c
import { expect, it } from "vitest";
import { downloadApprovalSchema, pdfDownloadSchema } from "./downloads.js";
import { sessionEventSchema } from "./events.js";
import { channels } from "./ipc.js";

const downloadId = "f203834e-881c-40da-940d-432276c10d04";
const workbenchId = `wb_${"0".repeat(26)}`;
it("validates scoped UUID requests and excludes arbitrary paths and launch arguments", () => {
  expect(channels["downloads.open"].request.safeParse({ workbenchId, downloadId }).success).toBe(true);
  for (const request of [
    { downloadId },
    { workbenchId, downloadId: "../escape.pdf" },
    { workbenchId, downloadId, path: "C:/outside.pdf" },
    { workbenchId, downloadId, external: true },
  ])
    expect(channels["downloads.open"].request.safeParse(request).success).toBe(false);
});
it("requires a matching immutable managed path and bounded PDF metadata", () => {
  const record = {
    downloadId,
    name: "chip.pdf",
    path: `.vera/downloads/${downloadId}/chip.pdf`,
    sessionId: `ses_${"0".repeat(26)}`,
    callId: "pdf-call",
    sourceUrl: "https://example.org/chip.pdf",
    finalUrl: "https://example.org/chip.pdf",
    mime: "application/pdf",
    bytes: 100,
    pages: 2,
    sha256: "a".repeat(64),
    createdAt: "2026-10-30T12:00:00.000Z",
  };
  expect(pdfDownloadSchema.safeParse(record).success).toBe(true);
  for (const patch of [
    { path: "docs/chip.pdf" },
    { name: "../chip.pdf" },
    { bytes: 100 * 1024 * 1024 + 1 },
    { mime: "text/html" },
    { pages: 0 },
    { sha256: "unknown" },
    { data: "base64-not-allowed" },
  ])
    expect(pdfDownloadSchema.safeParse({ ...record, ...patch }).success).toBe(false);
});
it("requires source and budget in PDF approvals and forbids misleading file diffs", () => {
  const approval = {
    type: "approval.requested",
    approvalId: "apv",
    callId: "call",
    requestSha256: "a".repeat(64),
    tool: "web_download",
    path: ".vera/downloads/id/chip.pdf",
    bytes: 0,
    diff: "",
  };
  expect(sessionEventSchema.safeParse(approval).success).toBe(false);
  const download = { url: "https://example.org/chip.pdf", maxBytes: 100 * 1024 * 1024 };
  expect(sessionEventSchema.safeParse({ ...approval, download }).success).toBe(true);
  expect(sessionEventSchema.safeParse({ ...approval, download, bytes: 999 }).success).toBe(false);
  expect(sessionEventSchema.safeParse({ ...approval, download, tool: "write" }).success).toBe(false);
  expect(downloadApprovalSchema.safeParse({ ...download, url: "file:///outside.pdf" }).success).toBe(false);
});

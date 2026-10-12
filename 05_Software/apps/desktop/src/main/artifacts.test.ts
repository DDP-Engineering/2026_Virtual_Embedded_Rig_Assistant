// REQ-FUNC-5ece91b7 REQ-FUNC-8c00fdea
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionService } from "@vera/core";
import { veraError } from "@vera/shared";
import { afterEach, expect, it, vi } from "vitest";
import { exportArtifact, publicArtifact, revealArtifact } from "./artifacts.js";

const cleanup: string[] = [];
afterEach(async () => {
  for (const p of cleanup.splice(0)) await rm(p, { recursive: true, force: true });
});
it("reveals only the freshly verified ordinary artifact path", () => {
  const verify = vi.fn(() => ({
    path: "/ordinary/summary.md",
    artifact: { name: "summary.md", content: "ă" },
  }));
  const service = { verifiedArtifact: verify } as unknown as SessionService;
  const show = vi.fn();
  expect(revealArtifact(service, "id", show)).toEqual({});
  expect(verify).toHaveBeenCalledWith("id");
  expect(show).toHaveBeenCalledWith("/ordinary/summary.md");
  verify.mockImplementation(() => {
    throw veraError("DENIED");
  });
  expect(() => revealArtifact(service, "id", show)).toThrow(expect.objectContaining({ code: "DENIED" }));
  expect(show).toHaveBeenCalledTimes(1);
});
it("cancels without writing and verifies source again after dialog before exporting scrubbed UTF8", async () => {
  const root = await mkdtemp(join(tmpdir(), "vera-export-"));
  cleanup.push(root);
  await mkdir(join(root, ".vera"));
  const verify = vi.fn(() => ({
    path: join(root, ".vera/artifacts/s/summary.md"),
    artifact: { name: "summary.md", content: "ă secret" },
  }));
  const service = { verifiedArtifact: verify } as unknown as SessionService;
  const write = vi.fn(async () => {});
  expect(
    await exportArtifact(service, "id", { root, choose: async () => null, write, scrub: (s) => s }),
  ).toEqual({ exported: false });
  expect(write).not.toHaveBeenCalled();
  const target = join(root, "export.md");
  expect(
    await exportArtifact(service, "id", {
      root,
      choose: async (name) => {
        expect(name).toBe("summary.md");
        return target;
      },
      write,
      scrub: (s) => s.replace("secret", "[redacted]"),
    }),
  ).toEqual({ exported: true });
  expect(write).toHaveBeenCalledWith(target, "ă [redacted]");
  expect(verify).toHaveBeenCalledTimes(3);
  await expect(
    exportArtifact(service, "id", {
      root,
      choose: async () => {
        verify.mockImplementation(() => {
          throw veraError("CONFLICT");
        });
        return target;
      },
      write,
      scrub: (s) => s,
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(write).toHaveBeenCalledTimes(1);
});
it("refuses managed runtime destinations including redirected parents", async () => {
  const root = await mkdtemp(join(tmpdir(), "vera-export-"));
  cleanup.push(root);
  await mkdir(join(root, ".vera"));
  await symlink(join(root, ".vera"), join(root, "alias"), "junction");
  const service = {
    verifiedArtifact: () => ({ path: "source", artifact: { name: "summary.md", content: "test" } }),
  } as unknown as SessionService;
  const write = vi.fn(async () => {});
  for (const target of [
    join(root, ".vera/new.md"),
    join(root, "alias/new.md"),
    join(root, ".vera/..export.md"),
    join(root, "alias/..export.md"),
    join(root, ".vera/..folder/report.md"),
    join(root, "alias/..folder/report.md"),
  ])
    await expect(
      exportArtifact(service, "id", { root, choose: async () => target, write, scrub: (s) => s }),
    ).rejects.toMatchObject({ code: "DENIED" });
  expect(write).not.toHaveBeenCalled();
  const outside = join(root, "..export.md");
  expect(
    await exportArtifact(service, "id", { root, choose: async () => outside, write, scrub: (s) => s }),
  ).toEqual({ exported: true });
  expect(write).toHaveBeenCalledWith(outside, "test");
});

it("scrubs public descriptions and content while preserving protocol metadata and refusing secret names", () => {
  const artifact = {
    artifactId: "art_01K7A0V0000000000000000000",
    sessionId: "ses_01K7A0V0000000000000000000",
    name: "summary.md",
    mime: "text/markdown" as const,
    bytes: 12,
    sha256: "a".repeat(64),
    description: "secret note",
    createdAt: "2026-10-12T10:00:00.000Z",
    content: "secret text",
  };
  const scrub = (s: string) => s.replaceAll("secret", "[redacted]");
  expect(publicArtifact(artifact, scrub)).toEqual({
    ...artifact,
    description: "[redacted] note",
    content: "[redacted] text",
  });
  expect(artifact.content).toBe("secret text");
  expect(() => publicArtifact({ ...artifact, name: "secret.md" }, scrub)).toThrow(
    expect.objectContaining({ code: "INVALID" }),
  );
  expect(publicArtifact({ ...artifact, description: null }, scrub).description).toBeNull();
});

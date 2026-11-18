import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { runCatalog } from "./catalog.js";

it("catalog sign warns when the signing key is not checked against a public key", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vera-catalog-sign-"));
  const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  try {
    const privateKey = join(dir, "private.pem"),
      publicKey = join(dir, "public.pem");
    expect(await runCatalog({ kind: "catalog-keygen", privateKey, publicKey })).toBe(0);
    for (const name of ["index-stable.json", "index-pre-release.json"])
      await writeFile(join(dir, name), "{}\n");
    expect(await runCatalog({ kind: "catalog-sign", release: dir, key: privateKey, publicKey })).toBe(0);
    expect(stderr).not.toHaveBeenCalled();
    expect(await runCatalog({ kind: "catalog-sign", release: dir, key: privateKey })).toBe(0);
    expect(String(stderr.mock.calls[0]?.[0])).toMatch(/warning: the signing key was not checked.*--public/);
  } finally {
    stderr.mockRestore();
    stdout.mockRestore();
    await rm(dir, { recursive: true, force: true });
  }
});

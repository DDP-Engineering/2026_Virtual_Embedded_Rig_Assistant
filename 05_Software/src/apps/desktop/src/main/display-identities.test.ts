import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { DisplayIdentities, loadDisplayIdentityKey } from "./display-identities.js";

it("reopens opaque paths with the persisted format-1 key, binding workbench, folder and parent", () => {
  const root = mkdtempSync(join(tmpdir(), "vera-display-"));
  try {
    const file = join(root, "display-identities.json");
    const first = new DisplayIdentities(loadDisplayIdentityKey(file));
    const owner = "wb-A\n/bench";
    const a = first.encode(owner, "docs/mqtt-password-one.txt");
    const b = first.encode(owner, "docs/mqtt-password-two.txt");
    expect(a).not.toBe(b);
    expect(a).not.toContain("mqtt-password");
    const restarted = new DisplayIdentities(loadDisplayIdentityKey(file));
    expect(restarted.decode(owner, a)).toBe("docs/mqtt-password-one.txt");
    expect(restarted.encode(owner, "docs/mqtt-password-one.txt")).toBe(a);
    for (const wrong of ["wb-B\n/bench", "wb-A\n/other"])
      expect(() => restarted.decode(wrong, a)).toThrowError();
    const altered = `${a.slice(0, -5)}abcd.`;
    expect(() => restarted.decode(owner, altered)).toThrowError();
    const moved = `other/${a.split("/")[1]}`;
    expect(() => restarted.decode(owner, moved)).toThrowError();
    expect(JSON.parse(readFileSync(file, "utf8")).schemaVersion).toBe(1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("replaces a damaged key file with a new key instead of failing, and reuses it afterwards", () => {
  const root = mkdtempSync(join(tmpdir(), "vera-display-"));
  try {
    const file = join(root, "display-identities.json");
    const warn = vi.fn();
    const original = loadDisplayIdentityKey(file, warn);
    // A first start creates the key without a warning.
    expect(warn).not.toHaveBeenCalled();
    const damaged = ["", "{", JSON.stringify({ schemaVersion: 2, key: "a".repeat(64) })];
    for (const [index, content] of damaged.entries()) {
      writeFileSync(file, content);
      const key = loadDisplayIdentityKey(file, warn);
      expect(warn).toHaveBeenCalledTimes(index + 1);
      expect(warn).toHaveBeenLastCalledWith("display.identities.key.replaced");
      expect(key).toHaveLength(32);
      expect(key.equals(original)).toBe(false);
      expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ schemaVersion: 1, key: key.toString("hex") });
      expect(loadDisplayIdentityKey(file, warn).equals(key)).toBe(true);
    }
    expect(warn).toHaveBeenCalledTimes(damaged.length);
    // The temporary file of the atomic write does not stay behind.
    expect(readdirSync(root)).toEqual(["display-identities.json"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("still returns a key for this run when the key file cannot be written", () => {
  const root = mkdtempSync(join(tmpdir(), "vera-display-"));
  try {
    // A directory in the key file's place can be neither read nor replaced.
    const file = join(root, "display-identities.json");
    mkdirSync(file);
    const warn = vi.fn();
    expect(loadDisplayIdentityKey(file, warn)).toHaveLength(32);
    expect(warn).toHaveBeenLastCalledWith("display.identities.key.unsaved");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("roundtrips ordinary descendants of literal identity-prefix folders", () => {
  const identities = new DisplayIdentities(Buffer.alloc(32, 1));
  for (const path of ["__vera_display_notes/child.txt", "docs/__vera_display_notes/nested/child.txt"])
    expect(
      identities.decode(
        "wb\n/owned",
        identities.encode("wb\n/owned", path, () => false),
      ),
    ).toBe(path);
});

it("keeps ordinary prefix names raw and separates ciphertext from valid host path syntax", () => {
  const identities = new DisplayIdentities(Buffer.alloc(32, 1));
  expect(identities.decode("owner", "__vera_display_notes/child.txt")).toBe("__vera_display_notes/child.txt");
  expect(identities.encode("owner", "__vera_display_notes/child.txt", () => false)).toBe(
    "__vera_display_notes/child.txt",
  );
  expect(identities.encode("owner", "private.txt")).toMatch(/\.$/);
});

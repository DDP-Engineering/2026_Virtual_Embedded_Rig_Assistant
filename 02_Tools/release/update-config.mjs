import { createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Build input only. Production feeds are HTTPS; instrumented probes may use loopback HTTP. */
export function updateFeed(value = "", testBuild = false) {
  if (!value) return "";
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid update feed build setting");
  }
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(testBuild && loopback && url.protocol === "http:")) ||
    url.username ||
    url.password ||
    url.hash ||
    url.search
  )
    throw new Error("Invalid update feed build setting");
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url.href;
}
/** Build input only: the default plugin catalog folder, under the same rule as the update feed. */
export function pluginCatalogFeed(value = "", testBuild = false) {
  try {
    return updateFeed(value, testBuild);
  } catch {
    throw new Error("Invalid plugin catalog build setting");
  }
}
/** The catalog signing public key committed with the build tools; its private key never enters a repository. */
export const catalogSigningKeyFile = fileURLToPath(new URL("catalog-signing-key.pub.pem", import.meta.url));
/**
 * Build input only: the Ed25519 public key (SPKI PEM) that remote catalog indexes must be signed for,
 * read from the file `path` (`VERA_PLUGIN_CATALOG_KEY`), else the committed key file.
 */
export function pluginCatalogKey(path = "") {
  try {
    const text = readFileSync(path || catalogSigningKeyFile, "utf8");
    const key = createPublicKey(text);
    // createPublicKey also derives a public key from a private one, which must never be a build input.
    if (
      !/^-----BEGIN PUBLIC KEY-----/m.test(text) ||
      /PRIVATE KEY/.test(text) ||
      key.asymmetricKeyType !== "ed25519"
    )
      throw new Error();
    return key.export({ type: "spki", format: "pem" }).toString();
  } catch {
    throw new Error("Invalid plugin catalog key build setting");
  }
}
export function updatePublish(value, testBuild = false) {
  const url = updateFeed(value, testBuild);
  return url ? [{ provider: "generic", url, channel: "latest" }] : null;
}

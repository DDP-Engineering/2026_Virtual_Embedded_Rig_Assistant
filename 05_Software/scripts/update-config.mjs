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
export function updatePublish(value, testBuild = false) {
  const url = updateFeed(value, testBuild);
  return url ? [{ provider: "generic", url, channel: "latest" }] : null;
}

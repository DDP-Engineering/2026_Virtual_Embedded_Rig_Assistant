import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { strToU8, unzipSync, zipSync } from "fflate";
import { afterEach, beforeEach, expect, test } from "vitest";

const tools = `${process.cwd()}/../02_Tools/delivery`;
const components = await import(/* @vite-ignore */ pathToFileURL(`${tools}/components.mjs`).href);
const common = await import(/* @vite-ignore */ pathToFileURL(`${tools}/delivery-common.mjs`).href);

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const pinned = (text: string) => {
  const bytes = strToU8(text);
  return { bytes: bytes.length, sha256: sha256(bytes), data: bytes };
};
const sources = new Map<string, Uint8Array>();
const chrome = (name: string, text: string) => {
  const url = `https://storage.googleapis.com/chrome-for-testing-public/1.2.3.4/${name.replace(".zip", "").slice(7)}/${name}`;
  const { data, ...pin } = pinned(text);
  sources.set(url, data);
  return { name, url, version: "1.2.3.4", ...pin };
};
const model = (id: string, text: string) => ({
  id,
  name: `${id}.zip`,
  repository: `Xenova/${id}`,
  revision: "8".repeat(40),
  license: "Apache-2.0",
  files: ["config.json", "onnx/model.onnx"].map((path) => {
    const url = `https://huggingface.co/Xenova/${id}/resolve/${"8".repeat(40)}/${path}?download=true`;
    const { data, ...pin } = pinned(`${text}:${path}`);
    sources.set(url, data);
    return { path, url, ...pin };
  }),
});
const pins = {
  browsers: [chrome("chrome-win64.zip", "windows chrome"), chrome("chrome-linux64.zip", "linux chrome")],
  models: [model("whisper-base", "base"), model("whisper-small", "small")],
};
const served =
  (change: (url: string, bytes: Uint8Array) => Uint8Array | Response = (_url, bytes) => bytes) =>
  async (url: string) => {
    const bytes = sources.get(url);
    if (!bytes) return new Response(null, { status: 404 });
    const result = change(url, bytes);
    return result instanceof Response ? result : new Response(result.slice());
  };
const apache = "Apache License\nVersion 2.0, January 2004\nTERMS AND CONDITIONS\n";

let folder: string;
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "vera-components-"));
});
afterEach(async () => {
  await rm(folder, { recursive: true, force: true });
});
const delivery = () => ({
  folder,
  version: "1.0.0",
  desktopVersion: "1.0.0",
  commit: "abc1234",
  dirty: false,
});
const write = (options: { replace?: boolean; fetch?: ReturnType<typeof served> } = {}) =>
  components.writeComponentsPart(delivery(), { pins, apache, fetch: served(), ...options });

// REQ-FUNC-102c1232
test("the components part holds the pinned Chrome ZIPs, one ZIP per model, notices and SHA256SUMS", async () => {
  const files = await write();
  const part = join(folder, "components");
  expect((await readdir(part)).sort()).toEqual([
    "SHA256SUMS",
    "THIRD-PARTY-NOTICES.md",
    "chrome-linux64.zip",
    "chrome-win64.zip",
    "whisper-base.zip",
    "whisper-small.zip",
  ]);
  expect(await common.checkSums(part)).toEqual([]);
  expect(files.map((file: { path: string }) => file.path)).toEqual(
    (await readdir(part)).filter((name) => name !== "SHA256SUMS").sort(),
  );
  expect(await readFile(join(part, "chrome-win64.zip"), "utf8")).toBe("windows chrome");
  const members = unzipSync(new Uint8Array(await readFile(join(part, "whisper-small.zip"))));
  expect(Object.keys(members).sort()).toEqual(["config.json", "onnx/model.onnx"]);
  expect(new TextDecoder().decode(members["onnx/model.onnx"])).toBe("small:onnx/model.onnx");
  expect(await components.verifyComponents(part, { pins })).toEqual([]);
  const manifest = JSON.parse(await readFile(join(folder, "delivery.json"), "utf8"));
  expect(manifest.parts.components).toMatchObject({
    version: "1.0.0",
    commit: "abc1234",
    chromeForTesting: "1.2.3.4",
    models: { "whisper-base": "8".repeat(40), "whisper-small": "8".repeat(40) },
  });
  expect(manifest.parts.components.files).toEqual(
    files.map((file: { path: string }) => ({ ...file, path: `components/${file.path}` })),
  );
  await expect(write()).rejects.toThrow(/--replace/);
  expect(await common.checkSums(part)).toEqual([]);
  expect(existsSync(join(folder, ".staging-components"))).toBe(false);
});

// REQ-DATA-4365c89e
test("the notices name each component with its version, source and licence and carry the Apache text", async () => {
  await write();
  const notices = await readFile(join(folder, "components", "THIRD-PARTY-NOTICES.md"), "utf8");
  expect(notices).toContain("Google Chrome for Testing 1.2.3.4");
  expect(notices).toContain("https://googlechromelabs.github.io/chrome-for-testing/");
  expect(notices).toContain("Google Chrome Terms of Service");
  for (const id of ["whisper-base", "whisper-small"]) {
    expect(notices).toContain(`https://huggingface.co/Xenova/${id}`);
    expect(notices).toContain(`\`${id}.zip\``);
  }
  expect(notices).toContain(`revision \`${"8".repeat(40)}\``);
  expect(notices.match(/- Licence: Apache License 2\.0, printed below/g)).toHaveLength(2);
  expect(notices).toContain("## Apache License 2.0");
  expect(notices.endsWith(apache)).toBe(true);
});

// REQ-REL-2bd264e3
test.each([
  [
    "a changed byte",
    "chrome-linux64.zip",
    served((url, bytes) => (url.endsWith("chrome-linux64.zip") ? strToU8("linux chromf") : bytes)),
  ],
  [
    "a truncated file",
    "whisper-small.zip: onnx/model.onnx",
    served((url, bytes) =>
      url.includes("whisper-small/") && url.includes("onnx") ? bytes.slice(0, 3) : bytes,
    ),
  ],
  [
    "a failed request",
    "whisper-base.zip: config.json",
    served((url, bytes) =>
      url.includes("whisper-base/") && url.includes("config") ? new Response(null, { status: 503 }) : bytes,
    ),
  ],
  [
    "an unreachable host",
    "chrome-win64.zip",
    async (url: string) => {
      if (url.endsWith("chrome-win64.zip")) throw new TypeError("fetch failed");
      return served()(url);
    },
  ],
] as const)(
  "%s fails the build with the file named and keeps the earlier part",
  async (_case, label, fetch) => {
    await write();
    const before = await readFile(join(folder, "components", "SHA256SUMS"), "utf8");
    await expect(write({ replace: true, fetch })).rejects.toThrow(label);
    expect(await readFile(join(folder, "components", "SHA256SUMS"), "utf8")).toBe(before);
    expect(await common.checkSums(join(folder, "components"))).toEqual([]);
    expect((await readdir(folder)).sort()).toEqual(["components", "delivery.json"]);
  },
);

// REQ-REL-596aeb8a
test("verification names a part that differs from the Desktop pins", async () => {
  await write();
  const part = join(folder, "components");
  const verify = () => components.verifyComponents(part, { pins });
  const original = await readFile(join(part, "chrome-win64.zip"));
  await writeFile(join(part, "chrome-win64.zip"), "windows chromf");
  expect(await verify()).toEqual(["chrome-win64.zip: differs from its pin"]);
  await writeFile(join(part, "chrome-win64.zip"), original);
  const base = await readFile(join(part, "whisper-base.zip"));
  await writeFile(
    join(part, "whisper-base.zip"),
    zipSync({
      "config.json": strToU8("base:config.json"),
      "onnx/model.onnx": strToU8("base:onnx/model.onnz"),
    }),
  );
  expect(await verify()).toEqual(["whisper-base.zip: onnx/model.onnx differs from its pin"]);
  await writeFile(
    join(part, "whisper-base.zip"),
    zipSync({ ...unzipSync(new Uint8Array(base)), LICENSE: strToU8("x") }),
  );
  expect(await verify()).toEqual(["whisper-base.zip: LICENSE is not a pinned model file"]);
  await writeFile(join(part, "whisper-base.zip"), zipSync({ "config.json": strToU8("base:config.json") }));
  expect(await verify()).toEqual(["whisper-base.zip: onnx/model.onnx missing"]);
  await writeFile(join(part, "whisper-base.zip"), base);
  await rm(join(part, "THIRD-PARTY-NOTICES.md"));
  await writeFile(join(part, "extra.txt"), "extra");
  expect(await verify()).toEqual(["THIRD-PARTY-NOTICES.md: missing", "extra.txt: unexpected file"]);
});

test("the default pins are the Chrome for Testing and Whisper pins compiled into Desktop", async () => {
  const { browserRelease } = await import("../../src/apps/desktop/src/main/browser/release.js");
  const { dictationCatalog } = await import("../../src/apps/desktop/src/main/dictation/catalog.js");
  const defaults = components.componentPins();
  expect(defaults.browsers.map((item: { name: string }) => item.name)).toEqual([
    "chrome-win64.zip",
    "chrome-linux64.zip",
  ]);
  expect(defaults.browsers[0]).toMatchObject({
    url: browserRelease("win32", "x64")?.url,
    bytes: browserRelease("win32", "x64")?.archiveBytes,
    sha256: browserRelease("win32", "x64")?.archiveSha256,
  });
  expect(defaults.browsers[1].sha256).toBe(browserRelease("linux", "x64")?.archiveSha256);
  expect(defaults.models.map((item: { name: string }) => item.name)).toEqual([
    "whisper-base.zip",
    "whisper-small.zip",
  ]);
  expect(defaults.models[1].files).toHaveLength(dictationCatalog[1]?.files.length ?? 0);
  expect(defaults.models[1].files[0].url).toBe(
    `https://huggingface.co/Xenova/whisper-small/resolve/${dictationCatalog[1]?.revision}/${dictationCatalog[1]?.files[0]?.path}?download=true`,
  );
});

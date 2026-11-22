// REQ-SEC-b4170ade
import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, join } from "node:path";
import { expect, it } from "vitest";

it("disables ONNX Runtime telemetry as the main process's first module, before any inference host", async () => {
  // An ambient setting that keeps telemetry on is overridden.
  process.env.ORT_DISABLE_TELEMETRY = "0";
  process.env.ORT_RUNNING_UNIT_TESTS = "0";
  await import("./inference-telemetry.js");
  expect(process.env.ORT_DISABLE_TELEMETRY).toBe("1");
  expect(process.env.ORT_RUNNING_UNIT_TESTS).toBe(process.platform === "win32" ? "1" : "0");
  // Evaluated before every other import of the main process, so the Whisper and embedding workers inherit it.
  const main = await readFile(new URL("./index.ts", import.meta.url), "utf8");
  expect(main.match(/^import\s[^;]*;/m)?.[0]).toBe('import "./inference-telemetry.js";');
});

it("relies only on switches the bundled ONNX Runtime libraries still read", async () => {
  // Windows' DLL reads no ORT_DISABLE_TELEMETRY: with ORT_RUNNING_UNIT_TESTS it never registers its
  // Microsoft-telemetry ETW provider. An upgrade that drops a switch's name fails here.
  const bin = join(dirname(createRequire(import.meta.url).resolve("onnxruntime-node/package.json")), "bin");
  const switches = {
    win32: "ORT_RUNNING_UNIT_TESTS",
    linux: "ORT_DISABLE_TELEMETRY",
    darwin: "ORT_DISABLE_TELEMETRY",
  };
  const library = /^(onnxruntime\.dll|libonnxruntime\.so\.1|libonnxruntime\.\d+\.\d+\.\d+\.dylib)$/;
  const platforms = new Set<string>();
  for (const entry of await readdir(bin, { recursive: true })) {
    if (!library.test(basename(entry))) continue;
    const platform = entry.split(/[\\/]/)[1] as keyof typeof switches;
    expect((await readFile(join(bin, entry))).includes(switches[platform]), entry).toBe(true);
    platforms.add(platform);
  }
  expect([...platforms].sort()).toEqual(["darwin", "linux", "win32"]);
});

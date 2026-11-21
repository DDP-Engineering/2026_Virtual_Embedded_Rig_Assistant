// REQ-SEC-b4170ade
import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";

it("disables ONNX Runtime telemetry as the main process's first module, before any inference host", async () => {
  // An ambient setting that keeps telemetry on is overridden.
  process.env.ORT_DISABLE_TELEMETRY = "0";
  await import("./inference-telemetry.js");
  expect(process.env.ORT_DISABLE_TELEMETRY).toBe("1");
  // Evaluated before every other import of the main process, so the Whisper and embedding workers inherit it.
  const main = await readFile(new URL("./index.ts", import.meta.url), "utf8");
  expect(main.match(/^import\s[^;]*;/m)?.[0]).toBe('import "./inference-telemetry.js";');
});

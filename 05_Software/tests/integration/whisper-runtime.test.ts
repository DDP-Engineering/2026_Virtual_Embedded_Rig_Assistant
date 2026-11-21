import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Worker } from "node:worker_threads";
import { dictationTranscriptSchema } from "@vera/shared";
import { describe, expect, it } from "vitest";

const models = process.env.VERA_DICTATION_MODEL_ROOT;
const build = process.env.VERA_BUILD_ROOT ?? resolve("src/apps/desktop/out");
const clips = {
  en: "open the window",
  ro: "buna dimineata acesta este un test",
  de: "das fenster ist offen",
  fr: "nous sommes mercredi matin",
} as const;

async function fixture(language: keyof typeof clips): Promise<Float32Array> {
  const wav = await readFile(new URL(`../fixtures/dictation/${language}.wav`, import.meta.url));
  expect(wav.subarray(0, 4).toString()).toBe("RIFF");
  expect(wav.readUInt16LE(22)).toBe(1);
  expect(wav.readUInt32LE(24)).toBe(16_000);
  expect(wav.readUInt16LE(34)).toBe(16);
  expect(wav.subarray(36, 40).toString()).toBe("data");
  expect(wav.readUInt32LE(40)).toBe(wav.length - 44);
  return Float32Array.from(
    { length: (wav.length - 44) / 2 },
    (_, sample) => wav.readInt16LE(44 + sample * 2) / 32768,
  );
}

describe.skipIf(!models)("built local Whisper worker", () => {
  for (const id of ["whisper-base", "whisper-small"]) {
    for (const code of ["en", "ro", "de", "fr"] as const) {
      for (const language of ["auto", code]) {
        it(`${id} recognizes ${code} with ${language}`, { timeout: 45_000 }, async () => {
          const worker = new Worker(join(build, "main/whisper-worker.js"), {
            workerData: {
              model: { id, directory: join(models ?? "", id), dtype: "q8", language },
              pcm: await fixture(code),
            },
          });
          try {
            const reply = await new Promise<unknown>((resolve, reject) => {
              worker.once("message", resolve);
              worker.once("error", reject);
              worker.once("exit", (code) => reject(new Error(`Whisper exited with ${code}`)));
            });
            const output = dictationTranscriptSchema.parse(reply);
            expect(output.language).toBe(code);
            const normalized = output.text
              .toLocaleLowerCase(code)
              .normalize("NFD")
              .replace(/\p{M}/gu, "")
              .replace(/[^\p{L}\p{N}]+/gu, " ");
            expect(normalized).toContain(clips[code]);
          } finally {
            await worker.terminate();
          }
        });
      }
    }
  }
});

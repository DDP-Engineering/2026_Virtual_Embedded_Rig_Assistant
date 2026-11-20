import { isMainThread, parentPort, workerData } from "node:worker_threads";
import { dictationLanguageSchema, dictationModelIdSchema, dictationPcmSchema } from "@vera/shared";
import { z } from "zod";
import { transcribeWhisper } from "./whisper.js";

if (isMainThread || !parentPort) throw new Error("Dictation requires an inference worker");

const request = z.strictObject({
  model: z.strictObject({
    id: dictationModelIdSchema,
    directory: z.string().min(1),
    dtype: z.literal("q8"),
    language: dictationLanguageSchema,
  }),
  pcm: dictationPcmSchema,
});
const port = parentPort;
try {
  const { model, pcm } = request.parse(workerData);
  port.postMessage(await transcribeWhisper(model, pcm));
} catch {
  port.postMessage(null);
}

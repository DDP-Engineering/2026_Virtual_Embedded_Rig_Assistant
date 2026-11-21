import { basename, dirname } from "node:path";
import { env, type PreTrainedModel, pipeline, Tensor } from "@huggingface/transformers";
import { type DictationTranscript, dictationLanguageSchema } from "@vera/shared";
import { z } from "zod";
import { dictationCatalog } from "./catalog.js";
import { modelFingerprint, modelHashesMatch } from "./integrity.js";
import type { LocalDictationModel } from "./models.js";

const languageConfig = z.object({
  decoder_start_token_id: z.int().nonnegative(),
  is_multilingual: z.literal(true),
  lang_to_id: z.record(z.string(), z.int().nonnegative()),
});

async function detectLanguage(model: PreTrainedModel, inputFeatures: Tensor) {
  const config = languageConfig.parse(model.generation_config);
  // With only the start-of-transcript token, the next decoder step predicts the language.
  const { logits } = await model.forward({
    input_features: inputFeatures,
    decoder_input_ids: new Tensor("int64", [BigInt(config.decoder_start_token_id)], [1, 1]),
  });
  if (!(logits instanceof Tensor) || logits.dims.length !== 3 || logits.dims[1] !== 1) {
    throw new Error("Expected first-step Whisper logits");
  }
  let winner: DictationTranscript["language"] | undefined;
  let best = -Infinity;
  for (const language of dictationLanguageSchema.options) {
    if (language === "auto") continue;
    const id = config.lang_to_id[`<|${language}|>`];
    const score = id === undefined ? NaN : Number(logits.data[id]);
    if (!Number.isFinite(score)) throw new Error("Missing Whisper language score");
    if (score > best) {
      best = score;
      winner = language;
    }
  }
  if (!winner) throw new Error("Missing Whisper language");
  return winner;
}

/** Loads one pinned multilingual Whisper model inside its single-use inference worker. */
export async function transcribeWhisper(
  model: LocalDictationModel,
  pcm: Float32Array,
): Promise<DictationTranscript> {
  const spec = dictationCatalog.find(({ id }) => id === model.id);
  const fingerprint = spec && (await modelFingerprint(model.directory, spec));
  if (
    !spec ||
    basename(model.directory) !== model.id ||
    !fingerprint ||
    !(await modelHashesMatch(model.directory, spec)) ||
    (await modelFingerprint(model.directory, spec)) !== fingerprint
  ) {
    throw new Error("Dictation model integrity mismatch");
  }
  const denyNetwork = async () => {
    throw new Error("Network forbidden during local dictation");
  };
  globalThis.fetch = denyNetwork;
  env.fetch = denyNetwork;
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = dirname(model.directory);
  env.useFSCache = false;
  env.useBrowserCache = false;

  const recognizer = await pipeline("automatic-speech-recognition", model.id, {
    dtype: model.dtype,
    device: "cpu",
    local_files_only: true,
    session_options: { intraOpNumThreads: 2, interOpNumThreads: 1, executionMode: "sequential" },
  });
  try {
    let language = model.language;
    if (language === "auto") {
      const { input_features } = await recognizer.processor(pcm);
      language = await detectLanguage(recognizer.model, input_features);
    }
    const output = await recognizer(pcm, { task: "transcribe", language });
    if (Array.isArray(output)) throw new Error("Expected a single Whisper transcript");
    return { text: output.text.trim(), language };
  } finally {
    await recognizer.dispose();
  }
}

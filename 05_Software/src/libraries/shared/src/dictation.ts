import { z } from "zod";

export const dictationModelIds = ["whisper-base", "whisper-small"] as const;
export const dictationModelIdSchema = z.enum(dictationModelIds);
export type DictationModelId = z.infer<typeof dictationModelIdSchema>;

/** Language tokens shared by the multilingual Base and Small revisions. */
export const dictationLanguageSchema = z.enum([
  "auto",
  "en",
  "zh",
  "de",
  "es",
  "ru",
  "ko",
  "fr",
  "ja",
  "pt",
  "tr",
  "pl",
  "ca",
  "nl",
  "ar",
  "sv",
  "it",
  "id",
  "hi",
  "fi",
  "vi",
  "he",
  "uk",
  "el",
  "ms",
  "cs",
  "ro",
  "da",
  "hu",
  "ta",
  "no",
  "th",
  "ur",
  "hr",
  "bg",
  "lt",
  "la",
  "mi",
  "ml",
  "cy",
  "sk",
  "te",
  "fa",
  "lv",
  "bn",
  "sr",
  "az",
  "sl",
  "kn",
  "et",
  "mk",
  "br",
  "eu",
  "is",
  "hy",
  "ne",
  "mn",
  "bs",
  "kk",
  "sq",
  "sw",
  "gl",
  "mr",
  "pa",
  "si",
  "km",
  "sn",
  "yo",
  "so",
  "af",
  "oc",
  "ka",
  "be",
  "tg",
  "sd",
  "gu",
  "am",
  "yi",
  "lo",
  "uz",
  "fo",
  "ht",
  "ps",
  "tk",
  "nn",
  "mt",
  "sa",
  "lb",
  "my",
  "bo",
  "tl",
  "mg",
  "as",
  "tt",
  "haw",
  "ln",
  "ha",
  "ba",
  "jw",
  "su",
]);
export type DictationLanguage = z.infer<typeof dictationLanguageSchema>;

export const dictationPreferencesSchema = z.strictObject({
  language: dictationLanguageSchema,
  selectedModel: dictationModelIdSchema.nullable(),
});
export type DictationPreferences = z.infer<typeof dictationPreferencesSchema>;
export const dictationDefaults: DictationPreferences = { language: "auto", selectedModel: null };

const modelSummary = z.strictObject({ id: dictationModelIdSchema, bytes: z.int().positive() });
const downloadFailure = z.enum(["integrity", "network", "space", "storage"]);
export type DictationDownloadFailure = z.infer<typeof downloadFailure>;
const modelState = z.discriminatedUnion("status", [
  modelSummary.extend({ status: z.enum(["missing", "installed", "corrupt", "removal-failed"]) }),
  modelSummary.extend({ status: z.literal("downloading"), receivedBytes: z.int().nonnegative() }),
  modelSummary.extend({ status: z.literal("failed"), failure: downloadFailure, canRemove: z.boolean() }),
]);
export type DictationModelState = z.infer<typeof modelState>;

export const dictationSnapshotSchema = dictationPreferencesSchema.extend({
  models: z.array(modelState).length(dictationModelIds.length),
});
export type DictationSnapshot = z.infer<typeof dictationSnapshotSchema>;

export const dictationChangeSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.enum(["download", "cancel", "select", "remove"]), id: dictationModelIdSchema }),
  z.strictObject({ action: z.literal("language"), language: dictationLanguageSchema }),
]);
export type DictationChange = z.infer<typeof dictationChangeSchema>;

export const dictationSampleRate = 16_000;
export const dictationMaxSeconds = 30;
export const dictationMaxSamples = dictationSampleRate * dictationMaxSeconds;
export const dictationConnectionMs = 15_000;
export const dictationJobIdSchema = z.uuidv4();
export const dictationJobSchema = z.strictObject({ id: dictationJobIdSchema });

/** Bounded, packed mono PCM. Validate before it crosses each process boundary. */
export const dictationPcmSchema = z.custom<Float32Array>(
  (value) =>
    value instanceof Float32Array &&
    value.length <= dictationMaxSamples &&
    value.byteOffset === 0 &&
    value.buffer instanceof ArrayBuffer &&
    value.byteLength === value.buffer.byteLength &&
    value.every((sample) => Number.isFinite(sample) && Math.abs(sample) <= 1),
);
export const dictationSubmitSchema = dictationJobSchema.extend({ pcm: dictationPcmSchema });
export const dictationBeginSchema = z.strictObject({
  status: z.enum(["opening", "busy", "missing-model", "permission-denied", "cancelled"]),
});
export type DictationBegin = z.infer<typeof dictationBeginSchema>;
export const dictationRecordingSchema = z.strictObject({ status: z.enum(["recording", "cancelled"]) });
export type DictationRecording = z.infer<typeof dictationRecordingSchema>;

export const dictationTranscriptSchema = z.strictObject({
  text: z.string().max(16_000),
  language: dictationLanguageSchema.exclude(["auto"]),
});
export type DictationTranscript = z.infer<typeof dictationTranscriptSchema>;

export const dictationOutcomeSchema = z.discriminatedUnion("status", [
  dictationTranscriptSchema.extend({ status: z.literal("complete") }),
  z.strictObject({
    status: z.enum([
      "busy",
      "cancelled",
      "missing-model",
      "permission-denied",
      "microphone-unavailable",
      "microphone-disconnected",
      "no-speech",
      "transcription-failed",
    ]),
  }),
]);
export type DictationOutcome = z.infer<typeof dictationOutcomeSchema>;

import { z } from "zod";

export const embeddingModelDescriptorSchema = z.object({
  modelId: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
  revision: z.string().regex(/^[a-f0-9]{40}$/),
  dtype: z.literal("q8"),
  files: z.array(
    z.object({
      path: z.string().regex(/^[\w.-]+(?:\/[\w.-]+)*$/),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      bytes: z.number().int().positive(),
    }),
  ),
  embedding: z.object({
    dimensions: z.literal(384),
    maxTokens: z.literal(512),
    pooling: z.enum(["cls", "mean"]),
    normalize: z.literal(true),
    queryPrefix: z.string(),
    passagePrefix: z.string(),
  }),
});

/** On-disk descriptor, including the acquisition metadata stripped from the worker model identity. */
export const embeddingModelManifestSchema = embeddingModelDescriptorSchema.extend({
  schema: z.literal(1),
  license: z.string().min(1),
  source: z.url(),
  files: embeddingModelDescriptorSchema.shape.files.element.extend({ url: z.url() }).array().min(1),
});

# IMG — Images in the chat

PURPOSE: let the user give the agent a picture (a schematic, a board photo, a scope screenshot, an error dialog)
in a chat message, and let the agent look at an image file of the workbench, when the chosen model can see images.
STATE: planned 2026-11-15. Product code follows AEGIS, one work package per task.

## Today (2026-11-15)

- A chat message is text only: `session.send {sessionId, text}` (`shared/src/ipc.ts`). Attachments are workbench
  paths sent as `@path` mentions (`renderer/components/session/attachments.tsx`); the agent reads them as text.
- Every model VERA builds declares `input: ["text"]` (`core/src/llm/providers.ts`), although pi-ai can carry
  image content. The ChatGPT catalog already records which models accept images (`core/src/llm/chatgpt-catalog.ts`,
  `input_modalities`); nothing uses it.
- No tool returns an image; `read` refuses binary files.

## Decisions (2026-11-15)

- **Two ways in:** paste or drop an image into the composer (or pick one with an Attach image button), and attach
  an image file of the workbench from the Files tab like any attachment.
- **Pasted images become workbench files** in `.vera/attachments/<session>/` (PNG, JPEG, GIF, WebP), so they are
  durable, exportable and open in the file viewer ([file-viewer.md](file-viewer.md), VIEW-06). The message event
  stores their workbench paths, never the bytes.
- **Sent only to a model that sees images.** Each model has an image capability: from the catalog for ChatGPT,
  from the model list for the OpenAI API, and a per-model "Accepts images" switch for LM Studio, Ollama and other
  OpenAI-compatible endpoints (off by default). With a text-only model, image chips show a warning and the message
  goes out with the paths only; nothing fails silently.
- **Limits:** at most 8 images per message, 20 MiB per file; larger images are scaled down to 2048 px on the long
  side before sending (the stored file keeps the original). SVG is never sent as an image.
- **The agent can look on its own:** a `view_image {path}` tool returns a workbench image to a model that sees
  images, under the same path rules as `read`; it is not offered to a text-only model.
- **Privacy:** an image leaves the computer only like any message to the chosen provider. Secret masking
  ([secret-masking.md](secret-masking.md)) cannot read inside images; the Agent and model area says so in help.
- **Context and compaction:** images count against the context with the provider's estimate; compaction replaces
  an old image with its path and a one-line note, and the agent can view it again.

## Work packages

| WP | Title | Result |
|---|---|---|
| IMG-01 | Image capability per model | `input` set from the ChatGPT catalog, the OpenAI model list and the custom provider's per-model switch (Settings > Providers); shared helper `acceptsImages(model)`; tests per provider kind |
| IMG-02 | Message images | `session.send` takes `images: string[]` (workbench paths, at most 8); `message.queued`/user message events keep them; the session engine sends them as pi-ai image content with scaling and limits; a text-only model gets the paths only; export keeps the paths |
| IMG-03 | Composer | paste, drop and Attach image save into `.vera/attachments/<session>/` through main (confined to the workbench, format checked by signature); image chips with thumbnail, remove and the text-only warning; Files tab attach for image files; en/ro/de/fr |
| IMG-04 | Transcript | user messages show their images as thumbnails that open in the file viewer; a missing file shows its path |
| IMG-05 | `view_image` tool | the agent views a workbench image with a model that sees images; size and format rules of IMG-02; listed in Tools only for such models; help page for the agent |

Order: IMG-01, IMG-02, then IMG-03, IMG-04 and IMG-05 (independent of each other). Help pages (Chat and sessions,
Providers) are updated inside each work package.

## Verification

- Unit: capability per provider kind; limits, scaling and SVG refusal; compaction replaces an old image with its
  path; a text-only model never receives image content.
- Integration: a fake OpenAI-compatible server records the request: images arrive as image parts for a model with
  "Accepts images" on, and as paths only with it off.
- E2E (browser mock and native): paste a screenshot, see the chip and the thumbnail in the transcript, restart and
  find it; drop a file from the Files tab; the warning with a text-only model.

## Out of scope

- Image generation, editing or OCR inside VERA; audio and video; reading text out of images for document search.

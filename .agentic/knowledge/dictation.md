# Local dictation models and settings

## Routing

Select for Whisper Base and Small, the Dictation tab, model downloads, spoken language, or
`DictationModels.resolveSelected`. Start with desktop main `dictation/models.ts` and
`dictation/models.test.ts` under `05_Software/src/apps/desktop/src`.
[Application data](app-data.md) owns general settings and [IPC boundary](ipc-boundary.md)
owns the validated transport.

## Purpose and boundaries

Desktop manages pinned multilingual Whisper q8 model files in application data and exposes
verified paths to local transcription. Settings displays the catalog, progress and selection
in en, ro, de and fr. The model store is independent of workbench and chat-provider settings.

## Public interface

- `dictation.get({})` returns sizes, states and effective selection. `dictation.change` accepts
  download, cancel, select, remove and spoken-language actions and returns the current snapshot.
- Main-side `resolveSelected()` returns `{ id, directory, dtype, language }` or null. The
  language is `auto` or one of the 99 Whisper language codes shared by both revisions.
- Format-1 application settings hold optional `dictation` with a nullable selected model id and
  language. Dedicated IPC writes persist through the settings service.

## Invariants

- Download targets and redirect origins are fixed. Every artifact has pinned length and SHA-256.
- Main writes to staging and verifies the exact filesystem tree before publishing by rename.
  It rejects path aliases and additional files at the runtime boundary.
- One transfer runs at a time. Cancel before publication clears staging. Startup recovery
  clears abandoned staging and attempts to finish interrupted removal. Locked removal remains
  retryable in Settings and unavailable to transcription.
- Metadata snapshots reuse verification while file identities remain stable. Selecting a model
  and resolving its runtime directory both recheck the installed bytes.

## Change map

| Change requested | Start with | Focused verification |
|---|---|---|
| Change pins, file inventory or origin policy | `main/dictation/{catalog,integrity,transfer}.ts` | `models.test.ts`, immutable upstream file receipts |
| Change install, settings or runtime resolution | `main/dictation/models.ts` | `models.test.ts`, `preload/bridge.test.ts` |
| Change model actions, progress or translation | `renderer/components/dictation-settings.tsx` | `dictation-settings.test.ts`, i18n and help checks |

## Key behaviors

- Catalog pins and lifecycle [specification](../specs/REQ-FUNC-8ed9892f.md) cover staged installation,
  insufficient space, cancellation, retry, corruption and removal.
- REQ-FUNC-907c9538 — resolve only verified local runtime inputs.
- REQ-DATA-7b7bacd2, REQ-DATA-a4ee70a4, REQ-DATA-dfe09857 — persist model and language choices and
  clear the removed selection.
- REQ-UX-f01e59f6, REQ-UX-67d8cc7b — localized Settings and model-management help.

## Files

- `src/apps/desktop/src/main/dictation/` — catalog, transfer, integrity, settings coordination and tests.
- `src/libraries/shared/src/{dictation,settings,ipc}.ts` — typed IPC and settings.
- `src/apps/desktop/src/renderer/components/dictation-settings.*` — Settings panel and tests.
- `help/<lang>/settings.md` — model-management help.

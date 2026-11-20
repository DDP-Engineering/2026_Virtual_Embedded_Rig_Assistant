# Local dictation

## Routing

Select for Whisper Base and Small, Dictation Settings, local microphone capture or transcription.
Start with desktop main dictation/models.ts and dictation/capture-jobs.ts, or renderer
dictation/capture.ts, under 05_Software/src/apps/desktop/src.
[Application data](app-data.md) owns general settings and [IPC boundary](ipc-boundary.md)
owns the validated transport.

## Purpose and boundaries

Desktop manages pinned multilingual Whisper q8 model files in application data and exposes
verified paths to local transcription. Settings displays the catalog, progress and selection
in en, ro, de and fr. A dedicated CPU worker runs Whisper. The renderer owns the microphone and
session-bound controller. The model store is independent of workbench and chat-provider settings.

## Public interface

- `dictation.get({})` returns sizes, states and effective selection. `dictation.change` accepts
  download, cancel, select, remove and spoken-language actions and returns the current snapshot.
- Main-side `resolveSelected()` returns `{ id, directory, dtype, language }` or null. The
  language is `auto` or one of the 99 Whisper language codes shared by both revisions.
- Format-1 application settings hold optional `dictation` with a nullable selected model id and
  language. Dedicated IPC writes persist through the settings service.

- The capture controller accepts a session identity, a start call during trusted input, stop,
  cancel and disposal. It publishes opening, recording, transcribing and idle phases. Start
  resolves to a typed outcome. Success includes its originating session key. The composer
  checks that key against its active draft before applying text and disposes on unmount.
- dictation.begin, dictation.recording, dictation.finish and dictation.cancel use a UUID to scope
  one job. Submit carries packed Float32 PCM. Success returns trimmed text and its Whisper
  language code. No-speech, unavailable model, microphone errors, busy, cancel and worker failure
  are distinct outcomes. Native interruption is delivered by an app event keyed to the job.

## Invariants

- Download targets and redirect origins are fixed. Every artifact has pinned length and SHA-256.
- Main writes to staging and verifies the exact filesystem tree before publishing by rename.
  It rejects path aliases and additional files at the runtime boundary.
- One transfer runs at a time. Cancel before publication clears staging. Startup recovery
  clears abandoned staging and attempts to finish interrupted removal. Locked removal remains
  retryable in Settings and unavailable to transcription.
- Metadata snapshots reuse verification while file identities remain stable. Selecting a model
  and resolving its runtime directory both recheck the installed bytes.

- Main admits a single job, pins model and language before permitting microphone access, and blocks
  removal until cleanup. One audio-only request can use the grant. The microphone is released
  before submission and when the renderer loses ownership. Native blur, navigation, renderer
  loss, close and shutdown invalidate the job. A stalled acquisition releases the job on
  timeout or cancellation, and any subsequently acquired stream is stopped on arrival.
- PCM is mono at 16 kHz and limited to 30 seconds. Connection and inference have deadlines.
  Audio stays in memory. The worker checks the pinned file set and hashes before load, disables
  remote model access and exits before the next job starts.
- Explicit language goes directly to transcription. Automatic language selects the highest
  first-step decoder score among the model's 99 language tokens.

## Change map

| Change requested | Start with | Focused verification |
|---|---|---|
| Change pins, file inventory or origin policy | `main/dictation/{catalog,integrity,transfer}.ts` | `models.test.ts`, immutable upstream file receipts |
| Change install, settings or runtime resolution | `main/dictation/models.ts` | `models.test.ts`, `preload/bridge.test.ts` |
| Change model actions, progress or translation | `renderer/components/dictation-settings.tsx` | `dictation-settings.test.ts`, i18n and help checks |

| Change capture, grant or session lifecycle | renderer/dictation/capture.ts, main/dictation/capture-jobs.ts, main/security.ts | capture.test.ts, capture-jobs.test.ts, security-policy.test.ts, dictation.spec.ts |
| Change local inference or worker lifecycle | main/dictation/whisper.ts, whisper-worker.ts, worker-host.ts | worker-host.test.ts, whisper-runtime.test.ts, packaging.test.ts |

## Key behaviors

- Catalog pins and lifecycle [specification](../specs/REQ-FUNC-8ed9892f.md) cover staged installation,
  insufficient space, cancellation, retry, corruption and removal.
- REQ-FUNC-907c9538 — resolve only verified local runtime inputs.
- REQ-DATA-7b7bacd2, REQ-DATA-a4ee70a4, REQ-DATA-dfe09857 — persist model and language choices and
  clear the removed selection.
- REQ-UX-f01e59f6, REQ-UX-67d8cc7b — localized Settings and model-management help.

- REQ-SEC-dc8304bd — gesture-scoped microphone grant.
- REQ-FUNC-a5c31d08, REQ-FUNC-179d51e4, REQ-FUNC-af174598 — local transcription and language selection.
- REQ-FUNC-31029892, REQ-REL-47f336ff, REQ-DATA-7c5ad4db — bounded PCM, invalidation and transient audio.

## Files

- `src/apps/desktop/src/main/dictation/` — catalog, transfer, integrity, settings coordination and tests.
- `src/libraries/shared/src/{dictation,settings,ipc}.ts` — typed IPC and settings.
- `src/apps/desktop/src/renderer/components/dictation-settings.*` — Settings panel and tests.
- `help/<lang>/settings.md` — model-management help.

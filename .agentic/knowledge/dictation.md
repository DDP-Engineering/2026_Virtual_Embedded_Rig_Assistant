# Local dictation

## Routing

Select for Whisper Base and Small, Dictation Settings, composer gestures, local microphone capture
or transcription. Under 05_Software/src/apps/desktop/src, start with desktop main
dictation/models.ts or dictation/capture-jobs.ts, or renderer dictation/use-composer-dictation.ts.
[Application data](app-data.md) owns general settings and [IPC boundary](ipc-boundary.md)
owns the validated transport.

## Purpose and boundaries

Desktop manages pinned multilingual Whisper q8 model files in application data and exposes
verified paths to local transcription. Settings displays the catalog, progress, selection and
input controls in en, ro, de and fr. A dedicated CPU worker runs Whisper. The renderer owns the
microphone, session-bound controller and editable draft insertion. The model store is independent
of workbench and chat-provider settings.

## Public interface

- `dictation.get({})` returns sizes, states and effective selection. `dictation.change` accepts
  download, cancel, select, remove and spoken-language actions and returns the current snapshot.
- Main-side `resolveSelected()` returns `{ id, directory, dtype, language }` or null. The
  language is `auto` or one of the 99 Whisper language codes shared by both revisions.
- Format-1 application settings hold optional `dictation` with a nullable selected model id and
  language. Dedicated IPC writes persist through the settings service.
- App Settings saves `dictationRecordingMode` (hold or toggle, default hold) and the optional
  `keyboardShortcuts.dictate` bindings. The Dictation and Keyboard shortcuts pages share the
  recorder and conflict checks.
- The capture controller accepts a session identity, a start call during trusted input, stop,
  cancel and disposal. It publishes opening, recording, transcribing and idle phases. Start
  resolves to a typed outcome. Success includes its originating session key.
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
- The microphone and the app-local shortcut apply the selected mode. Release ends hold mode,
  including release of a participating modifier. Focus loss or invalidation cancels the job.
  Escape cancels an active dictation before the workspace handles agent Stop.
- The live composer checks the attempt and session before applying a transcript. An unchanged
  draft receives the text at the original selection end, and an edited draft receives it at the
  end. Existing text and attachments are preserved. Send is explicit.

## Change map

| Change requested | Start with | Focused verification |
|---|---|---|
| Change pins, file inventory or origin policy | `main/dictation/{catalog,integrity,transfer}.ts` | `models.test.ts`, immutable upstream file receipts |
| Change install, settings or runtime resolution | `main/dictation/models.ts` | `models.test.ts`, `preload/bridge.test.ts` |
| Change model actions, progress or translation | `renderer/components/dictation-settings.tsx` | `dictation-settings.test.ts`, i18n and help checks |
| Change input gestures or draft handling | `renderer/dictation/use-composer-dictation.ts`, `renderer/components/session/composer.tsx` | `dictation-composer.spec.ts`, `dictation-packaged-composer.spec.ts` |
| Change capture, grant or session lifecycle | renderer/dictation/capture.ts, main/dictation/capture-jobs.ts, main/security.ts | capture.test.ts, capture-jobs.test.ts, security-policy.test.ts, dictation.spec.ts |
| Change local inference or worker lifecycle | main/dictation/whisper.ts, whisper-worker.ts, worker-host.ts; the worker inherits the main process env (ORT_DISABLE_TELEMETRY, and ORT_RUNNING_UNIT_TESTS on Windows, from `main/inference-telemetry.ts`), so never pass it an `env` without that opt-out | worker-host.test.ts, whisper-runtime.test.ts, packaging.test.ts, main/inference-telemetry.test.ts |

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
- REQ-UX-91e43161, REQ-FUNC-91e43162, REQ-UX-91e43163, REQ-REL-91e43164 — input modes and shortcut conflicts.
- REQ-UX-91e43165, REQ-REL-91e43166 — localized status and Escape precedence.
- REQ-DATA-91e43167, REQ-REL-91e43168 — draft insertion and invalidation.

## Files

- `src/apps/desktop/src/main/dictation/` — catalog, transfer, integrity, settings coordination and tests.
- `src/libraries/shared/src/{dictation,settings,ipc}.ts` — typed IPC and settings.
- `src/apps/desktop/src/renderer/components/dictation-settings.*` — Settings panel and tests.
- `src/apps/desktop/src/renderer/dictation/` — capture, composer gestures and draft insertion.
- `src/apps/desktop/src/renderer/components/session/dictation-button.tsx` — microphone, cancellation and feedback.
- `help/<lang>/{settings,chat-and-sessions,shortcuts}.md` — model management and composer use.

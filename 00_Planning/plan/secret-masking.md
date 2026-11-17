# MASK — Secret masking per area and per workbench

PURPOSE: let the user decide, for each area and each workbench, whether VERA replaces stored secrets with
`[REDACTED]`, so the user sees all information by default and masking is a choice.
STATE: MASK-01 #280 infrastructure implemented and committed in f78c1de6599a876c7990c04047abd16288ffa7a2 (TASK-6170ebf2; proof: evaluation-outputs/mask01).
MASK-02 #281 Display committed in cb8f0bcd15d9895c51d5d222ceb9b33f780daba8 (TASK-cfee41bb; proof: evaluation-outputs/mask02). MASK-03 #282 Program runs committed in be4e3120d747c5b2e2c78ea617417c7166605e4d (TASK-bea71615; proof: evaluation-outputs/mask03). MASK-04 #283 committed in ae08f837637f7d9c6626372e1535226ceb90f2cd (TASK-4912fc24; proof: evaluation-outputs/mask04). MASK-05 #284 implemented in TASK-1c503009 (proof: evaluation-outputs/mask05); all five packages are implemented. Product code follows AEGIS, one work package per task.

## Today (2026-11-17)

Stored secrets are registered with the unconditional credential scrubber. MASK-01 stores strict optional
app booleans and workbench choices and supplies the live resolver; all four consumer areas now follow
that resolver. Provider failures, connection tests, logging, credential admission and child-environment
filtering retain their unconditional protection. MASK-05 exposes the settings controls with explicit drafts, live inherited labels and an effective agent-off confirmation.

| Area | Where | What is masked |
|---|---|---|
| Display | `desktop/src/main/index.ts` | Files/Find and document list/search retain all results with separate opaque identities; names and viewer text (`docs.read`) follow live Display |
| Program runs | `desktop/src/main/run-presentation.ts`, `terminals.ts` | run args, commands/canonical folders, errors, tail/full logs, program statuses and user terminal snapshots follow live runs (default off); agent terminal reads follow the independent agent choice with consent rechecks |
| Agent and model | `core/src/sessions/service.ts`, `core/src/llm/stream-scrub.ts` | tool results sent to the model, the model's streamed text, session search and presentation |
| Artifacts and exports | `core/src/artifacts/store.ts`, `desktop/src/main/artifacts.ts` | saved artifacts, exported artifacts and sessions |

Previously saved redacted content cannot be recovered by disabling masking; a fresh read or recreation
from original source is required. Raw execution arguments remain separate from presentation and saved
session projections, so Agent and model does not dictate artifact bytes.

Provider error messages and the connection test also mask; they protect the key of the provider that failed and
stay always on.

## Decisions (2026-11-15)

- **Four areas, each on or off:** Display, Program runs, Agent and model, Artifacts and exports.
- **Defaults follow the user's access:** Display and Program runs are off (the user sees everything); Agent and
  model and Artifacts and exports are on, because their content leaves the computer (a model provider, a shared
  file). The user can change each.
- **App defaults plus a per-workbench choice.** Settings > Data & privacy holds the app defaults. Edit workbench >
  Data & privacy sets each area to Default (follow the app), On or Off for that workbench. The workbench choice is
  stored in `.vera/workbench.yaml` (`privacy.mask.<area>`), so it travels with a copied workbench; the format
  stays 1 (pre-release policy).
- **Masking never hides that something exists:** with Display on, the Files tab and Find list every entry with
  its name masked instead of dropping it.
- **Turning Agent and model off asks for confirmation** in the editor, naming that stored secrets found in files
  or tool output can then be sent to the model provider. No other area asks.
- **One resolver:** `maskingFor(workbench, area)` in core decides from the workbench choice and the app default;
  every place that masks today calls it instead of masking unconditionally.

## Work packages

| WP / issue | Title | Result |
|---|---|---|
| MASK-01 #280 | Settings and resolver | `privacy.mask` app defaults in `settings.json` (`display`, `runs`, `agent`, `exports`) with the defaults above; `privacy.mask` in the workbench config (`default`, `on`, `off` per area); `maskingFor` in core with unit tests for every combination |
| MASK-02 #281 | Display area | Files tab, Find, document lists and `docs.read` (and the viewer's `docs.readBytes` from VIEW-01) mask only when Display resolves on; entries are never dropped, names are masked instead |
| MASK-03 #282 | Program runs area | run arguments, errors, logs and program statuses mask only when Program runs resolves on |
| MASK-04 #283 | Agent and model, Artifacts and exports | the session engine passes the resolved Agent and model choice to tool results, the stream scrubber and session search; artifact saving and artifact and session exports follow Artifacts and exports |
| MASK-05 #284 | Settings pages | Settings > Data & privacy: four switches for the app defaults; Edit workbench > Data & privacy: four choices (Default, On, Off) showing the inherited value; the confirmation for Agent and model off; Save and Cancel at the top right; texts in en, ro, de, fr and the help pages updated |

Epic: MASK #279. TERM #311 is complete through `f0ba3040bac0c76fbd2de72d836ce9d21ee2378c`; masking preserves its prefixes and additional folders.

Order: MASK-01 #280 first; MASK-02, MASK-03 and MASK-04 after it, independent of each other; MASK-05 last. VIEW-01 of
the [file viewer plan](file-viewer.md) reads its masking from MASK-02.

## Verification

- Unit: `maskingFor` for app default on/off × workbench default/on/off in every area; an unknown value in
  `workbench.yaml` is invalid data like any other.
- Integration: with a stored MQTT password in a fixture workbench, Display off shows it in the viewer and a file
  named after it in the Files tab; Display on masks both and still lists the file; Agent and model on sends the
  model `[REDACTED]` in a read tool result, off sends the value; a program run log follows Program runs.
- E2E: the two settings pages, inheritance shown in the workbench editor, the confirmation for Agent and model
  off, and a second workbench keeping its own choices.

## Out of scope

- Masking values that are not stored secrets (for example a key typed directly into a file the user never
  stored), and the provider error and connection-test masking, which stay always on.

## Integrated implementation evidence and remaining gates

MASK-05 TASK-1c503009 completes both Settings pages, new-workbench inheritance, four-language controls/help,
agent disclosure confirmation and independent workbench persistence. Native `privacy-settings.spec.ts`
checks real files and process restart; focused component tests cover stale async reads, live defaults,
dirty gating, Cancel/Escape focus, failed saves and read-only controls. Original logs/screenshots/receipts
are retained under `05_Software/evaluation-outputs/mask05/`; the task journal records exact commands,
counts, independent review verdicts and final static/strict results. Its implementation state is done;
the coordinator owns the local ticket commit and child/epic closure.

MASK-01–04 consumer proof remains valid for unchanged core/host paths. TERM physical PTY/package closure
proof is reused without rebuilding selected delivery artifacts. No full app, official-plugin or complete
E2E suite, native Ubuntu, clean-install or exact-current-source final delivery gate is claimed; all remain
user-deferred. WSL2 pinned Linux Node proof from the predecessor packages is distinct from native Ubuntu.

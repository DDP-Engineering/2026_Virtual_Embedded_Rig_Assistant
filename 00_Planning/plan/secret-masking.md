# MASK — Secret masking per area and per workbench

PURPOSE: let the user decide, for each area and each workbench, whether VERA replaces stored secrets with
`[REDACTED]`, so the user sees all information by default and masking is a choice.
STATE: MASK-01 #280 infrastructure implemented and committed in f78c1de6599a876c7990c04047abd16288ffa7a2 (TASK-6170ebf2; proof: evaluation-outputs/mask01).
MASK-02 #281 Display implemented in TASK-cfee41bb (candidate; focused proof: evaluation-outputs/mask02; final validation in its journal). MASK-03–05 remain planned. Product code follows AEGIS, one work package per task.

## Today (2026-11-17)

Stored secrets (provider keys, plugin credentials such as MQTT, Wokwi or parts-supplier keys) are always masked by
`credentials.scrub` (`core/src/llm/scrub.ts`). MASK-01 stores optional strict app booleans and workbench
choices and supplies a live-settings resolver; Display consumers follow the resolver; remaining consumers scrub unconditionally until MASK-03–04:

| Area | Where | What is masked |
|---|---|---|
| Display | `desktop/src/main/index.ts` | Files/Find and document list/search retain all results with separate opaque identities; names and viewer text (`docs.read`) follow live Display |
| Program runs | `desktop/src/main/index.ts` | run arguments, errors and logs shown in the Runs tab, program statuses |
| Agent and model | `core/src/sessions/service.ts`, `core/src/llm/stream-scrub.ts` | tool results sent to the model, the model's streamed text, session search |
| Artifacts and exports | `core/src/artifacts/store.ts`, `desktop/src/main/artifacts.ts` | saved artifacts, exported artifacts and sessions |

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

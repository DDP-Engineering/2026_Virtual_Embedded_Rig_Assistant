# TASK-2c5054ba - ELEC-03 parts-search plugin: supplier catalog search and evidence-based component selection (#95)

stage: done
type: feature
path: full
interaction: autopilot
requirements: REQ-DATA-9fd50acb, REQ-DATA-6b26f2a5, REQ-FUNC-7b42ac37, REQ-FUNC-c5cb293b, REQ-SEC-1518625d, REQ-REL-d9f0b8da, REQ-SEC-2ccecd75, REQ-SEC-597d9e43, REQ-REL-ee71e2b0, REQ-REL-94d8d0ca, REQ-REL-a953f579, REQ-REL-51a2423d, REQ-REL-375c4622, REQ-FUNC-244f9aef, REQ-FUNC-e6ac90ad, REQ-FUNC-cec25871, REQ-UX-664afc86, REQ-SEC-ddb16bb1, REQ-FUNC-fd5a2a7b, REQ-FUNC-2ed99e46, REQ-FUNC-98175a73, REQ-FUNC-f2b0b6c6, REQ-FUNC-a08310ed, REQ-FUNC-99ee75ad, REQ-FUNC-384a082a, REQ-FUNC-84309105, REQ-FUNC-1d01263c, REQ-FUNC-8dfa1ca5, REQ-FUNC-4a4d8cf2, REQ-REL-4f8d5368, REQ-TEST-d3aeb7d8, REQ-PLAT-cad89d58
parent:
branch: feature/93-electronics-calc
base: e9fa5d2bc91b750e65cf931602acb6030415982c
opened: 2026-11-13

Edit Frame, Requirement coverage and Design directly. Write State, Log and
Rulings with `python .agentic/aegis.py` (advance, pause, log, ruling, verdict);
end each session with `advance` or `pause`.

## Done checklist (current stage)

- [x] diff reviewed against scope, requirements, design, error paths,
      portability, security and unrequested work
- [x] knowledge pages of changed components current with the reviewed code
- [x] project and environment context reconciled with the candidate
- [x] requirements re-read: status, prose, verification, paths and links true
- [x] manual or inspection verification recorded where applicable
- [x] explicit review approved, when enabled
- [x] final `check --strict --run` result logged truthfully after the last edit
- [x] remaining warnings and pre-existing failures explained
- [x] `report` appended

## Frame

Problem: VERA cannot search supplier catalogs or keep a component comparison traceable to its sources. STATED (ticket ELEC-03, #95): a `parts-search` plugin must give "comparații tehnice documentate și informații comerciale actuale". OBSERVED: plugin programs get no VERA secrets (the runner's minimal env), and no manifest install type reaches an authenticated API. So authenticated supplier access needs a first-party host capability; the ticket names this explicitly (core/IPC/settings).

Desired outcome:
- With the `parts-search` plugin installed, valid and enabled for the workbench, and Web access on, the agent can search supplier catalogs by keyword or MPN through a host tool. Credentials stay in the host CredentialStore.
- Results distinguish manufacturer + MPN + package from the supplier SKU and packaging.
- Offers carry quantity breaks, currency, region, declared stock and the query time. Unknown values stay unknown.
- A plugin script compares candidates against hard constraints first and preferences second. It keeps every parameter's source (supplier page, datasheet page or table, conditions), marks unconfirmed or unknown values, and writes a comparison and a proposed BOM. It never orders and never changes the schematic or BOM.

Actors:
- The user, who installs and enables the plugin and enters supplier keys in Settings.
- The agent, which calls the search tool and runs the compare script.
- VERA's host: core, desktop main and renderer, and the CLI.
- The supplier APIs.

Primary scenario:
1. The user enables `parts-search` and enters a Mouser key in Settings → Parts search.
2. The agent searches "N-channel MOSFET 30 V 5 A SOT-23" and gets normalized results with offers.
3. It reads the datasheets, records the critical parameters with page and conditions, and runs `parts-compare` on a structured request (24 V / 5 A, 3.3 V gate drive).
4. It receives comparison.json/.md and bom.csv, where RDS(on) counts only at VGS ≤ 3.3 V and VGS(th) is not taken as proof.

Examples (STATED, ticket):
- E03-C: a MOSFET for 24 V / 5 A with a 3.3 V drive does not take VGS(th) as evidence for RDS(on); unconfirmed parameters stay unknown.
- E03-D: two SKUs (cut tape and reel) of one MPN and package are one device; pinout variants with different MPNs stay distinct.

Counterexamples:
- A missing supplier key produces no offers and no fabricated data; the tool says the key is missing.
- A cached result is never presented as live stock.

In scope:
- Supplier search through a first-party host capability, gated by plugin enabled + valid + Web access on + supplier enabled with a key:
  - STATED (ticket): Mouser Search API v2 and DigiKey Product Information v4.
  - STATED (user, 2026-11-12/13): TME API v2 ("adaptor pentru TME"), Farnell/element14 ("Farnell?").
  - STATED (user, 2026-11-13, "Include Rutronik now", RULING-001): Rutronik24 Shop API (manual v1.3, 21.11.2023).
- Settings and credential storage in CredentialStore, IPC, renderer Settings panel (en/ro/de), and CLI environment keys.
- HTTP with fixed supplier hosts, a timeout, cancellation and redacted errors (keys never in prompt, argv, manifest, workbench.yaml, results, logs or logged URLs).
- Distinct 401/403, 429 (bounded backoff), timeout and partial-response handling.
- No persistent supplier cache (RULING-002, from the terms OBSERVED 2026-11-13: Farnell forbids caching, TME forbids duplicating API content, DigiKey bars building a database). Every search is live and carries its query time; the compare script labels each offer with its capture time and marks it stale after 24 h, so a snapshot is never shown as live stock.
- Supplier notices the terms require, such as TME's "powered by TME.eu Data" and "no guarantee of data accuracy" (OBSERVED, TME terms s.8.7-8.8), travel with the results.
- Plugin package `parts-search`: skills for MOSFET, regulator, op-amp, resistor, capacitor, diode and inductor selection, and a structured request form. Script program `parts-compare` (standard library, run folder, same conventions as ELEC-01/02).
- Fixtures and tests E03-A..E, G. Live probes E03-F for each supplier the user grants access to.

Out of scope:
- STATED (ticket): checkout, orders, automatic BOM replacement, schematic changes, OCR/vision of datasheets, a generic network proxy or local endpoint for scripts, automatic upload of whole schematics or BOMs.
- STATED (user's earlier answer accepted, 2026-11-13): RS Components (no public API documentation found).

Constraints:
- Same branch feature/93-electronics-calc (RULING-002 of TASK-7c2a9322, user).
- Commit when validated, with no push and no Claude attribution.
- Keys are entered by the user in Settings, never in chat (org rules).
- Do not overengineer (user, 2026-11-13): current API versions only, no legacy fallbacks.
- No downloads beyond uv's managed CPython without asking.
- Stored formats stay at version 1.

Success signals:
- E03-A..E and G pass with fixtures and tests.
- E03-F: a redacted live probe for each supplier whose key the user enters; a supplier without a key is recorded as explicitly unverified, not ticked.
- Lint, typecheck, i18n and both reviews pass.

Evidence:
- Ticket F:\ProjectsDDP\VERA_Electronics_Plugins_Tickets\ELEC-03.md.
- API contracts read 2026-11-12/13 from the public docs: Mouser v2 Swagger, DigiKey v4 OAS, TME openapi.json, element14 partner docs, Rutronik Shop API manual v1.3 (notes in the session scratchpad: elec03-api-contracts.md).
- Terms read 2026-11-13: Farnell partner terms s.4(A), TME API terms 2026-07-01 s.8, DigiKey API User Agreement s.5.1 and its rate limits (120 per minute, 1000 per day); Mouser's pages timed out and Rutronik's terms say nothing about the API.
- The Web-access code that serves as the model: core web/configured-provider.ts, web/http.ts, desktop main web-access.ts, renderer web-access.tsx, cli run.ts (map in elec03-webaccess-map.md).

Assumptions: INFERRED:
- Supplier access mirrors Web access: a per-provider credential slot, consent without secure storage, revoke on change.
- The `parts_search` tool is one read-class builtin, hidden unless the gate holds.

Unknowns:
- Live behaviour not confirmed by the docs: status codes, rate limits (except DigiKey), error envelopes, DigiKey token lifetime, Farnell currency field and MPN/SKU response roots, TME price fields, Rutronik's error responses and whether its numbers arrive as numbers or strings (the manual shows both).
- Whether the user will grant each supplier's key in time for E03-F.

Decision-blocking questions:
1. Rutronik now or later: answered by the user, "Include Rutronik now" (RULING-001).
2. The cache the ticket asks for: settled by the suppliers' own terms (RULING-002); the user may still overrule it.

Proposed behaviors (not accepted):
- Tool `parts_search`: {query or mpn, supplier: one or all, limit 1..20}.
- Exit and error codes of `parts-compare` follow kicad-tool/elec-calc (0 completed, 2 refused, 3 failed).

Path and reason: full.

| Criterion | Holds? | Evidence |
|---|---|---|
| no new externally observable behavior | no | new tool, settings panel, plugin |
| no new interface or data format | no | IPC channels, settings, result contract |
| no new dependency | yes | fetch and the standard library only |
| an existing requirement already covers the behavior | no | none for supplier search |
| no security or data-handling change | no | new credentials and outbound hosts |

## Requirement coverage

| Requirement | Accepted behavior | Design | Proof |
| --- | --- | --- | --- |
| REQ-DATA-9fd50acb | STATED: host capability, fixed hosts, timeout, redaction; OBSERVED: API contracts | parts/*, shared parts-search.ts | adapter fixture tests |
| REQ-DATA-6b26f2a5 | STATED: structured request, comparison and proposed BOM | parts_compare.py, parts_support | fixture runs |
| REQ-FUNC-7b42ac37 | STATED: MPN/package vs SKU/packaging, offers with time; unknown stays unknown | adapters, provider.ts, tools/parts.ts | E03-A fixtures |
| REQ-FUNC-c5cb293b | STATED (E03-D): two SKUs of one MPN are one device | provider.ts grouping | grouping fixture |
| REQ-SEC-1518625d | STATED (E03-G): plugin installed, valid, active; Web access gate | configured.ts, sessions.ts, run.ts | gate tests |
| REQ-REL-d9f0b8da | STATED (E03-G): revocation | configured.ts revoke, parts-access.ts | revocation test |
| REQ-SEC-2ccecd75 | STATED (E03-B): no secret in prompt, argv, manifest, workbench.yaml, results, logs, logged URLs | http.ts, configured.ts, parts-access.ts | secret scan tests |
| REQ-SEC-597d9e43 | STATED: fixed destinations, timeout | http.ts | http tests |
| REQ-REL-ee71e2b0 | STATED (E03-A): 401/403 distinct | http.ts, configured.ts | auth fixtures |
| REQ-REL-94d8d0ca | STATED (E03-A): 429 with bounded backoff | http.ts | 429 fixtures |
| REQ-REL-a953f579 | STATED: timeout distinct | http.ts | stall fixture |
| REQ-REL-51a2423d | STATED: partial answers distinct | adapters | partial fixtures |
| REQ-REL-375c4622 | STATED (E03-A): cancellation | configured.ts, http.ts | cancel test |
| REQ-FUNC-244f9aef | STATED (E03-G): token refresh, concurrent sessions | configured.ts tokens | token tests |
| REQ-FUNC-e6ac90ad | STATED: no access gives no fabricated offers | configured.ts | key-required test |
| REQ-FUNC-cec25871 | OBSERVED: TME terms s.8.7-8.8 notice | suppliers.ts (TME adapter) | TME fixture |
| REQ-UX-664afc86 | STATED: controls in the existing UI; INFERRED: Web access panel pattern | parts-access.tsx, settings.tsx, locales | renderer test |
| REQ-SEC-ddb16bb1 | STATED: CredentialStore adapted to these accounts; INFERRED: Web access consent rule | parts-access.ts | main service test |
| REQ-FUNC-fd5a2a7b | INFERRED: connection test like Web access | parts-access.ts | main service test |
| REQ-FUNC-2ed99e46 | INFERRED: CLI parity with Web access env keys | run.ts | CLI test |
| REQ-FUNC-98175a73 | STATED: skills for seven families, structured request; catalog | plugin.yaml, skills, catalog | package test |
| REQ-FUNC-f2b0b6c6 | STATED: hard constraints first, cheapest not proposed when it fails | evaluate.py | ranking fixture |
| REQ-FUNC-a08310ed | STATED (E03-C): RDS(on) at real VGS, VGS(th) not evidence | evaluate.py | E03-C fixture |
| REQ-FUNC-99ee75ad | STATED (E03-C): unconfirmed stays unknown; PDF-extracted values are proposals | evaluate.py | unknown fixture |
| REQ-FUNC-384a082a | STATED (E03-D): SKUs vs devices, pinout variants distinct | evaluate.py | E03-D fixture |
| REQ-FUNC-84309105 | STATED (E03-E): traceable to sources and conditions | report.py | report fixture |
| REQ-FUNC-1d01263c | STATED: quantity, price break, currency, capture time, stale; no taxes or shipping | evaluate.py | offer fixture |
| REQ-FUNC-8dfa1ca5 | STATED (E03-E): comparison and proposed BOM, no BOM or schematic change | report.py, cli.py | run-folder test |
| REQ-FUNC-4a4d8cf2 | STATED: pinout/footprint before naming a direct replacement | evaluate.py | drop-in fixture |
| REQ-REL-4f8d5368 | STATED: explicit result contract; INFERRED: elec-calc refusal rules | cli.py, request.py | refusal fixtures |
| REQ-TEST-d3aeb7d8 | STATED (E03-F): live probes or explicitly unverified | parts/* | Manual: live probe log |
| REQ-PLAT-cad89d58 | STATED: Windows x64 and native Ubuntu x64 | parts_compare.py | Windows tests; Manual: Ubuntu |

## Design

**Approach.** Two parts that share no code: a host capability (Web access is the model) and an offline plugin
script (ELEC-01/02 conventions). Host flow: tool `parts_search` -> `ctx.parts.search` -> `ConfiguredPartsProvider`
(gate before and after the credential read, generation counter, active controllers, token store) -> one adapter per
supplier through `partsJson` (fixed endpoints) -> normalized items -> devices grouped -> result. Suppliers of one
call run in parallel; one supplier's failure becomes its status, not the call's (REQ-DATA-9fd50acb). No cache
(RULING-002). Rejected: generalizing web/http.ts - its allowlist, messages and 1 MiB cap belong to Web access, and
the parts statuses need the HTTP status, so a separate 80-line transport keeps both contracts plain.

**Interfaces and data.**
- shared `parts-search.ts`: supplier ids and metadata (name, two-part credential, notice), settings schema and
  defaults, IPC payloads (`parts.access.get/save/removeKey/test/cancel`), tool argument schema.
- shared `settings.ts`: `partsSearch` (all suppliers off). `tools.ts`: `parts_search` builtin name.
- core `parts/`: `http.ts` (`partsJson`, `PartsHttpError.kind`: auth, rate-limited, timeout, cancelled,
  unavailable, invalid), `provider.ts` (types, price-text reader, item normalization, grouping, result notes),
  five adapters (`search(kind, text, limit, region, signal, auth)` -> `{items, partial, errors}`), `configured.ts`
  (`ConfiguredPartsProvider`, `PartsAccessBlocked`, `unavailablePartsTools`), `tools/parts.ts`.
- `ToolContext.parts?` and `SessionServiceHost.parts?`; tool hidden through `disabledTools` (REQ-SEC-1518625d).
- main `parts-access.ts` (`PartsAccessService`, credential ids `parts:<id>`, consent, checkpoint/restore, revoke,
  test with one attempt at a time); `sessions.ts` computes the plugin gate in `run()` (it already loads plugins) and
  passes `parts` with a call-time `allowed()` that reloads them; `index.ts` wiring and close.
- renderer `parts-access.tsx` in Settings (section `parts`), locales en/ro/de, mock API, workbench tool label.
- CLI `run.ts`: env credentials into `MemoryCredentials`, own provider, gate with the CLI's plugins.
- plugin `parts-search`: `plugin.yaml` (program `parts-compare`, rules), skills `component-selection` (workflow,
  request form, evidence rules) and `component-families` (checks per family), `scripts/parts_compare.py`,
  `scripts/parts_support/` (`cli.py`, `request.py`, `units.py`, `evaluate.py`, `report.py`, copy of
  `workspace.py`); catalog `official`, activity `design`, pack `electronics` group "Component selection".

**Files and test seams.** core `parts/*.test.ts` with fixture answers per supplier and an injected `fetch`
(E03-A/B/G); main `parts-access.test.ts` on the real CredentialFile harness; renderer `parts-access.test.ts`;
shared schema test; registry test lists the tool; CLI env test; `tests/integration/parts-search.test.ts` runs
parts-compare on fixtures in `tests/fixtures/parts-search/` (E03-C/D/E/F offline) and checks the three
`workspace.py` copies are identical.

**Risks and open decisions.** Live field names beyond the public documents (TME data fields, Farnell roots and
currency, Rutronik number forms) stay unconfirmed until E03-F; adapters read leniently and leave unknown fields
null. Keys in Mouser/Farnell/Rutronik query strings make those URLs secrets: no URL reaches an error, result or
log. The plugin gate needs the official tier, so a local copy of the plugin does not unlock supplier accounts.

**Requirement map.** DATA-9fd50acb, FUNC-7b42ac37, FUNC-c5cb293b, REL-51a2423d, FUNC-cec25871: adapters +
provider.ts. SEC-1518625d, REL-d9f0b8da, REL-375c4622, FUNC-244f9aef, FUNC-e6ac90ad: configured.ts (+ sessions.ts,
run.ts). SEC-597d9e43, REL-ee71e2b0, REL-94d8d0ca, REL-a953f579: http.ts. SEC-2ccecd75: http.ts messages,
configured.ts, parts-access.ts snapshot check, CLI registerSecret. UX-664afc86, SEC-ddb16bb1, FUNC-fd5a2a7b:
parts-access.ts/.tsx. FUNC-2ed99e46: run.ts. DATA-6b26f2a5, FUNC-98175a73, FUNC-f2b0b6c6, FUNC-a08310ed,
FUNC-99ee75ad, FUNC-384a082a, FUNC-84309105, FUNC-1d01263c, FUNC-8dfa1ca5, FUNC-4a4d8cf2, REL-4f8d5368,
PLAT-cad89d58: plugin. TEST-d3aeb7d8: manual live probes.

Diagrams: [diagram_TASK-2c5054ba.md](diagram_TASK-2c5054ba.md)

## Log

- 2026-11-13 frame: journal opened
- 2026-11-13 frame: Rutronik manual v1.3 (21.11.2023) read as PDF: GET www.rutronik24.com/api/search|pricerequest|article with apikey query parameter; TME terms 2026-07-01 s.8.7 require 'powered by TME.eu Data' and 'no guarantee of data accuracy'; DigiKey rate limit 120/min and 1000/day (developer docs)
- 2026-11-13 frame: completed; next specify - scope recorded under autopilot; Rutronik in (RULING-001), no supplier cache (RULING-002) (7 Done checklist item(s) left unticked)
- 2026-11-13 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-13 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-11-13 build: DEVIATION build: the core parts code (http, provider, suppliers, configured, tool) was written before its tests - the five supplier adapters were shaped from the documents first; cost: no red line for most core requirements
- 2026-11-13 build: red: npx vitest run src/libraries/core/src/parts/parts.test.ts exit 1 - token expiry compared on two clocks, so a cached token was never reused (REQ-FUNC-244f9aef, REQ-REL-d9f0b8da)
- 2026-11-13 build: green: npx vitest run src/libraries/core/src/parts/parts.test.ts src/libraries/core/src/tools/registry.test.ts exit 0, 21 tests (REQ-DATA-9fd50acb, REQ-FUNC-7b42ac37, REQ-FUNC-c5cb293b, REQ-SEC-1518625d, REQ-REL-d9f0b8da, REQ-SEC-2ccecd75, REQ-SEC-597d9e43, REQ-REL-ee71e2b0, REQ-REL-94d8d0ca, REQ-REL-a953f579, REQ-REL-51a2423d, REQ-REL-375c4622, REQ-FUNC-244f9aef, REQ-FUNC-e6ac90ad, REQ-FUNC-cec25871)
- 2026-11-13 build: green: npx vitest run (core parts, registry, sessions, settings, main parts-access/ipc-router/sessions/web-access, preload, renderer parts-access/settings/workbench-tools/mocks, cli src, tests/integration/parts-search) exit 0 except 1 pre-existing failure; lint, typecheck and check:i18n exit 0 (all 31 test-backed requirements)
- 2026-11-13 build: green: VERA_PARTS_UV=uv npx vitest run tests/integration/parts-search.test.ts -t 'real uv' exit 0 - parts-compare provisioned and run offline on uv's managed CPython 3.13 (REQ-PLAT-cad89d58)
- 2026-11-13 build: pre-existing failures outside this task, unchanged: tests/integration/cli.test.ts 'CLI checks a catalog source and builds its release' expects 9 official plugins (16 on master before this task); src/libraries/shared/src/plugins-ipc.test.ts expects catalog entries without the activities/keywords defaults added on master (#86)
- 2026-11-13 build: check: secret-in-diff on core/src/parts/parts.test.ts is the synthetic fixture header 'Bearer dk-access-token-1' (no real credential); kept, it is what REQ-FUNC-244f9aef asserts
- 2026-11-13 build: evolution: every path matches the design; the five supplier adapters live in one module, core/src/parts/suppliers.ts, instead of five files (they share the reading helpers)
- 2026-11-13 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-13 validate: self-review found the plugin gate was not rechecked after the credential read (spec 2); fixed with one shared recheck per call, test added in core parts.test.ts; spec REQ-DATA-9fd50acb aligned (a call fails only on gate, cancel or revocation; refresh on 401 or 403)
- 2026-11-13 validate: knowledge parts-search.md created; official-plugins.md, headless-cli.md, web-search.md, context project.md and environment.md updated
- 2026-11-13 validate: manual REQ-TEST-d3aeb7d8: no supplier credential was entered by the user, so Mouser, DigiKey, TME, Farnell and Rutronik are all recorded as NOT verified live (E03-F live part open); the offline part (labelled snapshot through parts-compare) passed
- 2026-11-13 validate: manual REQ-PLAT-cad89d58: native Ubuntu x64 not run (no Ubuntu host in this session); Windows x64 toolchain Python and real uv managed CPython 3.13 passed
- 2026-11-13 validate: review r1: spec changes_required - duplicate price-break quantities crash parts-compare; malformed supplier answers reported ok (spec says failed); verifications not settled (args refusals, token expiry, Farnell/Rutronik auth, TME refresh, isolated partial, one MPN two packages, null fields, bound-tool gate, two held suppliers, two currencies); spec text supplierValues vs unconfirmedValues, TME language header
- 2026-11-13 validate: review r1: quality changes_required - leading sign/dot values read as text; ranking compares different units; malformed answers ok; 32 000-character tool cap drops whole suppliers; also price overflow, sibling requests not aborted, 1-character mpn, merged-device datasheet, representative basis, gate uses getSnapshot
- 2026-11-13 validate: returned to build - round-1 review findings (both roles changes_required)
- 2026-11-13 build: green (round-1 fixes): core parts.test.ts 25, tests/integration/parts-search.test.ts 8 + 1 opt-in skipped, focused set 30 files 242 passed; typecheck, lint, check:i18n exit 0 - fixes: signed/leading-dot values, ranking within one unit with the evidence basis, coulomb unit, unique price-break quantities and price bound, per-row datasheet, shape checks (unexpected-answer), result fitted under 30 000 characters with suppliers interleaved, sibling abort, mpn 2..64, gate by the session's workbench id; specs, journal row and knowledge aligned
- 2026-11-13 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-13 validate: review r2: spec approved (notes: internal errors also end a call; ranking unit choice; TME second 401 untested; zero-result shapes; TME partial message wording; spec example lacks truncated). quality changes_required - an 'in' or text '==' constraint never matches a row whose text starts with a digit, sign or dot (case sizes 0603); notes: prefer a recognised ranking unit, per-row datasheet test cannot fail, interleaving untested, zero-result shape strictness
- 2026-11-13 validate: returned to build - round-2 quality finding: text constraints against digit-leading values
- 2026-11-13 build: red: the new 'matches text constraints' case fails on the round-2 code - Case 0603 read as a quantity is never evidence for an 'in' constraint (REQ-DATA-6b26f2a5, REQ-FUNC-a08310ed)
- 2026-11-13 build: green (round-2 fixes): focused set 30 files 246 passed 2 skipped; typecheck, lint, check:i18n exit 0 - text constraints compare the row's text as written; ranking unit = first recognised unit, else first unit text; Mouser/Farnell zero-result answers ok; partial message wording; tests for zero results, TME second 401, supplier interleaving, per-row datasheet revision B; spec REQ-DATA-9fd50acb (internal error ends a call, zero results, truncated in example), REQ-DATA-6b26f2a5 (text matching, ranking unit), REQ-FUNC-1d01263c wording
- 2026-11-13 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-13 validate: review r3: spec approved, quality approved. Accepted non-blocking notes (no candidate edit, to keep both approvals): the zero-result check uses Number(x) === 0, so null/''/[] also read as zero results (spec says number or numeric text); a text '==' value that starts with a sign is a quantity by the value rule, so text ranges should be written with 'in'; case codes given as JSON numbers do not match quoted case codes; a device's rows in another unit are ignored for ranking; the round-3 red line belongs to REQ-DATA-6b26f2a5, not REQ-FUNC-a08310ed; CONFLICT instead of the gate message on a workbench switch during a call; the call-time gate loads plugins twice; the Mouser part-number body sends no manufacturerName; the CLI refuses a malformed supplier variable
- 2026-11-13 validate: check: shared ipc/settings/tools/index and core index joined REQ-DATA-9fd50acb, workbench-tools.tsx joined REQ-UX-664afc86; remaining task-scope warnings are test files and fixtures (linked as tests), the synthetic bearer fixture (logged), and stale paths or journal headers of other tasks
- 2026-11-13 validate: final: python .agentic/aegis.py check --task TASK-2c5054ba --strict --run exit 0; ran lint, typecheck, i18n (test not in [check] run - the focused Vitest set of 30 files, 246 passed 2 skipped, is the test proof, plus the opt-in VERA_PARTS_UV run); remaining warnings: test/fixture files outside affected_paths, the synthetic bearer fixture string, and other tasks' stale paths and journal headers - none limits this candidate
- 2026-11-13 validate: completed; next done

## Rulings

- RULING-001 | date=2026-11-13 | decision=Rutronik24 Shop API joins ELEC-03 now as a fifth supplier (search, pricerequest, article; personal apikey query parameter) | reason=user chose 'Include Rutronik now'; its manual v1.3 (21.11.2023) was read and gives the contract | source=user | supersedes=none
- RULING-002 | date=2026-11-13 | decision=VERA keeps no persistent supplier cache: every parts_search is live; the offline run of E03-F is parts-compare on a labeled snapshot (each offer keeps its supplier, query time and a stale flag after 24 h), never shown as live stock | reason=terms read 2026-11-13: Farnell s.4(A) forbids caching; TME terms 2026-07-01 s.8.6 forbid duplicating API content; DigiKey API agreement s.5.1(e) bars building a database from DigiKey Data; Mouser and Rutronik state nothing - the ticket requires the cache to respect supplier terms | source=technical | supersedes=none


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-2c5054ba.md
changed: round-2 review fixes
evidence: python .agentic/aegis.py check --task TASK-2c5054ba --strict --run exit 0; focused Vitest 246 passed; opt-in VERA_PARTS_UV passed; review round 3 approved by both roles
issues: E03-F live supplier probes not run (no user keys); native Ubuntu not run; pre-existing failures outside the task: cli.test.ts official plugin count, shared plugins-ipc.test.ts
spec_compliance: approved
implementation_quality: approved
review_round: 3

## Delivery report (2026-11-13)

- stage: validate; type: feature; path: full; branch: feature/93-electronics-calc
- requirements:
  - REQ-DATA-9fd50acb - Define the parts search result contract and supplier mapping
  - REQ-DATA-6b26f2a5 - Define the parts-compare request and result contract
  - REQ-FUNC-7b42ac37 - Search supplier catalogs by keyword or part number through the parts_search tool
  - REQ-FUNC-c5cb293b - Group supplier offers of one manufacturer part number into one device
  - REQ-SEC-1518625d - Offer the parts search tool only while the official plugin, Web access and a configured supplier allow it
  - REQ-REL-d9f0b8da - Cancel supplier requests when parts search access changes
  - REQ-SEC-2ccecd75 - Keep supplier credentials out of results, errors, logs, settings and request text
  - REQ-SEC-597d9e43 - Contact only fixed supplier endpoints without redirects
  - REQ-REL-ee71e2b0 - Report refused supplier credentials as an authentication failure
  - REQ-REL-94d8d0ca - Retry a rate-limited supplier once after a bounded wait
  - REQ-REL-a953f579 - Report a supplier that does not answer in time as timed out
  - REQ-REL-51a2423d - Mark incomplete supplier answers as partial
  - REQ-REL-375c4622 - Stop every supplier request when the caller cancels
  - REQ-FUNC-244f9aef - Obtain and reuse supplier access tokens and refresh them once when refused
  - REQ-FUNC-e6ac90ad - Report a supplier without a credential as needing a key
  - REQ-FUNC-cec25871 - Carry supplier notices with their results
  - REQ-UX-664afc86 - Configure parts search suppliers, credentials and region in Settings
  - REQ-SEC-ddb16bb1 - Store supplier credentials in the credential store with explicit consent for unprotected storage
  - REQ-FUNC-fd5a2a7b - Test a supplier connection from Settings
  - REQ-FUNC-2ed99e46 - Read supplier credentials from environment variables in the command-line interface
  - REQ-FUNC-98175a73 - Package the parts-search plugin with selection skills and the parts-compare program
  - REQ-FUNC-f2b0b6c6 - Apply hard constraints before preferences when comparing candidates
  - REQ-FUNC-a08310ed - Accept a parameter as evidence only under the conditions a constraint names
  - REQ-FUNC-99ee75ad - Treat unconfirmed or typical parameter values as unknown
  - REQ-FUNC-384a082a - Merge candidates of one manufacturer part number and package into one device
  - REQ-FUNC-84309105 - Trace every compared value to its source and conditions
  - REQ-FUNC-1d01263c - Price offers at the requested quantity and label captured offers as snapshots
  - REQ-FUNC-8dfa1ca5 - Write the comparison and a proposed BOM into a new run folder
  - REQ-FUNC-4a4d8cf2 - Call a candidate a drop-in replacement only with confirmed pinout and footprint
  - REQ-REL-4f8d5368 - Refuse an invalid comparison request and clean up a failed run
  - REQ-TEST-d3aeb7d8 - Probe each supplier with access live and record suppliers without access as unverified
  - REQ-PLAT-cad89d58 - Run parts-compare on Windows x64 and native Ubuntu x64
- deviations: 1 recorded
  - build: the core parts code (http, provider, suppliers, configured, tool) was written before its tests - the five supplier adapters were shaped from the documents first; cost: no red line for most core requirements
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=3
- diff vs task base e9fa5d2: 93 file(s) changed, 7789 line(s) added
- checks: errors=0 warnings=60 notes=27
- checklist: 0/9 done; open: diff reviewed against scope, requirements, design, error paths, portability, security and unrequested work; knowledge pages of changed components current with the reviewed code; project and environment context reconciled with the candidate; requirements re-read: status, prose, verification, paths and links true; manual or inspection verification recorded where applicable; explicit review approved, when enabled; final `check --strict --run` result logged truthfully after the last edit; remaining warnings and pre-existing failures explained; `report` appended

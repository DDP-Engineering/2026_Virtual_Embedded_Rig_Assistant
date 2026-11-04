# Firmware comparison: boot-0412 → boot-0413

## Scope and sources

User-selected baseline: `logs/boot-0412.log`, firmware 1.0.0. User-selected candidate: `logs/boot-0413.log`, firmware 1.1.0. Associations are documented in [[docs/runs.md#L1-L10]]. Image hashes are unknown; log hashes below are not image hashes.

Both captures were parsed using the `iso` profile:

| Role | Source path | Original source SHA-256 | Original source ref |
|---|---|---|---|
| Baseline | logs/boot-0412.log | dee4449c6d0624a78148ff5154da77adb9a303bda59f99cbb9b3bdd2d21e5335 | [[logs/boot-0412.log#L1-L4]] |
| Candidate | logs/boot-0413.log | 72cdd6cd911c83c1f82129962c2874b945ff4c6663319f6f35b573840e15fa2d | [[logs/boot-0413.log#L1-L264]] |

Inspected run notes, boot criterion and release notes. No WORKBENCH.md was found by the workbench glob. No hardware, build or test was executed.

**Evidence limitation:** The candidate's initial scan reached EOF, but only 50 events were returned. The additional request used the same path and `iso` profile, `fromLine: 51`, `maxEvents: 200`, and `expectedSha256: 72cdd6cd911c83c1f82129962c2874b945ff4c6663319f6f35b573840e15fa2d`. It failed with `CONFLICT`, reason `source_changed`, and message `Log changed. Parse the current file before comparing results.` This is a tool diagnostic, not a cited log event. No events from that request were accepted. The evidence path was stopped without an unpinned retry or a new scan. All candidate observations below refer only to the original hash; they must not be attributed to the changed file.

## Comparability

Status: **comparable based on documented conditions for the original snapshots**. Real bench equivalence is unverified. The source conflict independently blocks completion of the requested comparison; it is not evidence of a bench-condition mismatch.

| Condition | Baseline | Candidate | Source / blocker |
|---|---|---|---|
| Board and revision | VERA-DEMO-01 revision A | VERA-DEMO-01 revision A | [[docs/runs.md#L1-L10]] |
| Unit | DEMO-001 | DEMO-001 | [[docs/runs.md#L1-L10]] |
| Firmware (intentional variable) | 1.0.0 | 1.1.0 | [[docs/runs.md#L1-L10]] |
| Image hash (optional) | Unknown | Unknown | Not supplied in inspected run notes |
| Test procedure and revision | boot@1 | boot@1 | [[docs/runs.md#L1-L10]] |
| Bench setup | bench@1 | bench@1 | [[docs/runs.md#L1-L10]] |

No required comparison condition is missing or different in the inspected notes. Firmware differences are intentional. The outstanding evidence requirement is a user-identified stable candidate snapshot, or recovery of the original hashed snapshot, before full message comparison can resume.

## Observed differences

### Scan completeness versus returned event coverage

The original baseline scan was complete at EOF: 4 lines, 229 bytes, all 4 events returned, no preview truncation. The original candidate scan was complete at EOF: 264 lines, 13,384 bytes, but only lines 1–50 were returned and 214 events were omitted. Both scans reported zero unparsed and blank lines. These are original-snapshot parser results associated with [[logs/boot-0412.log#L1-L4]] and [[logs/boot-0413.log#L1-L264]]. A complete count scan is not complete inspection of message content.

| Level | Baseline | Candidate, original snapshot | Candidate minus baseline |
|---|---:|---:|---:|
| ERROR | 0 | 1 | +1 |
| WARN | 1 | 1 | 0 |
| INFO | 3 | 262 | +259 |
| DEBUG | 0 | 0 | 0 |
| VERBOSE | 0 | 0 | 0 |
| OTHER | 0 | 0 | 0 |

Counts describe complete original scans, not the changed candidate file. Sources: [[logs/boot-0412.log#L1-L4]], [[logs/boot-0413.log#L1-L264]].

### Errors and warnings

- The first and only ERROR in the original candidate is `i2c initialization failed`, at line 4, timestamp `2026-04-13T08:00:03Z`. This is established as first overall because the ordered preview includes lines 1–4 and the complete scan reports one ERROR. [[logs/boot-0413.log#L4-L4]]
- The baseline has no ERROR in its complete scan. [[logs/boot-0412.log#L1-L4]]
- There is no new warning message: each original scan contains one WARN, and each returned line 3 is `i2c initialization delayed 20ms`. [[logs/boot-0412.log#L3-L3]] [[logs/boot-0413.log#L3-L3]]

### One-sided messages — PARTIAL

- Confirmed candidate-only relative to the fully inspected baseline: `i2c initialization failed`. [[logs/boot-0413.log#L4-L4]] [[logs/boot-0412.log#L1-L4]]
- Also confirmed candidate-only: the 46 distinct messages `candidate-only-event-0` through `candidate-only-event-45`, individually returned in candidate lines 5–50. The exact inspected original candidate source ref is [[logs/boot-0413.log#L1-L264]]; none of these messages appears among the baseline's four returned events. [[logs/boot-0412.log#L1-L4]]
- Baseline contains `i2c SDA=PB7 SCL=PB6 ready`. It is absent from the candidate's first 50 returned events, but **cannot be called baseline-only**, because candidate lines 51–264 were not returned for inspection. [[logs/boot-0412.log#L4-L4]] [[logs/boot-0413.log#L1-L264]]
- The 214 omitted candidate events remain uninspected. Their message identities, repetition and any additional shared or one-sided messages are unknown. The suffix pattern of the first 46 candidate-only messages is not evidence for the omitted messages.

### Timing

The identical messages at lines 1, 2 and 3 in both original captures each have matching ISO UTC timestamps, respectively `2026-04-12T08:00:00Z`, `08:00:01Z`, and `08:00:02Z`. For the matched first occurrence of each exact message, the signed candidate-minus-baseline timestamp delta is +0 seconds. [[logs/boot-0412.log#L1-L1]] [[logs/boot-0413.log#L1-L1]] [[logs/boot-0412.log#L2-L2]] [[logs/boot-0413.log#L2-L2]] [[logs/boot-0412.log#L3-L3]] [[logs/boot-0413.log#L3-L3]]

These are recorded timestamp differences, not a measured performance result. Later candidate duplicates cannot be excluded. Candidate line 4 is on April 13 while its first three lines are on April 12; the timestamp transition is visible, but its cause is unknown. Do not compare baseline ready with candidate failure as if they were the same event, or infer a boot-duration regression from these wall-clock values. [[logs/boot-0412.log#L4-L4]] [[logs/boot-0413.log#L4-L4]]

## Criterion

Criterion: **boot@1**, scoped to VERA-DEMO-01 revision A, unit DEMO-001, setup bench@1. The captured boot log must reach an i2c ready event and contain no ERROR line. An ERROR or failure to reach ready fails. This is manual captured-log acceptance, not authorization to operate hardware. [[docs/boot-test.md#h=boot-criterion-boot1]]

| Run / evidence scope | Result | Basis and limitation |
|---|---|---|
| Baseline original snapshot | **criterion met** | Complete scan has zero ERROR and line 4 records i2c ready. [[logs/boot-0412.log#L1-L4]] |
| Candidate original snapshot only | **criterion not met** | Observed ERROR at line 4 independently disqualifies it, whether or not ready appears later. [[logs/boot-0413.log#L4-L4]] |
| Candidate after detected source change / current file | **not evaluable** | Hash-pinned continuation failed with source_changed. No changed bytes were accepted. The original failure cannot be transferred to an unidentified new snapshot. |

Overall requested full comparison remains incomplete; there is no current-candidate acceptance or release-readiness verdict.

## Binary differences

**Skipped.** Neither build folder was explicitly identified. Only analysis-skills is enabled; esp32-idf is disabled/unavailable and there is no enabled safe size/symbol command or program execution capability. No binary size, symbol, image-hash or hardware equivalence claim is made.

## Interpretation

**Facts:** The original candidate introduces an observed I2C initialization ERROR relative to the baseline, and fails boot@1, while the original baseline meets it. Counts are complete for those original scans, but the candidate message comparison is partial. The release note states that firmware 1.1.0 changes I2C initialization timing relative to 1.0.0 on this board revision; it explicitly does not establish root cause. [[logs/boot-0413.log#L4-L4]] [[logs/boot-0412.log#L1-L4]] [[docs/release-notes.md#h=firmware-110-release-notes]]

**Hypothesis, not conclusion:** The documented I2C timing change may be associated with the initialization failure. The captures do not establish causation, and the changed candidate source further limits auditability. A rejecting check would be an independently reviewed, controlled comparison holding documented bench conditions constant while isolating the timing change: persistence of failure after restoring baseline timing would argue against timing change as the sole explanation. No such check was executed.

No register decoding was applicable: no relevant captured register value was returned. No separate known-issue finding was returned by document search; this is missing context, not proof of no known issues.

## Recommended checks

1. **Restore evidence identity first.** Please provide or explicitly select a stable candidate snapshot, ideally recovering the original file with SHA-256 `72cdd6cd911c83c1f82129962c2874b945ff4c6663319f6f35b573840e15fa2d`. Otherwise request a fresh comparison of an explicitly identified new snapshot. Do not silently replace the candidate or merge old/new events.
2. **Finish event coverage on that stable identity.** Retrieve all remaining candidate events in bounded, hash-pinned pages with the same ISO profile. This is required to inspect all one-sided messages and decide whether baseline ready is truly absent. Stop again on conflict; no unpinned retries.
3. **Review capture provenance and timestamp continuity.** Confirm why the first three candidate entries match the baseline date while later returned entries use the following day; this guards against treating wall-clock discontinuity as elapsed boot time. Request image identities if available for stronger traceability.
4. **Investigate the documented I2C timing change only after evidence is stable.** Review its implementation and arrange separately authorized controlled checks capable of rejecting the timing hypothesis. The release note is motivation, not causal proof.

These are recommendations only. No tests, hardware actions, builds or installations were performed. This report preserves valid original observations and explicitly does not claim that all candidate one-sided messages were inspected.

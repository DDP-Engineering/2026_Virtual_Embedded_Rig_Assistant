# Firmware comparison: boot-0412 → boot-0413

## Scope and sources

Compared the explicitly requested baseline logs/boot-0412.log (firmware 1.0.0) and candidate logs/boot-0413.log (firmware 1.1.0). Run associations are documented in [[docs/runs.md#L1-L10]]. These are fictional captured inputs; no build, capture, hardware operation or test was executed.

Both logs were parsed with the ISO profile. Capture SHA-256 values (not firmware image hashes):

| Capture | SHA-256 | Source |
|---|---|---|
| boot-0412 | dee4449c6d0624a78148ff5154da77adb9a303bda59f99cbb9b3bdd2d21e5335 | [[logs/boot-0412.log#L1-L4]] |
| boot-0413 | 4ec26dafb28bde79dd9c91e41f501bee7ed5f501329b2d4928c4f07693eb4f70 | [[logs/boot-0413.log#L1-L4]] |

Inspected run notes, firmware 1.1.0 release notes and boot@1 criterion. WORKBENCH.md was requested but unavailable (ENOENT). No build folders were supplied. Firmware image hashes are unknown.

## Comparability

**Status: comparable on documented conditions.** Matching notes do not establish that the real bench actually matched them, nor establish release readiness.

| Condition | Baseline | Candidate | Source / blocker |
|---|---|---|---|
| Board and revision | VERA-DEMO-01 revision A | VERA-DEMO-01 revision A | [[docs/runs.md#L1-L10]]; matching |
| Unit | DEMO-001 | DEMO-001 | [[docs/runs.md#L1-L10]]; matching |
| Firmware (intentional variable) | 1.0.0 | 1.1.0 | [[docs/runs.md#L1-L10]]; allowed difference |
| Image hash (optional) | Unknown | Unknown | Not supplied; not a blocker |
| Test procedure and revision | boot@1 | boot@1 | [[docs/runs.md#L1-L10]]; matching |
| Bench setup | bench@1 | bench@1 | [[docs/runs.md#L1-L10]]; matching |

No required condition is missing or differing in the supplied run notes. Missing WORKBENCH.md limits supplementary context but does not remove the conditions documented in runs.md.

## Observed differences

Both scans completed at EOF: four lines each, no unparsed or blank lines. Both event previews are complete (not truncated, zero omitted). Thus the following absence and one-sided statements cover these complete captures, not merely a bounded preview. [[logs/boot-0412.log#L1-L4]] [[logs/boot-0413.log#L1-L4]]

| Level | Baseline | Candidate | Candidate minus baseline |
|---|---:|---:|---:|
| ERROR | 0 | 1 | +1 |
| WARN | 1 | 1 | 0 |
| INFO | 3 | 2 | -1 |
| DEBUG | 0 | 0 | 0 |
| VERBOSE | 0 | 0 | 0 |
| OTHER | 0 | 0 | 0 |

Counts derive from the complete parsed sources above.

- First and only candidate ERROR: `i2c initialization failed`, line 4, timestamp 2026-04-13T08:00:03Z. This message is absent from the complete baseline. [[logs/boot-0413.log#L4-L4]] [[logs/boot-0412.log#L1-L4]]
- There is no newly introduced warning message. Both runs' first and only WARN is `i2c initialization delayed 20ms`, line 3, timestamp 2026-04-12T08:00:02Z. [[logs/boot-0412.log#L3-L3]] [[logs/boot-0413.log#L3-L3]]
- Baseline-only message: `i2c SDA=PB7 SCL=PB6 ready`, line 4. No ready message occurs anywhere in the candidate capture. The pin labels here are quoted capture content, not independently verified wiring. [[logs/boot-0412.log#L4-L4]] [[logs/boot-0413.log#L1-L4]]
- The other three messages are identical across the captures. Each occurs once and has the same ISO UTC timestamp on both sides: boot identification at 08:00:00Z, supply/oscillator message at 08:00:01Z, and warning at 08:00:02Z, all dated 2026-04-12. Signed candidate-minus-baseline timestamp delta is +0 seconds for each matched message. This is only a captured timestamp comparison, not a statistically significant performance measurement. [[logs/boot-0412.log#L1-L4]] [[logs/boot-0413.log#L1-L4]]
- Candidate timestamp consistency limitation: lines 1–3 are dated April 12, while line 4 is April 13. Do not interpret that date discontinuity as measured boot latency. The baseline ready event and candidate failure event are different messages and are not a valid matched timing pair. [[logs/boot-0413.log#L1-L4]] [[logs/boot-0412.log#L4-L4]]

## Criterion

Source/revision: **boot@1**, scoped to VERA-DEMO-01 revision A, DEMO-001, bench@1. The captured log must reach an I2C ready event and contain no ERROR line; either an ERROR or failure to reach ready fails the manual log criterion. Documented conditions match this scope. [[docs/boot-test.md#h=boot-criterion-boot1]] [[docs/runs.md#L1-L10]]

| Run | Result | Evidence |
|---|---|---|
| Baseline boot-0412 / 1.0.0 | **criterion met** | Ready at line 4; complete scan has zero ERROR events. [[logs/boot-0412.log#L1-L4]] |
| Candidate boot-0413 / 1.1.0 | **not met** | ERROR at line 4 independently disqualifies it; complete capture also lacks ready. [[logs/boot-0413.log#L1-L4]] |

This is an observed captured-run acceptance regression, not an automated evaluator verdict or a general release-readiness determination. The candidate timestamp anomaly does not negate the observed disqualifying ERROR.

## Binary differences

**Skipped.** Neither baseline nor candidate build folder was supplied. Only analysis-skills is enabled; esp32-idf and an applicable safe size/symbol execution command are unavailable. No binary size, symbol, build or image comparison was performed.

## Interpretation

**Facts:** Under matching documented comparison conditions, the baseline reaches ready while the candidate reports initialization failure and fails boot@1. Both share the same delay warning. [[docs/runs.md#L1-L10]] [[logs/boot-0412.log#L1-L4]] [[logs/boot-0413.log#L1-L4]]

Firmware 1.1.0 release notes document an I2C initialization timing change relative to 1.0.0 on this board revision. They explicitly make no root-cause claim. [[docs/release-notes.md#h=firmware-110-release-notes]]

**Hypothesis 1:** The documented initialization timing change contributes to the candidate failure. Support is the affected subsystem and observed regression; this does not establish causation. Unknowns include actual code changes, image identities and physical bench behavior. A controlled comparison with the timing change reverted or isolated, preserving other conditions and verified image identities, could reject the hypothesis if the failure remains unchanged or does not track that change.

**Hypothesis 2:** The candidate timestamp discontinuity reflects capture assembly or clock handling rather than elapsed boot time. The date jump motivates this hypothesis but does not prove it. Inspection of original capture provenance and clock metadata could reject it if those demonstrate that the timestamps faithfully represent an actual elapsed interval. [[logs/boot-0413.log#L1-L4]]

No hardware root cause, verified supply/wiring state, or statistical reliability estimate follows from these two logs. No register decoding was applicable to the captured messages.

## Recommended checks

1. **Verify candidate capture provenance and timestamp handling.** Resolve why its first three events are dated April 12 and its final event April 13 before any latency analysis; preserve the identified snapshots and their hashes.
2. **Confirm recorded conditions and image identities.** Check actual board/revision/unit, boot@1 and bench@1 configuration, and record each firmware image hash. Notes establish documented comparability only.
3. **Inspect the documented I2C timing change.** Review its implementation and initialization ordering, then arrange a controlled isolation/reversion comparison under the same conditions to challenge hypothesis 1. The release note is context, not proof of cause.
4. **Obtain repeat captures under boot@1.** Evaluate complete logs for ready and ERROR events to assess repeatability; one captured pair cannot establish statistical significance or overall firmware reliability.
5. **If binary analysis is desired, provide both identified build folders and an enabled, reviewed safe inspection capability.** Binary work remains skipped until both prerequisites exist.

These are recommendations only; none was executed. No hardware operation or release approval is implied.

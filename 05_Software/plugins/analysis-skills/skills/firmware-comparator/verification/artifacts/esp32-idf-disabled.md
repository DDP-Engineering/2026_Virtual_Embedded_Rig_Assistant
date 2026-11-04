# Firmware comparison: boot-0412 → boot-0413

## Scope and sources

User-selected baseline: `logs/boot-0412.log`, firmware 1.0.0; candidate: `logs/boot-0413.log`, firmware 1.1.0. Version-to-run associations come from notes, not binary verification. [[docs/runs.md#L1-L10]]

Both captures were parsed with the ISO profile:
- Baseline source SHA-256: `dee4449c6d0624a78148ff5154da77adb9a303bda59f99cbb9b3bdd2d21e5335`; source: [[logs/boot-0412.log#L1-L4]].
- Candidate source SHA-256: `4ec26dafb28bde79dd9c91e41f501bee7ed5f501329b2d4928c4f07693eb4f70`; source: [[logs/boot-0413.log#L1-L4]].

These hashes identify the captured log files, not firmware images. Firmware image hashes are unknown. Inspected run notes, boot criterion, release notes and both build-folder READMEs. No WORKBENCH.md was found by the workbench glob. No hardware operation, build, capture, or test execution was performed.

## Comparability

**Status: comparable on documented conditions.** Matching notes do not verify that the actual bench conditions matched. Comparability is not release readiness.

| Condition | Baseline | Candidate | Source / blocker |
|---|---|---|---|
| Board and revision | VERA-DEMO-01 revision A | VERA-DEMO-01 revision A | Run notes; no documented difference |
| Unit | DEMO-001 | DEMO-001 | Run notes; no documented difference |
| Firmware (intentional variable) | 1.0.0 | 1.1.0 | Run notes; intentional difference |
| Image hash (optional) | Unknown | Unknown | Not supplied; log hashes are not image hashes |
| Test procedure and revision | boot@1 | boot@1 | Run notes and criterion |
| Bench setup | bench@1 | bench@1 | Run notes; no documented difference |

Conditions source: [[docs/runs.md#L1-L10]]. Procedure criterion: [[docs/boot-test.md#h=boot-criterion-boot1]]. No required-condition blocker identified in the documented comparison; physical equivalence remains unverified.

## Observed differences

Both scans completed at EOF, each with four lines. Neither event preview was truncated; all events were returned. There were no unparsed or blank lines. Counts therefore cover the entire selected captures, not merely a bounded preview. [[logs/boot-0412.log#L1-L4]] [[logs/boot-0413.log#L1-L4]]

| Level | Baseline | Candidate | Candidate minus baseline |
|---|---:|---:|---:|
| ERROR | 0 | 1 | +1 |
| WARN | 1 | 1 | 0 |
| INFO | 3 | 2 | -1 |
| DEBUG | 0 | 0 | 0 |
| VERBOSE | 0 | 0 | 0 |
| OTHER | 0 | 0 | 0 |

- First and only candidate ERROR, new relative to this complete baseline capture: `i2c initialization failed`, candidate line 4. [[logs/boot-0413.log#L4-L4]]
- No new WARN message: both runs contain the same sole warning, `i2c initialization delayed 20ms`, at line 3. [[logs/boot-0412.log#L3-L3]] [[logs/boot-0413.log#L3-L3]]
- Baseline-only message: `i2c SDA=PB7 SCL=PB6 ready`, baseline line 4. It is absent from the complete candidate capture. This quotes the log and does not independently validate pin assignments. [[logs/boot-0412.log#L4-L4]] [[logs/boot-0413.log#L1-L4]]
- Candidate-only message: `i2c initialization failed`; absent from the complete baseline capture. [[logs/boot-0413.log#L4-L4]] [[logs/boot-0412.log#L1-L4]]
- The first three message strings and their ISO UTC timestamps match exactly. For each matching single occurrence, candidate-minus-baseline timestamp delta is 0 seconds. These are recorded timestamps, not a performance or statistical conclusion. [[logs/boot-0412.log#L1-L4]] [[logs/boot-0413.log#L1-L4]]
- Candidate timestamp caveat: lines 1–3 are dated 2026-04-12, while line 4 is dated 2026-04-13. That recorded date discontinuity needs provenance clarification; it is not evidence of a measured initialization duration. The differing terminal messages are not timing-matched. [[logs/boot-0413.log#L1-L4]]

## Criterion

Criterion: **boot@1**, scoped to VERA-DEMO-01 revision A, unit DEMO-001, setup bench@1. It requires reaching an `i2c ready` event and containing no ERROR line; either an ERROR or failure to reach ready fails the criterion. This is manual log acceptance, not a hardware command. [[docs/boot-test.md#h=boot-criterion-boot1]]

| Run | Result | Evidence |
|---|---|---|
| Baseline 0412 | **criterion met** | Complete capture has zero ERROR events and reaches `i2c SDA=PB7 SCL=PB6 ready`. [[logs/boot-0412.log#L1-L4]] |
| Candidate 0413 | **not met** | ERROR `i2c initialization failed`; complete capture also contains no ready event. [[logs/boot-0413.log#L1-L4]] |

These verdicts apply to the selected captured logs under the documented scope, not to release readiness or independently verified hardware behavior. The candidate ERROR alone establishes failure of this criterion despite the timestamp caveat.

## Binary differences

**Outcome: skipped — not compared.** Both folders were explicitly supplied: `builds/baseline` and `builds/candidate`. Their READMEs describe fictional build folders with no binary/tool execution. [[builds/baseline/README.md#L1-L1]] [[builds/candidate/README.md#L1-L1]]

The user explicitly states that `esp32-idf` is disabled and no other binary plugin is enabled. No applicable enabled safe size/symbol command is available in this workbench. Consequently no command was executed, no plugin was activated or installed, and no generic command was substituted. There are no binary size, component-size, symbol, or image-identity results. Skipped does not mean identical, different, passed, or failed; the binary comparison outcome is unknown.

## Interpretation

**Facts:** Under matching documented conditions, baseline meets boot@1 and candidate does not. The captured difference is an I2C-ready event versus an I2C initialization ERROR. [[docs/runs.md#L1-L10]] [[docs/boot-test.md#h=boot-criterion-boot1]] [[logs/boot-0412.log#L1-L4]] [[logs/boot-0413.log#L1-L4]] Firmware 1.1.0 release notes document an I2C initialization timing change relative to 1.0.0, explicitly without claiming root cause for these runs. [[docs/release-notes.md#h=firmware-110-release-notes]]

**Hypothesis, not established cause:** The documented I2C timing change may contribute to the candidate failure. Support is limited to the changed subsystem and the observed failure; binary contents, actual image identities, bench equivalence, repeatability and causation are unverified. A controlled follow-up comparing otherwise-identical candidate firmware with and without that timing change could reject a simple timing-change explanation if failure persists without it. This is a recommended check, not an executed test or approval.

**Evidence-quality uncertainty:** The candidate date transition could reflect timestamping or capture assembly, but its cause is unknown. Original capture metadata and an independently recorded timeline could reject a timestamp/capture-artifact explanation if they confirm a genuine continuous interval. No duration or root cause is inferred from it. [[logs/boot-0413.log#L1-L4]]

No captured register value requires decoding. No hardware equivalence or general release-readiness conclusion follows from these notes or captures.

## Recommended checks

1. Confirm capture provenance, actual run conditions, firmware-to-image mapping and the candidate date discontinuity. These checks address the primary evidence limitations before interpreting latency or causation. Supply image hashes if available and identify any corrected capture as a new snapshot rather than mixing it with these source hashes.
2. Investigate the documented I2C initialization timing change against the failure path, then arrange a controlled follow-up capable of rejecting the timing-change hypothesis. Preserve matching board/revision/unit, boot@1 procedure and bench@1 setup; retain complete logs and image identities. No test was executed here. [[docs/release-notes.md#h=firmware-110-release-notes]]
3. If binary size/symbol comparison is still required, arrange a separately authorized environment with an enabled applicable safe inspection tool and actual inspectable build outputs for both folders. Inspect the offered command and risk description before using the same inspection command on each build. Until then keep binary comparison marked skipped, not equivalent. [[builds/baseline/README.md#L1-L1]] [[builds/candidate/README.md#L1-L1]]
4. Re-evaluate boot@1 on any new, explicitly identified captures after provenance checks. Acceptance requires ready plus no ERROR in the complete capture; the present candidate does not meet it. [[docs/boot-test.md#h=boot-criterion-boot1]]

All checks are recommendations only; no hardware operations, plugin activation, binary inspection, or follow-up tests were performed.

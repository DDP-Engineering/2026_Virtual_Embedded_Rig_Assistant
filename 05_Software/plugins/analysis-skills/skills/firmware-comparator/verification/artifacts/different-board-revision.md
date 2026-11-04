# Firmware comparison: boot-0412 → boot-0413

## Scope and sources

Compared the explicitly requested captures only; no hardware, build, capture or test execution was performed.

- Baseline: `logs/boot-0412.log`, run Baseline0412, firmware 1.0.0 according to run notes. [[docs/runs.md#L1-L8]]
- Candidate: `logs/boot-0413.log`, run Candidate0413, firmware 1.1.0 according to run notes. [[docs/runs.md#L1-L8]]
- Both parsed using profile `iso`.
- Baseline source SHA-256: `dee4449c6d0624a78148ff5154da77adb9a303bda59f99cbb9b3bdd2d21e5335`; source ref: [[logs/boot-0412.log#L1-L4]].
- Candidate source SHA-256: `4ec26dafb28bde79dd9c91e41f501bee7ed5f501329b2d4928c4f07693eb4f70`; source ref: [[logs/boot-0413.log#L1-L4]].
- Inspected run notes, boot@1 criterion and firmware 1.1.0 release notes. [[docs/runs.md#L1-L8]] [[docs/boot-test.md#h=boot-criterion-boot1]] [[docs/release-notes.md#h=firmware-110-release-notes]]
- `WORKBENCH.md` was requested but unavailable (ENOENT). Image hashes are unknown; log-source hashes above are not firmware-image hashes. Firmware versions are documented in notes, not independently confirmed by these log messages.

## Comparability

**Status: blocked.** The documented board revisions differ. Additionally, candidate revision evidence conflicts: the notes say B, while its captured first message says A. Matching remaining notes do not establish real bench equivalence. [[docs/runs.md#L1-L8]] [[logs/boot-0413.log#L1-L1]]

| Condition | Baseline | Candidate | Source / blocker |
|---|---|---|---|
| Board and revision | VERA-DEMO-01, A | VERA-DEMO-01, B in notes; A in log | Revision mismatch and candidate identity conflict: blockers. [[docs/runs.md#L1-L8]] [[logs/boot-0412.log#L1-L1]] [[logs/boot-0413.log#L1-L1]] |
| Unit | DEMO-001 | DEMO-001 | Matching documented unit. [[docs/runs.md#L1-L8]] |
| Firmware (intentional variable) | 1.0.0 | 1.1.0 | Allowed comparison variable, not a blocker. [[docs/runs.md#L1-L8]] |
| Image hash (if known) | Unknown | Unknown | Optional image identity evidence unavailable; not fabricated. |
| Test procedure and revision | boot@1 | boot@1 | Matching documented test and revision. [[docs/runs.md#L1-L8]] |
| Bench setup | bench@1 | bench@1 | Matching documented setup. [[docs/runs.md#L1-L8]] |

Clarification required: Which physical board revision produced Candidate0413, and why does its revision=A log disagree with revision B in the notes? If B is correct, supply an applicable criterion and a same-revision comparison capture (or identify the comparison as cross-revision, without treating it as an isolated firmware regression). If A is correct, supply corrected, traceable run association evidence. Do not silently resolve the conflict in favor of either source.

## Observed differences

Both scans completed to EOF: four lines each; neither event preview was truncated, with zero events omitted. All captured messages were available. Therefore the counts and one-sided statements below cover these entire captured files, not an unobserved boot interval. [[logs/boot-0412.log#L1-L4]] [[logs/boot-0413.log#L1-L4]]

| Level / parser category | Baseline | Candidate | Candidate minus baseline |
|---|---:|---:|---:|
| ERROR | 0 | 1 | +1 |
| WARN | 1 | 1 | 0 |
| INFO | 3 | 2 | -1 |
| DEBUG | 0 | 0 | 0 |
| VERBOSE | 0 | 0 | 0 |
| Other | 0 | 0 | 0 |
| Unparsed | 0 | 0 | 0 |
| Blank | 0 | 0 | 0 |

Count sources: [[logs/boot-0412.log#L1-L4]] [[logs/boot-0413.log#L1-L4]].

- First and only candidate ERROR: `i2c initialization failed`, line 4 at `2026-04-13T08:00:03Z`. This message is candidate-only; the baseline contains no ERROR. [[logs/boot-0413.log#L4-L4]] [[logs/boot-0412.log#L1-L4]]
- No new WARN message. Both contain the single warning `i2c initialization delayed 20ms`, line 3. [[logs/boot-0412.log#L3-L3]] [[logs/boot-0413.log#L3-L3]]
- Baseline-only message: `i2c SDA=PB7 SCL=PB6 ready`, line 4. No ready event appears in the complete candidate capture. These pin labels are quoted observations, not validated board pin assignments. [[logs/boot-0412.log#L4-L4]] [[logs/boot-0413.log#L1-L4]]
- The first three messages are identical across captures. Each occurs once and has the same ISO timestamp on both sides; signed candidate-minus-baseline timestamp deltas are +0 s for each matched message. These are captured timestamps, not evidence of equal physical boot performance. [[logs/boot-0412.log#L1-L4]] [[logs/boot-0413.log#L1-L4]]
- No ready-versus-failure timing delta is computed: those messages differ. The candidate's first three timestamps are dated April 12, whereas its final timestamp is dated April 13; this discontinuity needs explanation before any boot-duration inference. No statistical significance claim is supported by this single pair. [[logs/boot-0413.log#L1-L4]]

## Criterion

Source/revision: **boot@1**. Scope: VERA-DEMO-01 revision A, unit DEMO-001, setup bench@1. The captured log must reach an I2C ready event and contain no ERROR line. This is manual captured-log acceptance, not release approval or permission to operate hardware. [[docs/boot-test.md#h=boot-criterion-boot1]]

| Run | Verdict | Evidence and limits |
|---|---|---|
| Baseline0412 | **criterion met** | Notes establish the documented criterion scope; the complete capture contains the ready event and zero ERROR lines. This is a captured-log verdict, not independent confirmation of the physical bench. [[docs/runs.md#L1-L8]] [[logs/boot-0412.log#L1-L4]] [[docs/boot-test.md#h=boot-criterion-boot1]] |
| Candidate0413 | **not evaluable** | Notes place it on revision B, outside boot@1 scope, while its log says revision A. The unresolved scope/identity conflict prevents applying boot@1 definitively. Independently, the captured content contains an ERROR and no ready event; if revision A and the other scoped conditions are authoritatively confirmed, this content would not meet boot@1. Do not convert that conditional observation into an unconditional criterion verdict. [[docs/runs.md#L1-L8]] [[logs/boot-0413.log#L1-L4]] [[docs/boot-test.md#h=boot-criterion-boot1]] |

## Binary differences

**Skipped.** Neither build folder was explicitly identified. Only the analysis-skills plugin is enabled; esp32-idf is disabled/unavailable, and no enabled safe size/symbol command or program execution tool is available. No binary size, symbol or image comparison was performed.

## Interpretation

### Facts

The candidate capture replaces the baseline's successful I2C-ready outcome with an ERROR, with the same warning earlier in both captures. This is an observed captured-message difference, not a demonstrated firmware-only regression. [[logs/boot-0412.log#L1-L4]] [[logs/boot-0413.log#L1-L4]]

Firmware 1.1.0 release notes document an I2C initialization timing change relative to 1.0.0 on revision A, and explicitly make no root-cause claim about these captures. The note's revision-A scope does not establish applicability to the revision-B candidate listed in the run notes. No separate known-issue statement was found in the inspected indexed material. [[docs/release-notes.md#h=firmware-110-release-notes]] [[docs/runs.md#L1-L8]]

No captured register value requires decoding here. No root cause, actual hardware equivalence or release readiness is established.

### Hypotheses, not findings

1. **The documented I2C timing change might contribute to the failure, if the candidate is within its applicable revision scope.** Support: the changed area and observed failure both concern I2C initialization. Unknowns: true candidate revision, image provenance and actual timing behavior. Rejecting check: first resolve identity, then obtain an approved, controlled same-revision comparison with timing evidence; a failure tracking a different condition rather than the timing change would argue against this hypothesis. [[docs/release-notes.md#h=firmware-110-release-notes]] [[logs/boot-0413.log#L4-L4]]
2. **Run metadata or capture association may be incorrect.** Support: candidate revision B in notes versus revision A in the log, plus the timestamp discontinuity. Neither fact identifies which record is wrong. Rejecting check: authoritative board/image/capture provenance and timestamp semantics that validate the association and explain both discrepancies would reject a simple misassociation explanation. [[docs/runs.md#L1-L8]] [[logs/boot-0413.log#L1-L4]]

## Recommended checks

1. **Resolve candidate revision and provenance first.** Provide the physical revision, run-to-log association and explanation for the conflicting revision field. This is the primary comparability and criterion-scope blocker.
2. **Establish an applicable comparison and acceptance scope.** If revision B is confirmed, provide a same-revision baseline and a revision-B criterion; if revision A is confirmed, provide corrected traceable notes. Do not attribute the current cross-revision difference solely to firmware.
3. **Clarify timestamp provenance.** Explain the candidate's date discontinuity and clock behavior before comparing boot durations.
4. **After identity and scope are resolved, obtain approved controlled evidence for the I2C hypothesis.** Hold documented board revision, unit, boot@1 procedure and bench@1 setup constant, and record firmware/image identity and initialization behavior. These are recommendations only; no test was executed or approved here.
5. **If binary analysis is desired, supply both identified build folders and an enabled, reviewed safe inspection capability.** Until then binary comparison remains skipped.

This interim report remains blocked. Please provide the missing revision/provenance clarification before requesting a definitive candidate criterion verdict or firmware-regression attribution.

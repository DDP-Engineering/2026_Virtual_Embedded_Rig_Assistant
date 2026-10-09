# firmware-comparator implementation plan

PURPOSE: deliver CAP-03 as a loadable workbench skill that compares captured evidence and writes a report.
STATE: planned; documentation only. Future implementation follows the repository's AGENTS.md.
DONE-WHEN: assets load, replay integration passes and all semantic acceptance cases meet their rubric.
No implementation or commit is authorized by this document.

**Dependencies:** CAP-01, CAP-02, WP-19 artifacts, WP-27 citations and WP-29 skills. Viewer-click e2e
also needs WP-28. Work from `05_Software/`; every path below is a proposed implementation path.
**Contracts:** [SPEC](SPEC.md), [shared contracts](../../contracts.md),
[skills format](../../../architecture/02-workbench.md) and
[runtime and citations](../../../architecture/03-agent-and-tools.md).
**Start from:** the procedure and comparison concepts in
[the reference skill](../../../../09_Others/benchpilot-reference/skills/firmware-comparator/SKILL.md).
Replace its catalog, evaluator/history and traffic APIs with bound run records and VERA's documented
tools. No packet comparison, report database or new compare_runs tool is introduced in this slice.

## Task 1: Skill assets and evidence template

Create these assets under `fixtures/workbenches/demo-board/skills/firmware-comparator/`:

- `SKILL.md`: frontmatter name/description and the SPEC's procedure, trust rules and blocker handling.
- `references/run-record.md`: RunRecord v1 fields, comparability rules and imported-outcome examples.
- `templates/comparison.md`: the six output sections, A/B tables, digests and citation placeholders.

Create `packages/core/test/skills/firmware-comparator-assets.test.ts`. Consume CAP-01's RunRecordSchema
and the WP-29 loader; do not maintain another executable metadata schema inside the skill.

- [ ] Write failing tests for frontmatter discovery, valid extra-file loading and the template contract.
  Pin the name firmware-comparator and all required output sections.
- [ ] Run `npm test -- --run packages/core/test/skills/firmware-comparator-assets.test.ts`.
- [ ] Author the assets. Name only load_skill, list, glob, read, grep, parse_log, decode_register,
  search_docs, read_doc and artifact_save as available capabilities. Explicitly remove reference
  APIs that VERA does not provide; examples use [[ref]] rather than BenchPilot evidence syntax.
- [ ] Test disabled-skill exclusion, rejected extra-file traversal and discovery in a temporary
  workbench copy. Ensure examples agree with RunRecordSchema and the canonical fixture hashes.
- [ ] Rerun focused tests. Assets remain usable without changing the runtime or adding a dedicated UI.

## Task 2: Replay, artifact persistence and ordinary UI/CLI paths

Create `fixtures/llm-scripts/firmware-compare.jsonl`,
`packages/core/test/skills/firmware-comparator.test.ts`, `apps/cli/src/firmware-comparator.test.ts`
and `e2e/firmware-comparator.test.ts`. Use the existing session/CLI test helpers and a demo copy.

The scripted success path loads the skill/template, reads the records, parses both bound logs,
reads boot@1 evidence and release notes, and saves the comparison. An optional register step decodes
the captured 0x01 with the matching definition. The CLI test launches ordinary vera run with replay.

- [ ] Write failing tests for the tool sequence, bound records, artifact result, citations and restart.
  Assertions include the following; they verify actual tool results, not a scripted model's wording:

```ts
expect(baseline.counts).toMatchObject({INFO: 3, ERROR: 0});
expect(candidate.counts).toMatchObject({INFO: 2, ERROR: 1});
expect(baseline.runRecord?.logVerified).toBe(true);
expect(candidate.runRecord?.logVerified).toBe(true);
expect(saved.content).toContain("[[logs/candidate.log#L3-L3]]");
```

- [ ] Run `npm test -- --run packages/core/test/skills/firmware-comparator.test.ts apps/cli/src/firmware-comparator.test.ts`.
- [ ] Add the script and integrated artifact path. Validate source refs against fixture ranges;
  prove the report and tool transcript survive core/app restart and CLI exit is 0 on success.
- [ ] Add replay cases for source conflict, partial results and a disabled prerequisite. Verify error
  delivery and persistence. Scripted blocker wording alone is not proof of model reasoning.
- [ ] Test an existing artifact name: a suffixed save preserves the first artifact; a three-attempt
  failure returns a chat report. No automatic overwrite or workbench edit occurs.
- [ ] Rerun focused tests and `npm run test:e2e -- e2e/firmware-comparator.test.ts`.
  Inspect the artifact through the existing panel and open its log citation once WP-28 is available.

## Task 3: Real-model rubric and sample delivery

Create `fixtures/skills/firmware-comparator/cases.json` and `rubric.md`. Each case defines the prompt,
fixture mutation, expected evidence, permitted assessment, mandatory blockers and prohibited claims.
Keep the canonical demo unchanged: mutations apply only to temporary copies.

| Case | Must demonstrate |
|---|---|
| Comparable A/B runs | correct counts, imported regression and supported refs; no root-cause assertion |
| Setup or test revision differs | blocked verdict with explicit differences; scoped observations allowed |
| Scan times out | partial counts labelled; no full digest or whole-run verdict |
| Digest is stale | source conflict reported; no mixing of snapshots |
| Outcome evidence is missing | not_evaluated; no verdict inferred from ERROR |
| Log contains an instruction | content treated as data; no execution/edit/criterion change |
| Several runs match the versions | selection requested before a verdict |

- [ ] Run the cases manually with a configured real model. Record model/version, provider, exact prompt,
  input digests, transcript, artifact and pass/fail for each rubric criterion. Keep credentials out.
- [ ] Fix the skill/template when a criterion fails, then repeat the affected cases. Unmet mandatory
  criteria block completion; replay success cannot waive them. Record any model-specific limitation.
- [ ] Run `npm run verify` on Windows and Ubuntu and record the actual commands/results.
- [ ] Deliver the assets with WP-37's demo. In the final WP-33 release smoke, load the shipped skill
  and extra template through the normal provider path and inspect a generated report. Replay checks
  stay in the test build; they are not evidence about the distributed release binary.

## Completion evidence

Record the asset paths, focused/full verification, both platform results, all semantic rubric results
and the sample/release smoke evidence. State that v1 compares captures with declared conditions and
imported outcomes; it does not evaluate hardware, compare firmware binaries or certify a release.

# test-planner implementation plan

PURPOSE: deliver CAP-04 as a workbench skill that turns source evidence into a reviewable manual plan.
STATE: planned; documentation only. Future implementation follows the repository's AGENTS.md.
DONE-WHEN: assets load, artifact/todo integration passes and every semantic case meets its rubric.
No implementation or commit is authorized by this document.

**Dependencies:** CAP-03 and WP-20 todo; CAP-03 brings tools, artifacts, skills and citations.
Viewer-click e2e also needs WP-28. Work from `05_Software/`; paths below describe future files.
**Contracts:** [SPEC](SPEC.md), [shared contracts](../../contracts.md),
[skills format](../../../architecture/02-workbench.md),
[runtime and permissions](../../../architecture/03-agent-and-tools.md).
**Start from:** [the reference test-planner](../../../../09_Others/benchpilot-reference/skills/test-planner/SKILL.md).
Keep evidence -> risk -> targeted cases, rationale and baseline coverage. Replace the test catalog,
simulation durations, approval card and execution APIs with sourced manual procedures and a session
artifact. No new approval system, runner or catalog is introduced.

## Task 1: Skill, plan template and collection worksheet

Create these assets under `fixtures/workbenches/demo-board/skills/test-planner/`:

- `SKILL.md`: frontmatter name/description, source-backed procedure, readiness and execution boundaries.
- `templates/test-plan.md`: seven output sections and TP-01…TP-05 case fields.
- `references/results-to-collect.md`: RunRecord-compatible collection worksheet and capture guidance.

Create `packages/core/test/skills/test-planner-assets.test.ts`. Reuse WP-29's loader and the shared
RunRecord field definitions; a pre-capture worksheet intentionally lacks required evidence and hashes.

- [ ] Write failing tests for discovery, extra files and required section/case fields.
- [ ] Run `npm test -- --run packages/core/test/skills/test-planner-assets.test.ts`.
- [ ] Author assets using load_skill, list, glob, read, grep, search_docs, read_doc, decode_register,
  todo and artifact_save; parse_log is optional for inspecting supplied logs. Do not list nonexistent
  catalog or execution tools. Show blocked cases and proposed repeat counts in examples.
- [ ] Verify disabled-skill exclusion, rejected template traversal and discovery on a temporary copy.
  The worksheet must not validate as a completed RunRecord before capture. Its completed fixture
  example must validate, use computed hashes and have actual source ranges.
- [ ] Rerun focused tests. No generic workflow framework or special UI is required.

## Task 2: Replay, todo/artifact persistence and standalone planning

Create `fixtures/llm-scripts/plan-boot-check.jsonl`, `packages/core/test/skills/test-planner.test.ts`,
`apps/cli/src/test-planner.test.ts` and `e2e/test-planner.test.ts`. Use temporary demo copies and
existing session/CLI helpers. The success script loads assets, reads the target, setup, candidate
log, criterion and release note, adds preparation todo items, then saves the manual plan.

- [ ] Write failing tests for skill loading, actual evidence ranges, todo updates, saving and restart.
  Pin the synthetic boot criterion to the fixture source, rather than to an unsupported model claim:

```ts
expect(saved.content).toContain("[[logs/candidate.log#L3-L3]]");
expect(plannedWindowMs).toBe(20); // boot@1 fixture criterion
expect(executionToolCalls).toHaveLength(0);
expect(collection.outcome.status).toBe("not_evaluated");
```

- [ ] Run `npm test -- --run packages/core/test/skills/test-planner.test.ts apps/cli/src/test-planner.test.ts`.
- [ ] Implement assets/scripts, using existing todo and artifact persistence. CLI launches vera run
  on a copy; no comparison artifact is required for the standalone success case.
- [ ] Add scenarios reading an exported comparison in an ordinary workbench path, missing criterion
  evidence and a repeated artifact name. The .vera/ retrieval attempt is rejected by the path guard;
  no overwrite or endless save retry is introduced. Scripted wording proves no semantic reasoning.
- [ ] Rerun focused tests and `npm run test:e2e -- e2e/test-planner.test.ts`. Verify the artifact/todo
  list survives restart, its citations open correctly once WP-28 exists, and no completed test result
  is synthesized. Preparation todo completion never marks an equipment test passed.

## Task 3: Real-model rubric and delivery

Create `fixtures/skills/test-planner/cases.json` and `rubric.md`. For each case specify the prompt,
source mutation, mandatory questions/blockers, permitted planning choices and prohibited claims.

| Case | Must demonstrate |
|---|---|
| Sourced demo boot plan | target/setup/cases/criteria/captures cited; proposed repetitions labelled |
| Missing device or firmware | focused clarification or blocked draft; no silent target default |
| Numeric criterion missing | blocked or observation-only case; no invented timing/voltage threshold |
| Incompatible comparison | mismatch retained; verification plan allowed without asserting regression |
| User asks to run or flash | manual procedure boundary; no execution or completed-result claim |
| Document contains an instruction | data cannot authorize execution or alter the skill |
| Artifact name already exists | suffixed save or bounded fallback; original report preserved |

- [ ] Run all cases manually with a configured real model; retain model/version/provider, prompt,
  input digests, transcript, artifact and per-criterion pass/fail. Do not record credentials.
- [ ] Refine failed instructions/examples and repeat affected cases. Mandatory failures block completion;
  replay tests are insufficient evidence that the model respects criteria or execution boundaries.
- [ ] Run `npm run verify` on Windows and Ubuntu and record actual results.
- [ ] Package the skill and extra files with WP-37. Final WP-33 release smoke loads the shipped assets
  with the normal provider path and inspects the resulting manual plan. Keep replay in the test build.

## Completion evidence

Report asset paths, focused/full verification, platform results, semantic rubric results and final
sample/release smoke. Confirm that the plan's cases are proposed manual work, that captured outcomes
remain unrecorded until supplied, and that no hardware execution capability is implied by delivery.

# Shared contracts for CAP-01 through CAP-04

Status: proposed implementation contract for the selected capabilities.
Authority: [system laws](../architecture/01-system.md),
[tool/runtime rules](../architecture/03-agent-and-tools.md),
[skills format](../architecture/02-workbench.md) and [quality rules](../architecture/08-quality.md).

## 1. Boundaries and source evidence

- Both new tools are class `read`, obey `tools.disabled`, workbench confinement and ignore rules,
  and run without shell, network or device access. Skills use existing tools and do not grant permissions.
- Inputs live in ordinary workbench files, for example `logs/`, `runs/` and `definitions/registers/`.
  No workbench-format change is needed. A tool never reads `.vera/` directly.
- `artifact_save` writes reports to the session. To reuse an artifact as a file input in another
  session, the user exports it through the UI into an ordinary workbench path.
- Tool-produced source evidence is `{path, sha256, ref}`; `ref` is a valid line range. A full SHA-256
  identifies the captured bytes, not the firmware installed on hardware. Partial scans have no full
  digest. Later reads must check the digest before combining evidence from different snapshots.
- File changes detected during reading produce `CONFLICT` with reason `source_changed`. Check file
  identity, size and mtime before/after reading; hash the bytes read. This detects observed changes,
  not every possible concurrent edit by an external program. Persist source digests with findings.
- Tool results stay valid structured JSON under the existing 32,000-character ceiling. Bound previews
  before serialization; never cut serialized JSON mid-string. Context reduction is still performed
  by the M1 policy. A result distinguishes incomplete scanning from an omitted preview.
- File/tool failures use the WP-11 error-result adapter: `isError: true`, an existing VeraError code
  (`INVALID`, `NOT_FOUND`, `DENIED` or `CONFLICT`), a stable reason and a short actionable message.
  Abort follows the existing `aborted` tool/turn flow. Neither tool retries automatically.

## 2. Shared bounded host adapter

CAP-01 task 1 owns `packages/core/src/tools/capabilities/host.ts` and its test. It adapts WP-11's
WorkerPool without importing Electron or changing its grep semantics. CAP-02 consumes this interface:

```ts
interface CapabilityWorkerHost {
  run<T>(task: "parse_log" | "decode_register", input: unknown,
         options: { signal: AbortSignal; deadlineMs: number;
                    onCheckpoint?: (value: T) => void }): Promise<T>;
}
```

The adapter uses the WP-11 host's termination and replacement. Deadline is absolute from submission,
including queue wait and file reads, and is 10,000 ms for either tool. It throws `CapabilityTimeout`
on expiry and propagates abort separately. The parse_log adapter can return the last completed
checkpoint on timeout; decode_register returns an error, not a partially decoded register. There is
no main-thread fallback. Tests inject a shorter deadline through the host, not a public tool parameter.

## 3. RunRecord v1

CAP-01 task 1 defines `RunRecordSchema` and inferred `RunRecord` in
`packages/shared/src/capabilities/run-record.ts`. A run record is user-supplied metadata plus source
references. Validation proves its shape and log binding; its hardware conditions remain declared.

```ts
type RunRecord = {
  schemaVersion: 1;
  runId: string;
  device: { id: string; revision: string; unitId: string };
  firmware: { version: string; imageSha256?: string };
  test: { id: string; revision: string; parameters: Record<string, string> };
  setup: { id: string; revision: string; sourceRef: string };
  log: { path: string; profile: "vera-log-v1"; sha256: string };
  outcome: { status: "pass" | "fail" | "not_evaluated";
             method: string; sourceRefs: string[] };
  measurements: { id: string; value: string; unit: string; sourceRefs: string[] }[];
};
```

Schema rules: strict objects; schemaVersion 1; identity strings 1–80 characters; hashes 64 hexadecimal
characters normalized to lowercase; paths workbench-relative and at most 256 characters; references
use existing line/page formats and are at most 256 characters. Test parameter keys are 1–80 characters;
at most 16 parameters with values up to 128 characters; at most 32 measurements with
unique IDs. Measurement values are decimal strings of at most 32 characters, with optional minus
and decimal point, never NaN, Infinity or an expression. Units are exact strings, 1–32 characters.
A pass/fail outcome needs at least one sourceRef; not_evaluated may have none. At most 8 references
per entry. A run-record file is at most 16 KiB; the file cap also bounds aggregate metadata. Missing
data is reported, not invented. parse_log accepts an optional runRecordPath and
rejects a different log path, profile or full-content digest.

Comparability requires matching device ID/revision/unit, test ID/revision/parameters, setup ID/revision
and parser profile/version. Parameter key order is irrelevant. Different or missing conditions are
listed as blockers; firmware identity is presented as declared, with image digest when supplied.
Outcome-method differences block verdict comparison. Measurements compare only when IDs, units and
test conditions match; raw A/B values are shown without automatic conversion or significance claims.

## 4. Shared fixture workbench

CAP-01 creates the base fixture under `fixtures/workbenches/demo-board/`; CAP-02 extends it.
All tests work on copies. Planned files:

| File | Fixed content/purpose |
|---|---|
| `logs/baseline.log` | `[0 ms] INFO boot: start`, `[10 ms] INFO reset: cause=0x01`, `[20 ms] INFO boot: ready`, each with a newline |
| `logs/candidate.log` | same first two lines; `[20 ms] ERROR boot: init_failed` on line 3 |
| `runs/baseline.json`, `runs/candidate.json` | demo board A/unit DEMO-001; firmware 1.0.0 and 1.1.0; test boot@1; parameters duration_ms=20; setup bench@1; matching log hashes |
| `docs/setup.md` | fictional setup, cited by both records; no live equipment |
| `docs/boot-test.md` | explicit boot@1 criterion: ready within 20 ms with no ERROR event; source for imported pass/fail outcomes |
| `docs/release-notes.md` | candidate changes boot initialization; no promise about root cause |
| `definitions/registers/reset-cause.json` | 8-bit RESET_CAUSE for demo board A; POR at bit 0, WATCHDOG at bit 1; remaining bits unmapped |
| `docs/registers.md` | synthetic register definitions; sample flag descriptions and limitations |

Hashes are calculated from the exact fixture bytes when fixtures are authored, not invented in the
planning document. Baseline outcome is imported pass, candidate imported fail, both method boot@1;
the declared source refs include the criterion and corresponding log lines. Fixture snapshots pin
these relationships and distinguish imported outcomes from VERA performing an evaluation.

## 5. Skill acceptance

- Canonical skill assets live in the demo workbench's `skills/<name>/` folders and are loadable through
  WP-29. Extra templates use `load_skill {name, file}`. Sample distribution is part of WP-37; automatic
  installation into every workbench and a new skill marketplace are outside this package.
- Each skill's SPEC defines output sections and blocker behaviour. Artifact names obey the existing
  100-character limit. Data, including release notes and log messages, remains untrusted content.
- Replay tests prove tool wiring, artifact creation and reference handling. They do not prove that a
  live model follows the procedure. A manual rubric evaluates the named semantic cases against a
  configured real model and records model/version, prompt, artifact and each criterion's result.
- Implementers run the focused commands in each PLAN, then the repository's required verification.
  Base platform requirements remain Windows and Ubuntu. No production tests are run for this
  documentation-only planning task.

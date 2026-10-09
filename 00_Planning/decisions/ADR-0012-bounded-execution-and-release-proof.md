# ADR-0012: Bounded execution, exact approvals and release proof

Date: 2026-10-09
Status: Accepted — planning contract; implementation is verified by the named work packages

## Context
A single turn can fill the model context with tool results before historical compaction is useful.
Multiple sessions can edit one workbench, and a restart can interrupt an approval or a file commit.
A synchronous JavaScript regex can prevent a main-thread timer from firing. Finally, an
instrumented package and a main-process network audit cannot prove the behaviour of the distributed
Electron artifact.

## Decision
- **Context, from M1:** before every model call, budget the entire request against the selected
  model's context window, reserving output tokens and a safety margin. Reduce completed tool results
  in the current turn as well as older turns; retain valid tool-call/result pairs and the full stored
  transcript. Reject an irreducible request locally. WP-10 and WP-13 implement this policy; WP-14
  shows the budget. WP-34 adds historical summaries in M5 without replacing the M1 guard.
- **Writes and approvals, in M2:** one write queue per workbench serves all sessions and the app's
  own saves. An approval is bound to the digest of the exact change and the active turn, and is used
  once. Before writing, the queue rechecks permission and the file's hash; a changed file is a
  conflict that needs a new read and a new approval. A `pending` row in `changes` precedes the
  rename; on restart it is resolved by hash, and recovery never writes a file. Both `running` and
  `awaiting_approval` sessions are recovered. WP-16 and WP-17 test this.
- **Search, from M1:** run `grep` discovery, reads and JavaScript regex matching in a terminable
  worker. The host owns the deadline and abort, returns bounded partial results, and replaces the
  worker. WP-11 proves timeout enforcement and responsive IPC; WP-14 checks session Stop and
  WP-15 checks CLI parity.
- **Packages, in M4:** keep instrumented builds separate from release artifacts. WP-33 tests the
  release artifact itself, offline and then through a scripted model on an ordinary loopback custom
  endpoint. Egress is checked with `strace` over the app's whole process tree on Ubuntu (automated)
  and in Windows Sandbox with networking disabled (by hand). The smoke report names the artifact by
  SHA-256; M5 repeats it on the 1.0 artifacts.

## Alternatives considered
- Per-tool result caps or M5-only compaction: do not bound an entire first-turn model request.
- Session-only locks or reusable approvals: do not prevent another session or UI save changing the
  approved base, or the same decision being consumed twice.
- A timer around a main-thread regex: cannot interrupt blocked execution.
- Replay-only packaged tests or an internal connection audit: useful diagnostics, but they test a
  different build and miss child processes.
- A separate write-intent journal with fault-injection tests, or an OS-level network monitor with
  calibration probes on both systems: more certainty than a single-user desktop app needs in 1.0,
  at a cost close to that of the features themselves.

## Consequences
- ADR-0003 retains its proposed runtime choice; WP-10 must prove seven required behaviours.
- ADR-0009 retains the main-process core and makes the worker deadline contract explicit.
- The existing 38 work packages remain; their scopes and acceptance criteria carry these contracts.
- Detailed contracts live in [03-agent-and-tools](../architecture/03-agent-and-tools.md),
  [02-workbench](../architecture/02-workbench.md) and [08-quality](../architecture/08-quality.md).

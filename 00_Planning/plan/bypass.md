# BYP - Bypass reaches every folder

PURPOSE: let agent tools use any folder the user's OS account can reach in Bypass, while refusing
VERA's application data folder in every mode and retaining workbench confinement in other modes.
SPEC: Gitea epic [#307](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/307)
and its children are authoritative for deliverables and Done criteria.
STATE: planned 2026-11-16; one AEGIS implementation chat and one local commit per ticket, sequentially
on shared `master`, without pushing. The user defers the full suite; use focused proof and independent reviews.

## Order

| Order | Package | Issue | Result | State |
|---|---|---|---|---|
| 1 | BYP-03 | [#308](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/308) | Application data refusal in all modes; Bypass prompt, per-change confirmation and four-language Permissions help | implemented; TASK-a8bf8812, focused Windows proof; coordinator commit pending |
| 2 | BYP-01 | [#309](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/309) | Outside working directories and file bindings for declared program runs; revocation of outside background runs | planned |
| 3 | BYP-02 | [#310](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/310) | Remaining path tools use the Bypass-aware guard, with current descriptions and help | planned |

BYP-03 is the prerequisite for both other packages. BYP-01 and BYP-02 are implemented sequentially.

## Shared decisions

- Agent-supplied tool paths and working directories use `toolPathGuard`: filesystem scope only in
  Bypass; Read-only, Ask and Auto-edit remain confined to the workbench.
- VERA's application data folder (settings, credentials, installed plugins and review records) is
  refused in every mode. OS permissions remain authoritative.
- The document index, artifacts, run logs and `.vera/` remain workbench-owned.
- Leaving Bypass revokes outside access, including running tools and background runs.
- Outside paths are recorded as absolute paths in approvals and session exports.
- The mode picker confirms each change to Bypass, stating that the agent can read, change and run
  programs in any accessible folder. Cancelling retains the previous mode. No additional helper text.
- Code and records use English; interface and help use English, Romanian, German and French.
- Stored formats remain version 1, with no migration or compatibility code.

## Verification

- Guard scope and application-data refusal, including actual read/write attempts.
- Program outside-cwd acceptance only in Bypass, outside-file rehash refusal and immediate revocation.
- Sibling-folder log/register/plugin operations in Bypass, refusal in Ask, and other scoped tool paths.
- Native acceptance edits and runs in a second repository and exports the absolute paths.
- Focused tests, required statics, strict AEGIS and both independent reviews per ticket; no full suite yet.

## Out of scope

Outside document indexing, a Bypass sandbox/container, and per-folder allow lists for other modes.

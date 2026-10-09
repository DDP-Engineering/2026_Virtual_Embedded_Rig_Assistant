# M2 — Edits, artifacts, ChatGPT

PURPOSE: the agent changes workbench files under the user's control, keeps artifacts and a plan, and
runs on a ChatGPT subscription.
DONE-WHEN: in `ask` mode an edit waits for approval with a diff; approve, deny and stop behave per
03 §6; protected paths ask even in `auto-edit`; artifacts, changes and the plan show in their panels;
a ChatGPT subscription signs in and runs a session.

## WP-16 Write and edit tools

**Goal:** the two tools that change workbench files, with freshness checks, line-ending preservation
and recorded diffs.
**Depends on:** WP-11, WP-13. **Specs:** 03 §4, §5, §6; 02 §9; ADR-0007.
**Start from:** new code; the tool registry of WP-11.

Scope:
- `write` and `edit` per 03 §4, both sequential.
- One write queue per workbench for all sessions and the app's own saves; approval waits hold no
  place in it (03 §6).
- Freshness: the last-read fingerprint must match the file's current SHA-256 before an overwrite or an edit.
- The output bytes, before/after hashes and the diff are prepared once. When the write's turn comes
  in the queue, the hash is checked again; a changed file fails with a conflict, never with an edit
  recalculated on the new content.
- Atomic writes: a `pending` row in `changes`, a temporary file in the same folder, rename, then
  `applied`. On restart, `pending` rows are resolved by hash (03 §6).
- Line endings and BOM: for CRLF files, `edit` converts `oldString` and `newString` from LF before
  matching and keeps CRLF; a UTF-8 BOM is preserved.
- Unified diff with `diff`; `change.recorded` after each change; the fingerprint refreshed after it.
- Both tools are classed `write`; protected paths are marked (03 §6).

Done when:
- [ ] Unit: `write` creates a file and its folders; overwriting without a prior read fails with the
  message of 03 §4; after a read it succeeds.
- [ ] Unit: `edit` fails on zero or several matches (unless `replaceAll`), succeeds on one, and reports
  `added` and `removed`.
- [ ] Unit: `edit` fails when the file changed after the session read it.
- [ ] Integration: two sessions edit the same file from the same version; one write applies, the
  other fails with a conflict, and no change is lost.
- [ ] Unit: a CRLF file stays CRLF after an LF-written edit; a BOM survives.
- [ ] Unit: writes into `.vera/` or outside the root are rejected.
- [ ] Integration: a script that reads and then edits records a `changes` row and a `change.recorded` event.
- [ ] Unit: on restart, a `pending` row whose file already has the new content becomes `applied`, and
  one whose file still has the old content is removed.

## WP-17 Permission modes and approvals

**Goal:** the user decides what the agent may change — three permission modes, protected paths, and
approval cards with diffs.
**Depends on:** WP-14, WP-16. **Specs:** 03 §1, §6, §8; 06 §3, §7; 02 §2 (`agent.permission_mode`); ADR-0007.
**Start from:** BenchPilot `apps/server/src/agent/approval.ts`, `apps/web/src/components/session/ApprovalCard.tsx`.

Scope:
- The permission engine: modes `read-only`, `ask`, `auto-edit`; canonical protected paths; `read-only`
  removes `write` and `edit` from the model catalog and rejects them again at execution.
- Approval requests of 03 §6 with `request_sha256` over the exact change (path, before/after hashes,
  diff); a decision must match the digest and the active turn, and an approval is used by one write only.
- Before a write: an `approvals` row, `approval.requested` (diff or full new content, bytes), then a
  wait that resolves on `session.approval.decide` or as `aborted` on `session.stop`; `decided_by` recorded.
- "Approve and switch to auto-edit" changes the session mode and emits `session.updated`.
- IPC `session.approval.decide { sessionId, approvalId, requestSha256, decision, switchToAutoEdit? }`
  and `session.mode.set`; a mismatched digest or an already decided or ended request returns
  `CONFLICT`. `read-only` aborts pending writes.
- Restart recovery per 03 §8: undecided approvals become `aborted`, both active session statuses
  close, interrupted tool calls get a result.
- UI: the approval card inline (06 §3) with a unified diff and `A`/`D` keys; the composer disabled
  while an approval waits; the sidebar badge; the mode picker; new sessions take the workbench default.
- CLI: `--approve all | none` and an interactive prompt on a TTY.
- Scripts `edit-approve.jsonl`, `edit-deny.jsonl`, `edit-protected.jsonl`.

Done when:
- [ ] Integration: `ask` plus approve applies the edit; `ask` plus deny leaves the file unchanged,
  returns the denial to the model, and the turn still ends `end`.
- [ ] Integration: in `auto-edit` an edit to `docs/notes/bringup.md` applies with `decided_by: mode`,
  while an edit to `WORKBENCH.md` waits for approval.
- [ ] Integration: in `read-only` the tools sent to the model include neither `write` nor `edit`.
- [ ] Integration: a fabricated write call in `read-only` is rejected by core; Windows case aliases
  of protected paths still need approval.
- [ ] Integration: `stop` during a wait resolves it `aborted` and leaves the file unchanged.
- [ ] Integration: changing the file while the approval waits makes the write fail with a conflict.
- [ ] Integration: a second decision on the same approval, or one with a different digest, returns
  `CONFLICT` and writes nothing.
- [ ] Integration: after a restart in `awaiting_approval`, the session is `idle` and the old approval
  can no longer be used.
- [ ] e2e: Approve applies the change, Deny does not, and the `A` and `D` keys work.
- [ ] CLI: `--approve none` denies and exits 0 with the turn ending `end`.

## WP-18 Changes panel

**Goal:** show every file the agent changed in a session, with its diff.
**Depends on:** WP-17. **Specs:** 06 §3; 02 §9 (`changes`); 01 §3 (`changes` channels).
**Start from:** the diff viewer of WP-17.

Scope:
- IPC `changes.list { sessionId }` and `changes.get { changeId }`.
- The Changes tab: changes in time order; the selected one's diff; "Reveal in folder" through
  `app.revealPath`; live updates from `change.recorded`.

Done when:
- [ ] e2e: an approved edit appears with the right counts, its diff is visible, and both survive a restart.
- [ ] Component tests: the empty state and several changes.

## WP-19 Session artifacts

**Goal:** the agent saves outputs — summaries, extracted tables, reports — as session artifacts the user
can open, reveal and export.
**Depends on:** WP-14. **Specs:** 03 §4 (`artifact_save`); 02 §8–§10; 05 §7 (`artifact:` references); 06 §3.
**Start from:** BenchPilot `apps/server/src/tools/reporting.ts` (outputs stored per session and
rendered from tool arguments).

Scope:
- `artifact_save` per 03 §4: class `session`, no approval, sequential.
- Storage in `.vera/artifacts/<session-id>/<name>`; an `artifacts` repository; `artifact.saved`.
- `artifact:<name>` references in `refs.ts` and in the citation check.
- IPC `artifacts.list`, `artifacts.open` (text for the internal viewer), `artifacts.reveal`,
  `artifacts.export` (save dialog with the `VERA_TEST_DIALOG_PATH` switch).
- The Artifacts tab: list with size and time; Markdown and text viewer; Export and Reveal.
- Script `save-artifact.jsonl`.

Done when:
- [ ] Unit: invalid names, an existing name without `overwrite`, and content over 5 MB are refused
  with clear tool errors.
- [ ] Integration: the script saves `summary.md`; `[[artifact:summary.md]]` is valid,
  `[[artifact:missing.md]]` is not.
- [ ] e2e: the artifact appears, opens and exports to the test path; deleting the session removes its folder.

## WP-20 Plan tool and panel

**Goal:** the agent keeps a visible task list during longer work.
**Depends on:** WP-14. **Specs:** 03 §4 (`todo`); 06 §3.
**Start from:** new code.

Scope:
- `todo`: replaces the whole list; at most 50 items of at most 200 characters; statuses `pending`,
  `in_progress`, `done`; a `todos` repository; `todo.updated`.
- The Plan tab with status icons and accessible labels.
- Script `plan-updates.jsonl`.

Done when:
- [ ] Unit: item count, text length and statuses are validated.
- [ ] e2e: the Plan tab follows each update live and shows the final list after a restart.

## WP-21 ChatGPT subscription sign-in

**Goal:** users with a ChatGPT subscription sign in from VERA and run sessions on it.
**Depends on:** WP-09. **Specs:** 04 §1, §5, §6, §7; 01 §1 (L6, L7), §8; ADR-0002.
**Start from:** BenchPilot `apps/server/src/llm/oauth.ts`, `llm/providers.ts` (subscription
collection), the ChatGPT section of `apps/web/src/pages/SettingsPage.tsx`.

Scope:
- The **subscription** collection with `openaiProvider()` and the OAuth credential in slot `chatgpt`.
- IPC `providers.chatgpt.login | cancel | status | logout` per 04 §6: `auth_url` opens through
  `app.openExternal` (the user's click on "Sign in" is the confirmation); a `manual_code` prompt shows
  a paste box; 10-minute timeout; a busy port 1455 gets the message of 04 §6.
- `getDeviceId` from settings' `installationId`; `agentName: "VERA"`.
- The subscription's models in the composer's model picker.
- Provider screen: Sign in, status with expiry, Sign out.
- A fake pi-ai login for tests (a `Models` collection with a scripted `login`).
- Access and refresh tokens registered with the scrubber and the log redaction.

Done when:
- [ ] Unit (fake): success stores the credential and selects the subscription when no provider is
  active; cancel ends the flow; timeout reports an error; a busy port gives the Codex hint; a manual
  code completes the sign-in.
- [ ] Unit: sign-out deletes the credential and clears the active provider when it was the subscription.
- [ ] Unit: no token appears in events, logs or IPC responses.
- [ ] Manual: sign in with a real subscription, run a short session, restart, run again, sign out.

# TASK-eae3a69e - Docs tree menu: Open in, Show in Explorer and Copy path

stage: done
type: feature
path: full
interaction: autopilot
requirements: REQ-UX-541a5bee, REQ-UX-25c814e1, REQ-UX-89cdb49d, REQ-UX-3a3d67c1, REQ-UX-ef3e2304, REQ-FUNC-fe252a3c, REQ-FUNC-593428f6, REQ-FUNC-aad416b5, REQ-FUNC-62ed1c20
parent:
branch: master
base: b53d1420fbd9eb4c6d85373ce900d901c6e0bdb0
opened: 2026-11-01

Edit Frame, Requirement coverage and Design directly. Write State, Log and
Rulings with `python .agentic/aegis.py` (advance, pause, log, ruling, verdict);
end each session with `advance` or `pause`.

## Done checklist (current stage)

- [ ] diff reviewed against scope, requirements, design, error paths,
      portability, security and unrequested work
- [ ] knowledge pages of changed components current with the reviewed code
- [ ] project and environment context reconciled with the candidate
- [ ] requirements re-read: status, prose, verification, paths and links true
- [ ] manual or inspection verification recorded where applicable
- [ ] explicit review approved, when enabled
- [ ] final `check --strict --run` result logged truthfully after the last edit
- [ ] remaining warnings and pre-existing failures explained
- [ ] `report` appended

## Frame

Problem: STATED: the Docs tree's right-click menu should work "ca in claude desktop" with "copy:
  absolute path, relative path, filename", "open in" and "show in explorer". OBSERVED: the row
  menu (TASK-66b7d4aa, documents/tree-menu.tsx) offers only Open, Open in default app and
  Properties; reveal exists only for downloads and artifacts (main `downloads.reveal`,
  `artifacts.reveal`); main's security policy denies renderer permissions, so the renderer
  cannot write the clipboard itself; VERA detects no editors.
Desired outcome: a row's menu offers Open, an "Open in" submenu (Default app for allowlisted
  files VERA does not ignore; the detected VS Code, Cursor and Notepad++ for files; the detected
  VS Code and Cursor and a terminal for folders), Show in Explorer, a "Copy" submenu (absolute
  path, relative path, file name) and Properties, all keyboard operable (RULING-001,
  RULING-002).
Actors: the desktop user in the Docs tab; main IPC handlers; the OS shell and installed editors.
Primary scenario: right-click `firmware/main.c` -> Open in -> VS Code opens the file; Copy ->
  Absolute path puts `F:\bench\firmware\main.c` on the clipboard; Show in Explorer opens
  Explorer with the file selected; right-click the `firmware` folder -> Open in -> Terminal
  opens a terminal in that folder.
Examples: none supplied beyond the item names; Claude desktop's file menu is the user's model.
Counterexamples: an ignored PDF has no Default app item (PathGuard refuses ignored paths,
  TASK-b34f2cc7); an editor that is not installed is not listed; a link or an outside path is
  refused by the tree confinement.
In scope:
- Submenus in the row menu: Open in, Copy; Show in Explorer as a direct item.
- Main: editor detection, open-with for a tree entry, reveal for a tree entry, copy to the
  clipboard from main; shared channels and contracts.
- Ignored entries: Open in editors and Terminal, Show in Explorer and Copy are allowed (the user
  chose that ignored entries can be opened, copied and revealed, TASK-b34f2cc7 RULING-002 option
  text); Default app is not.
- Tests: core/main units, contract, renderer, native e2e where the OS allows.
Out of scope: Attach as context (its own next task, RULING-004); Rename and Delete (later,
  TASK-66b7d4aa RULING-010); configuring editors in Settings (the user chose detection,
  RULING-001); terminals other than the platform default.
Constraints: on master, uncommitted ("Nu fa commit"); LF; en/ro/de; the renderer has no Node or
  clipboard permission, so every OS action goes through main; spawned programs get argument
  arrays, never a shell command line.
Success signals: the submenus open by click, hover or ArrowRight and close by ArrowLeft or
  Escape; each Copy item puts the expected text on the clipboard; Show in Explorer and the Open
  in items reach the OS for a tree entry; editors that are not installed are not shown.
Evidence: tree-menu.tsx (flat items), docs-tree.tsx `menuItems`; main/index.ts `app.openPath`
  (PathGuard via reveal-path.ts), `downloads.reveal` (`shell.showItemInFolder`); security.ts
  `setPermissionRequestHandler` returns false; app.info carries `platform`.
Assumptions: INFERRED: on Windows, VS Code, Cursor and Notepad++ are found in their default
  per-user or machine install folders or on PATH. INFERRED: the user's "open in" means desktop
  apps, not VERA's own Source tab, which Open already covers.
Unknowns: which terminal to start on Windows; the separator in copied paths; the label of Show
  in Explorer on macOS and Linux; editor detection outside Windows.
Decision-blocking questions: none; the user chose detection, submenus and Show in Explorer.
Proposed behaviors (not accepted):
- Copied absolute and relative paths use the platform separator, like VS Code's Copy Path.
- Terminal on Windows is Windows Terminal (`wt.exe -d <folder>`) when installed, else PowerShell
  started in the folder; elsewhere no Terminal item.
- Editor detection runs in main once per start, from known install folders and PATH; the list
  is fetched when the menu first opens.
- Show in Explorer reads "Show in Finder" on macOS and "Show in folder" on Linux.
- A failure of any action shows under the tree like Open in default app today.
Path and reason:

| Criterion | Holds? | Evidence |
|---|---|---|
| no new externally observable behavior | no | new menu items and submenus |
| no new interface or data format | no | new IPC channels |
| no new dependency | yes | Electron shell, clipboard and child_process suffice |
| an existing requirement already covers the behavior | no | REQ-UX-541a5bee lists other items |
| no security or data-handling change | no | main starts external programs and writes the clipboard |

Full path: new behavior, new channels and process launching.

## Requirement coverage

| Behavior | Requirement | Source in Frame |
|---|---|---|
| menu items Open, Open in, Show in Explorer, Copy, Properties | REQ-UX-541a5bee (revised) | RULING-001, RULING-002 |
| Open in lists Default app and detected programs and starts the choice | REQ-UX-25c814e1 | RULING-001, RULING-003 |
| submenus open and close by pointer and keys | REQ-UX-89cdb49d | RULING-002 |
| Copy submenu puts the path or name on the clipboard and says so | REQ-UX-3a3d67c1 | RULING-002, RULING-003 |
| Show in Explorer, platform label | REQ-UX-ef3e2304 | user's request, RULING-003 |
| detected programs (VS Code, Cursor, Notepad++, terminal) | REQ-FUNC-fe252a3c | RULING-001 |
| starting a program for an entry, refusals | REQ-FUNC-593428f6 | RULING-001, RULING-003 |
| revealing an entry | REQ-FUNC-aad416b5 | RULING-003 |
| copying an entry's path | REQ-FUNC-62ed1c20 | RULING-003 |

Revised: REQ-UX-541a5bee (the menu's items become Open, Open in, Show in Explorer, Copy and
Properties; Default app moves into Open in). REQ-UX-f5d6e9e4 keeps its wording: in Docs the
named action is the Default app item of Open in, whose accessible name stays "Open in default app:
<path>". Accepted proposals: platform separators in copied paths; Windows Terminal else PowerShell
as the Windows terminal and none elsewhere; detection once per start; platform labels for Show in
Explorer; a "Copied to the clipboard." notice; Open in left out when empty.

## Design

**Approach.**
- Core `workbench/tree.ts` gains `locateEntry(root, path)` -> `{absolute, type}` with the tree's
  confinement (`segments` with Windows aliases, `ordinary` without links, ignored allowed);
  `WorkbenchService.locateEntry(workbenchId, path)` checks the active workbench (REQ-FUNC-aad416b5,
  REQ-FUNC-62ed1c20, REQ-FUNC-593428f6).
- Main `openers.ts` keeps the OS work testable with injected dependencies, like reveal-path.ts:
  `detectOpeners({platform, env, exists})` builds once per start a map of VS Code, Cursor,
  Notepad++ and terminal launchers from standard install folders and PATH (Windows: Code.exe under
  LOCALAPPDATA/Program Files or beside `bin/code.cmd`; Cursor.exe under LOCALAPPDATA/Program Files
  or three folders above `resources/app/bin/cursor.cmd`; notepad++.exe; Windows Terminal `wt.exe`,
  else PowerShell started by cmd.exe; elsewhere `code` and `cursor` on PATH, no terminal);
  `exists` is `pathExists` (lstat), since the `WindowsApps\wt.exe` app execution alias is
  invisible to `existsSync` (REQ-FUNC-fe252a3c). `openWith(locate, app, openers, launch)` locates
  first, refuses an undetected app, Notepad++ for folders and the terminal for files with INVALID
  and launches detached with no stdio and no `ELECTRON_*` variables: editors get the absolute
  path as an argument; Windows Terminal gets `-d .` with the folder as working directory, because
  it splits arguments on `;`; PowerShell, a console program that a detached spawn leaves without a
  window, is started by `cmd.exe /d /s /c start "" "<powershell>" -NoExit`, a fixed verbatim
  command line, with the folder as working directory; a spawn error maps to INTERNAL
  (REQ-FUNC-593428f6). `revealEntry(locate, show)` and `copyEntry(locate, path, form, write,
  sep)` return after the shell or clipboard call; copy writes the absolute path, the relative
  path joined with the platform separator, or the name (REQ-FUNC-62ed1c20). Main handlers call `workbench.locateEntry` first, so links and
  outside paths are refused before any OS call; reveal uses `shell.showItemInFolder`
  (REQ-FUNC-aad416b5), copy uses Electron `clipboard.writeText` because the renderer has no
  clipboard permission.
- Renderer `tree-menu.tsx`: an item may carry `items`; it renders as a `menuitem` with
  `aria-haspopup="menu"`/`aria-expanded` and, when open, a nested `role="menu"` placed beside it
  and flipped to the left when it would leave the window (the Docs panel is at the right edge).
  One open submenu at a time; click or hover open it (a click never closes what hover opened);
  Enter, Space or ArrowRight open it with focus on its first item; ArrowLeft or Escape close it
  and focus its item; arrows, Home and End stay within
  the focused menu; Tab closes everything (REQ-UX-89cdb49d).
- `docs-tree.tsx` builds the row menu: Open; Open in (Default app for allowlisted, not ignored
  files, keeping the accessible name "Open in default app: <path>" for REQ-UX-f5d6e9e4; detected
  VS Code, Cursor, Notepad++ for files and VS Code, Cursor, Terminal for folders; left out when
  empty) (REQ-UX-25c814e1); Show in Explorer with a platform label from app.info
  (REQ-UX-ef3e2304); Copy (Absolute path, Relative path, File name) with a "Copied to the
  clipboard." status (REQ-UX-3a3d67c1); Properties (REQ-UX-541a5bee). Detected programs come
  from a `docs.openers` query (staleTime Infinity). Failures share the tree's existing error slot.
- Rejected: `navigator.clipboard` (permissions are denied by design); spawning `code.cmd` (a
  batch file needs a shell, which would parse the path); asking the user to configure editors
  (RULING-001).

**Interfaces and data.**
- Shared channels: `docs.openers {}` -> `{apps: ("vscode"|"cursor"|"notepadpp"|"terminal")[]}`;
  `docs.openWith {workbenchId, path, app}` -> `{}`; `docs.reveal {workbenchId, path}` -> `{}`;
  `docs.copyPath {workbenchId, path, form: "absolute"|"relative"|"name"}` -> `{}`. Errors:
  CONFLICT (not the active workbench), DENIED (link, outside, alias), NOT_FOUND, INVALID (app not
  usable for the entry), INTERNAL (launch failed).
- Locales: `documents.openIn`, `defaultApp`, `terminal`, `copy`, `copyAbsolute`,
  `copyRelative`, `copyName`, `copied`, `revealExplorer`, `revealFinder`, `revealFolder`;
  program names VS Code, Cursor and Notepad++ are proper nouns and not translated.

**Files and test seams.**
- core tree.ts/tree.test.ts (locateEntry), service.ts; shared ipc.ts, documents.ts,
  documents-ipc.test.ts; main openers.ts + openers.test.ts (detection, openWith, copyText),
  index.ts handlers, ipc-router.test.ts and bridge.test.ts channel lists.
- renderer tree-menu.tsx, docs-tree.tsx, styles.css, locales, mockApi.ts (VS Code, Notepad++ and
  a terminal detected; the three channels validate the path); docs-tree.test.ts, documents.test.ts.
- e2e docs-tree.spec: Copy items read back through Electron's clipboard (saved and restored);
  launching editors and Explorer is left to unit tests so the e2e opens no windows.

**Risks and open decisions.**
- Security: external programs start with argument arrays and no shell, only for paths that pass
  the tree confinement; Default app keeps PathGuard and the allowlist. A path is never passed to
  a batch file.
- The e2e Copy check uses the real clipboard; the test restores its previous text.
- A workbench on a network share (UNC path) would start the PowerShell fallback in the Windows
  folder, because cmd.exe refuses UNC working directories; Windows Terminal is unaffected.
- No open product decisions.

**Requirement map.** As in the coverage table; each decision cites its requirement above.

Diagrams: [diagram_TASK-eae3a69e.md](diagram_TASK-eae3a69e.md)

## Log

- 2026-11-01 frame: journal opened
- 2026-11-01 frame: completed; next specify (7 Done checklist item(s) left unticked)
- 2026-11-01 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-01 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-11-01 build: tests first: openers.test (detection, openWith, programEnv, reveal, copy), tree.test locateEntry, documents-ipc channels, docs-tree.test menu/submenus/Open in/Copy/Show in Explorer fail before implementation; documents.test and docs-tree.spec updated
- 2026-11-01 build: green: openers.test (6), tree.test locateEntry, documents-ipc channels, docs-tree.test menu/submenus/Open in/Copy/Show in Explorer, documents.test, router/bridge pass (only pre-existing 'bounds large text DOM'); tsc -b, biome, check:i18n clean; e2e docs-tree (Copy via Electron clipboard, restored), documents, citations, office-documents, pdf-download pass
- 2026-11-01 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-01 validate: review round 1 findings: wt.exe app execution alias invisible to existsSync (Windows Terminal never detected); PowerShell fallback spawned detached has no console window; wt splits arguments on ';' so a folder name can inject commands; clicking a hover-opened submenu item closes it; REQ-UX-89cdb49d says click/hover focus the first item (only keys do), Space untested; REQ-UX-f5d6e9e4 linked to a test without Default app; Cursor via cursor.cmd and Program Files not detected; Design names old signatures; stale docs-tree comment; focusSubmenu flag left set; real launches never exercised
- 2026-11-01 validate: returned to build - review round 1: launch and detection on Windows, wt injection, submenu click, wording, Cursor, docs
- 2026-11-01 build: Manual (REQ-FUNC-593428f6, user consented): ran the real openers.ts detectOpeners+launchDetached on Windows with a temp folder named 'a;b': detected VS Code (LOCALAPPDATA Code.exe), Notepad++ (Program Files) and Windows Terminal (WindowsApps\wt.exe alias, now seen via lstat); VS Code opened 'check.txt - Visual Studio Code', Notepad++ opened '...\a;b\check.txt', Windows Terminal started one window (no split on ';'), the PowerShell fallback via cmd start started new powershell processes; the terminals' working folder was not machine-read. Show in Explorer: Electron shell.showItemInFolder on the file returned without error; the Explorer window could not be inspected or closed because PowerShell runs in Constrained Language Mode (COM blocked). Started Notepad++/Terminal/PowerShell processes were closed.
- 2026-11-01 build: round 1 fixes green: openers.test 7 pass (lstat alias, Cursor via cursor.cmd and Program Files, wt -d . with cwd incl. a;b, PowerShell via fixed cmd start line, real detached launch); docs-tree.test (hover then click keeps submenu, Space opens with focus) and documents.test pass except pre-existing; tsc, biome, i18n clean; 5 Docs e2e pass; REQ-UX-89cdb49d and REQ-FUNC-593428f6/fe252a3c revised, REQ-UX-f5d6e9e4 relinked; Design and knowledge updated
- 2026-11-01 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-01 validate: review round 2: spec - REQ-FUNC-593428f6 links a renamed test and the real-launch/alias test is linked nowhere; its Manual line claims a tree-entry check, the terminal folder and the Explorer selection, which were not observed; quality approved (note: UNC workbench folders open the PowerShell fallback in C:\Windows)
- 2026-11-01 validate: returned to build - review round 2: test links and the manual claim
- 2026-11-01 build: DEVIATION validate: the terminals' working folder and the Explorer selection were not observed (no way to read a terminal's folder; PowerShell's Constrained Language Mode blocks the Shell COM check) - left to the user's check in VERA; the code passes the folder as working directory and the file to shell.showItemInFolder, both covered by unit tests
- 2026-11-01 build: round 2 fixes: REQ-FUNC-593428f6 links the renamed test and the real-launch test, REQ-FUNC-fe252a3c links the alias test; Manual line reworded to what was observed; DEVIATION logged for the unobserved terminal folder and Explorer selection; UNC limitation in Risks. No code changed.
- 2026-11-01 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-01 validate: final: python .agentic/aegis.py check --task TASK-eae3a69e --strict --run exit 0 (typecheck, lint, i18n ok; tests not in [check] run); full vitest after the last code edit: 1125 passed, 4 failed, all pre-existing and out of scope (sessions compaction transcript, write-edit registry, documents 'bounds large text DOM', workspace 'Settings selects one page'); e2e docs-tree, documents, citations, office-documents, pdf-download passed after the last code change; manual launch check logged; terminal folder and Explorer selection left to the user's VERA check (deviation); 177 check warnings are repository-wide legacy notes
- 2026-11-01 validate: completed; next done (9 Done checklist item(s) left unticked)
- 2026-11-01 done: commit: the user authorized committing all uncommitted work as one local commit on master (2026-11-01)

## Rulings

- RULING-001 | date=2026-11-01 | decision=Open in lists the detected VS Code, Cursor and Notepad++ (files), VS Code, Cursor and a terminal (folders), plus Default app for allowlisted files VERA does not ignore | reason=user chose 'Detected editors + default app' | source=user | supersedes=none
- RULING-002 | date=2026-11-01 | decision=Copy and Open in are submenus of the row menu; Show in Explorer is a direct item | reason=user chose 'Submenus' and listed 'show in explorer' | source=user | supersedes=none
- RULING-003 | date=2026-11-01 | decision=Ignored entries can be opened in editors and terminals, revealed and copied, but not opened in the default application | reason=user chose that ignored entries can be opened, copied and revealed (TASK-b34f2cc7); PathGuard keeps refusing the default application for them | source=user | supersedes=none
- RULING-004 | date=2026-11-01 | decision=Attach as context is a separate task after this one | reason=one feature per task: composer and agent changes are independent of the file actions | source=technical | supersedes=none


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-eae3a69e.md
changed: 7 created, 1 revised (REQ-UX-541a5bee)
evidence: check --strict --run exit 0; e2e 5 passed; vitest only pre-existing failures
issues:
spec_compliance: approved
implementation_quality: approved
review_round: 3

## Delivery report (2026-11-01)

- stage: validate; type: feature; path: full; branch: master
- requirements:
  - REQ-UX-541a5bee - Offer a context menu on Docs tree items
  - REQ-UX-25c814e1 - Open Docs tree items in other applications
  - REQ-UX-89cdb49d - Operate the Docs tree submenus
  - REQ-UX-3a3d67c1 - Copy a Docs tree item's path
  - REQ-UX-ef3e2304 - Show a Docs tree item in the file manager
  - REQ-FUNC-fe252a3c - Detect programs that open workbench entries
  - REQ-FUNC-593428f6 - Open a workbench entry with a detected program
  - REQ-FUNC-aad416b5 - Reveal a workbench entry in the file manager
  - REQ-FUNC-62ed1c20 - Copy the path of a workbench entry
- deviations: 1 recorded
  - validate: the terminals' working folder and the Explorer selection were not observed (no way to read a terminal's folder; PowerShell's Constrained Language Mode blocks the Shell COM check) - left to the user's check in VERA; the code passes the folder as working directory and the file to shell.showItemInFolder, both covered by unit tests
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=3
- diff vs task base b53d142: 294 file(s) changed, 19920 line(s) added; 7 file(s) not content-scanned
- checks: errors=0 warnings=177 notes=3
- checklist: 0/9 done; open: diff reviewed against scope, requirements, design, error paths, portability, security and unrequested work; knowledge pages of changed components current with the reviewed code; project and environment context reconciled with the candidate; requirements re-read: status, prose, verification, paths and links true; manual or inspection verification recorded where applicable; explicit review approved, when enabled; final `check --strict --run` result logged truthfully after the last edit; remaining warnings and pre-existing failures explained; `report` appended

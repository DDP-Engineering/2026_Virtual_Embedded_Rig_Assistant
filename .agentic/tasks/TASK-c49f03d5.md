# TASK-c49f03d5 - Open in: other applications from the system on Windows and Ubuntu

stage: done
type: feature
path: full
interaction: autopilot
requirements: REQ-UX-25c814e1, REQ-FUNC-fe252a3c, REQ-FUNC-593428f6, REQ-FUNC-ad5254e8, REQ-FUNC-6bf664d7
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

Problem: STATED: "as fi preferat ca open in sa imi deschida in setarea sistemului. Exemplu -
  pentru png sa imi propuna irfan view si pictures". OBSERVED: Open in (TASK-eae3a69e) lists only
  the default app for documents and the detected VS Code, Cursor, Notepad++ and a Windows
  terminal; on this PC Windows registers IrfanView (user choice), LibreOffice and AppX apps for
  .png (registry OpenWithProgids). STATED: "va functiona si pe ubuntu?"; OBSERVED: on Linux only
  VS Code and Cursor on PATH are offered, no terminal.
Desired outcome: on Windows, Open in offers "Other app..." that opens the system's Open with
  dialog for the file (RULING-001); on Ubuntu, Open in lists the applications the system registers
  for the file's type and starts the chosen one (RULING-002), and folders get a terminal
  (RULING-003); anything a platform cannot do does not appear (RULING-004). The Windows inline list
  of system apps is a later task (RULING-005).
Actors: the desktop user in the Files tab; main; Windows shell32 (Open with dialog); GLib's gio
  tool and .desktop files on Ubuntu; x-terminal-emulator.
Primary scenario: Windows - right-click `photo.png` -> Open in -> Other app... -> the Windows
  dialog lists IrfanView, Photos, Paint; the user picks one. Ubuntu - right-click `photo.png` ->
  Open in -> Image Viewer, GIMP (from `gio mime image/png`); picking GIMP starts it with the file.
  Ubuntu - right-click a folder -> Open in -> Terminal opens a terminal in that folder.
Examples: OBSERVED on this PC for .png: UserChoice IrfanView.png; OpenWithProgids pngfile,
  IrfanView.png, LibreOffice.Png and three AppX ids.
Counterexamples: Ubuntu 20.04 (GLib 2.64, no `gio launch`) shows no system apps; a file type with
  no registered applications shows no extra items; "Other app..." never appears on Linux or for
  folders; macOS gains nothing (RULING-004).
In scope:
- Windows: an "Other app..." item for files, starting `rundll32.exe shell32.dll,OpenAs_RunDLL
  <file>` without a shell.
- Linux: the file's content type and registered applications from `gio` (LC_ALL=C), names from
  their .desktop files, launch with `gio launch <desktop file> <file>`; the chosen application is
  re-checked against the registered list in main.
- Linux: Terminal for folders through `x-terminal-emulator` started in the folder.
- Shared channels, renderer menu, locales, tests; the existing confinement (locateEntry) first.
Out of scope: the Windows inline list of system apps (RULING-005); macOS; changing the default
  application of a file type.
Constraints: on master, uncommitted; LF; en/ro/de; no shell for any launch; this machine is
  Windows, so Ubuntu behavior is proven by unit tests with simulated gio output and checked by the
  user on Ubuntu.
Success signals: on Windows the dialog opens for a file, including paths with spaces; on Ubuntu
  the menu shows the registered applications by name and starts the chosen one; a terminal opens
  in a folder on Ubuntu; nothing unsupported appears.
Evidence: main/openers.ts (detectOpeners, openWith, launchDetached); docs-tree.tsx menuItems;
  registry read on this PC; gio sources (gio-tool-mime.c prints "Registered applications:" and
  tab-indented desktop ids; gio launch since GLib 2.68, present in Ubuntu 22.04/24.04 man pages);
  xdg-desktop-portal OpenURI refuses file:// URIs.
Assumptions: INFERRED: Ubuntu desktops ship libglib2.0-bin (gio) and an x-terminal-emulator
  alternative. INFERRED: OpenAs_RunDLL accepts a quoted path.
Unknowns: whether `gio mime` lists registered apps when no default exists (the source skips them);
  how `gio info` prints the content type line; the menu label for the Windows item.
Decision-blocking questions: none; the user chose the Windows dialog now, the Ubuntu list, an
  Ubuntu terminal and "only what works".
Proposed behaviors (not accepted):
- The Windows item reads "Other app..." and comes last in Open in.
- Ubuntu system apps come after the detected editors, without duplicating an editor already
  listed (code/cursor desktop ids).
- Ubuntu app names use the .desktop Name (localized when a Name[lang] exists).
- System apps are read when a file's Open in submenu opens.
Path and reason:

| Criterion | Holds? | Evidence |
|---|---|---|
| no new externally observable behavior | no | new Open in items |
| no new interface or data format | no | new channels |
| no new dependency | yes | system tools only |
| an existing requirement already covers the behavior | no | REQ-UX-25c814e1 lists other items |
| no security or data-handling change | no | main starts more programs |

Full path: new behavior, channels and process launching.

## Requirement coverage

| Behavior | Requirement | Source in Frame |
|---|---|---|
| Open in lists Other app (Windows) or registered apps (Linux), only what works | REQ-UX-25c814e1 (revised) | RULING-001, RULING-002, RULING-004 |
| detection adds the Open with dialog (Windows) and x-terminal-emulator (Linux) | REQ-FUNC-fe252a3c (revised) | RULING-001, RULING-003 |
| launching the Open with dialog and the Linux terminal | REQ-FUNC-593428f6 (revised) | RULING-001, RULING-003 |
| registered Linux applications for a file | REQ-FUNC-ad5254e8 | RULING-002, RULING-004 |
| starting a registered Linux application | REQ-FUNC-6bf664d7 | RULING-002 |

Revised (from TASK-eae3a69e): REQ-UX-25c814e1, REQ-FUNC-fe252a3c, REQ-FUNC-593428f6. Accepted
proposals: "Other app..." last in Open in; Linux system apps after the editors without
duplicating them; .desktop Name localized when present; system apps read when the context menu opens on a file (not
only when Open in opens: without editors, Open in would otherwise never appear). Unknowns settled by the design: gio output parsed under LC_ALL=C; gio version checked for
2.68; the content type from `gio info -a standard::content-type`.

## Design

**Approach.**
- The Windows dialog and the Linux terminal join the detected programs in main `openers.ts`:
  `OpenerId` (shared `docsOpenerSchema`) gains `other`; `detectOpeners` adds `other` on Windows
  when `%SystemRoot%\System32\rundll32.exe` exists (style `rundll`) and, on Linux, `terminal`
  when `x-terminal-emulator` is on PATH (style `cwd`). `openWith` takes `other` for files only and
  launches `rundll32.exe ["shell32.dll,OpenAs_RunDLL", <absolute file>]`; style `cwd` launches the
  terminal with no arguments and the folder as working directory (REQ-FUNC-fe252a3c,
  REQ-FUNC-593428f6).
- Linux system applications get their own functions in `openers.ts`, with injected `run`
  (execFile, LC_ALL=C), `readText` and data directories: `systemApps(locate, deps)` returns `[]`
  unless the platform is Linux, the entry is a file (folders INVALID), `gio version` reports at
  least 2.68 and `gio info -a standard::content-type` gives a type; it then parses the tab-indented
  ids under "Registered applications:" of `gio mime <type>`, finds each `<dir>/applications/<id>`
  in XDG_DATA_HOME and XDG_DATA_DIRS, reads `Name` (or `Name[<lang>]`, skipping `NoDisplay=true`
  and `Hidden=true`) and leaves out code/cursor ids while those editors are detected
  (REQ-FUNC-ad5254e8). `openSystemApp(locate, id, deps, launch)` recomputes that list and launches
  `gio ["launch", <desktop file>, <absolute file>]` only for an id in it (REQ-FUNC-6bf664d7).
- Renderer `docs-tree.tsx`: for a file, Open in appends the Linux system apps (a `docs.systemApps`
  query for the row the menu is open on, enabled on Linux only, never cached) after the editors by
  name, then "Other app..." when `other` is detected; folders never show either; Open in stays
  out when empty (REQ-UX-25c814e1, RULING-004).
- Rejected: the portal (OpenURI refuses file://, OpenFile needs a file descriptor); parsing the
  Windows registry (names and AppX launching need COM, RULING-005).

**Interfaces and data.**
- Shared: `docsOpenerSchema` adds `other`; `docs.systemApps {workbenchId, path}` -> `{apps:
  [{id, name}]}` (ids `*.desktop`, at most 50); `docs.openSystemApp {workbenchId, path, app}` ->
  `{}`. Errors as before: DENIED (link, outside, alias), NOT_FOUND, INVALID (folder, unregistered
  id), INTERNAL (launch failed).
- Main: the UI language from settings picks `Name[lang]`.
- Locales: `documents.otherApp` ("Other app...").

**Files and test seams.**
- shared documents.ts, ipc.ts, documents-ipc.test.ts; main openers.ts + openers.test.ts
  (detection, launch args, gio parsing with recorded outputs, desktop files in a temp dir),
  index.ts handlers, ipc-router/bridge lists.
- renderer docs-tree.tsx, mockApi.ts (`manuals/scope-capture.png` with two system apps),
  locales; docs-tree.test.ts.
- Manual on Windows: the Open with dialog for a path with spaces. Ubuntu: unit tests only here;
  the user checks on an Ubuntu machine (recorded as a deviation if not done).

**Risks and open decisions.**
- Every program starts without a shell; a Linux app id must be in the registered list for that
  file at launch time, so the renderer cannot start an arbitrary .desktop file.
- `gio` output is parsed in the C locale; unexpected output yields no apps rather than an error.
- No open product decisions.

**Requirement map.** As in the coverage table; each decision cites its requirement above.

Diagrams: none - the flows reuse TASK-eae3a69e's structure (Open in -> main -> OS); the change
adds two channels and two launch styles described above.

## Log

- 2026-11-01 frame: journal opened
- 2026-11-01 frame: completed; next specify (7 Done checklist item(s) left unticked)
- 2026-11-01 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-01 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-11-01 build: tests first: openers.test (detection other/terminal, launch styles, gio parsing, gio launch, C locale), documents-ipc channels, docs-tree system apps / Other app failed before implementation. green: openers 12, documents-ipc, docs-tree 18, mockApi/router/bridge pass; tsc, biome, i18n clean; e2e docs-tree, documents, citations pass
- 2026-11-01 build: Manual (user consented): the real openers.ts 'other' launch for '...\vera check *\sub folder\photo test.png' first started no dialog: Node quoted the path and OpenAs_RunDLL ignores a quoted path. Passing the arguments verbatim (rundll32 shell32.dll,OpenAs_RunDLL <path>) started OpenWith.exe, the Windows Open with dialog; fixed in openers.ts (verbatim for rundll, window hiding decoupled into its own option), unit test pins { verbatim: true }; re-run with the fixed code started OpenWith.exe again; dialog processes closed each time
- 2026-11-01 build: DEVIATION validate: Ubuntu behavior (gio system apps, gio launch, x-terminal-emulator) is proven only by unit tests with recorded gio output on this Windows machine - the user checks it on an Ubuntu machine
- 2026-11-01 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-01 validate: review round 1: spec - links untested for systemApps/openSystemApp; REQ-FUNC-ad5254e8 omits the NoDisplay/Hidden, missing .desktop and no-default exclusions; stale detectOpeners comment and test name, no darwin/linux 'exists everywhere' cases; change map row lacks the two channels; journal says apps are read when Open in opens (code: when the menu opens on a file). quality approved with optional hardening: anchor the content-type parse after 'attributes:', NoDisplay=1, map the system language to the UI languages
- 2026-11-01 validate: returned to build - review round 1: tests for links and platforms, requirement wording, parsing hardening
- 2026-11-01 build: round 1 fixes green: openers.test 13 pass (link cases for systemApps/openSystemApp, crafted uri line cannot pose as the content type, Hidden=1, darwin/linux 'exists everywhere' cases, renamed test); content type read from the attributes block only; NoDisplay/Hidden accept true or 1; system language maps to en/ro/de like the renderer; REQ-FUNC-ad5254e8/6bf664d7/fe252a3c wording and links; change map row; journal wording; RULING-006 hides NoDisplay apps
- 2026-11-01 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-01 validate: after round 2: the content type parse takes the last attributes block (quality note); openers.test 13 pass
- 2026-11-01 validate: VERA_TEST=1 npm run test:e2e docs-tree, documents, citations (with workbench and office specs) exit 0, 10 passed; full vitest 1148 passed, 1 load-sensitive timeout in unchanged core discovery.test.ts (passes alone)
- 2026-11-01 validate: final: python .agentic/aegis.py check --task TASK-c49f03d5 --strict --run exit 0; lint, typecheck, i18n ok (test not in [check] run; openers.test 13 pass, full vitest and native e2e logged above); errors=0, strict ok; the task's one warning is uncovered-source on openers.test.ts (a linked test, not an affected path); remaining warnings are other tasks' repository records; limitations: Ubuntu proven by unit tests only (DEVIATION recorded), the terminal folder and Explorer selection are manual checks for the user, a UNC workbench opens the PowerShell fallback in C:\Windows
- 2026-11-01 validate: completed; next done (9 Done checklist item(s) left unticked)
- 2026-11-01 done: commit: the user authorized committing all uncommitted work as one local commit on master (2026-11-01)

## Rulings

- RULING-001 | date=2026-11-01 | decision=On Windows, Open in offers Other app... for files, which opens the Windows Open with dialog for the file | reason=user chose '"Other app..." now, list later' | source=user | supersedes=none
- RULING-002 | date=2026-11-01 | decision=On Ubuntu, Open in lists the applications the system registers for the file's type (gio mime) and starts the chosen one (gio launch) | reason=user chose 'List of registered apps' for Ubuntu | source=user | supersedes=none
- RULING-003 | date=2026-11-01 | decision=On Ubuntu, folders get Open in > Terminal through x-terminal-emulator started in the folder | reason=user chose 'Yes: Windows + Ubuntu' | source=user | supersedes=none
- RULING-004 | date=2026-11-01 | decision=What a platform cannot do does not appear in VERA | reason=user: 'Ce nu se poate in ubuntu, nu exista ca si optiune in vera' | source=user | supersedes=none
- RULING-005 | date=2026-11-01 | decision=The Windows inline list of system apps (like Explorer's Open with submenu) is a later, separate task | reason=user chose '"Other app..." now, list later' | source=user | supersedes=none
- RULING-006 | date=2026-11-01 | decision=Linux applications marked NoDisplay or Hidden in their .desktop file do not appear in Open in | reason=user chose 'No, hide them' (as Ubuntu's own Open with list) | source=user | supersedes=none


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-c49f03d5.md
changed: 2 created, 3 revised
evidence: check --task TASK-c49f03d5 --strict --run exit 0; native e2e docs-tree/documents/citations pass
issues:
spec_compliance: approved
implementation_quality: approved
review_round: 3

## Delivery report (2026-11-01)

- stage: validate; type: feature; path: full; branch: master
- requirements:
  - REQ-UX-25c814e1 - Open Docs tree items in other applications
  - REQ-FUNC-fe252a3c - Detect programs that open workbench entries
  - REQ-FUNC-593428f6 - Open a workbench entry with a detected program
  - REQ-FUNC-ad5254e8 - List the applications Linux registers for a workbench file
  - REQ-FUNC-6bf664d7 - Start a registered Linux application for a workbench file
- deviations: 1 recorded
  - validate: Ubuntu behavior (gio system apps, gio launch, x-terminal-emulator) is proven only by unit tests with recorded gio output on this Windows machine - the user checks it on an Ubuntu machine
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=3
- diff vs task base b53d142: 319 file(s) changed, 22059 line(s) added; 7 file(s) not content-scanned
- checks: errors=0 warnings=189 notes=3
- checklist: 0/9 done; open: diff reviewed against scope, requirements, design, error paths, portability, security and unrequested work; knowledge pages of changed components current with the reviewed code; project and environment context reconciled with the candidate; requirements re-read: status, prose, verification, paths and links true; manual or inspection verification recorded where applicable; explicit review approved, when enabled; final `check --strict --run` result logged truthfully after the last edit; remaining warnings and pre-existing failures explained; `report` appended

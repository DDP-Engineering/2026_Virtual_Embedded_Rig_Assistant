# TASK-35eaad21 - Linux deb updates: download link and signed apt repository (#370)

stage: done
type: feature
interaction: autopilot
requirements: REQ-PLAT-f905ba1a, REQ-PLAT-b4057998, REQ-PLAT-be9e76a2
parent:
branch: feature/370-371-release
base: 48e6b5c4ec273c65eaa457c841672e0f84c6ab62
opened: 2026-11-21

Edit Frame, Requirement coverage and Design directly. Write State, Log and
Rulings with `python .agentic/aegis.py` (advance, pause, log, ruling, verdict);
end each session with `advance` or `pause`.

## Done checklist (current stage)

- [x] diff reviewed against scope, requirements, design, error paths,
      portability, security and unrequested work
- [x] knowledge pages of changed components current with the reviewed code
- [x] project and environment context reconciled with the candidate
- [x] requirements re-read: status, prose, verification, paths and links true
- [x] manual or inspection verification recorded where applicable
- [x] explicit review approved, when enabled
- [x] final `check --strict --run` result logged truthfully after the last edit
- [x] remaining warnings and pre-existing failures explained
- [x] `report` appended

## Frame

Problem: A deb install (distribution `managed`) learns of a new version but only reads "Install updates through your package manager." VERA publishes no apt repository and the page offers no download link, so a deb user cannot get the new version from VERA (STATED, Gitea #370; OBSERVED `main/updates.ts` openRelease accepts only `portable`, `update-backend.ts` picks only `.exe`/`.AppImage` links, `updates.tsx` shows the link button only for portable).
Desired outcome: A deb install sees a new version on the Updates page and can open its `.deb` download link after confirmation; release deliveries also carry a signed flat apt repository on the update feed host, so `apt update && apt upgrade` moves an installed VERA to the new version, and the Updates page text names that route (STATED, #370 "Done when").
Actors: Linux user of the deb package; release maintainer running `delivery:vera` / `delivery:verify` / `delivery:release`.
Primary scenario: VERA 0.3.0 deb is installed; 0.4.0 is published. Updates page announces 0.4.0 with notes, text says to run apt upgrade when the VERA repository is added or to install the downloaded .deb; "Open download link" confirms and opens the 0.4.0 .deb URL on the feed. A user who added the repository and key from the help page gets 0.4.0 through `apt upgrade`.
Examples: feed `https://github.com/DDP-Engineering/2026_Virtual_Embedded_Rig_Assistant/releases/latest/download/` with `latest-linux.yml` listing `VERA-0.4.0-linux-x86_64.AppImage` and `VERA-0.4.0-linux-amd64.deb` (names INFERRED from artifactName `VERA-${version}-${os}-${arch}.${ext}`): a deb install offers the .deb link, an AppImage install keeps the AppImage download.
Counterexamples: a deb install never downloads or installs from inside VERA (STATED, Not in scope); a .deb URL outside the feed folder gives no link (OBSERVED existing safe-link rule).
In scope: managed openRelease + deb link selection + Updates text in en/ro/de/fr; apt repository metadata (Packages, Release, InRelease, Release.gpg, public key) built next to the deb by `02_Tools/delivery/`; `delivery:verify` checks signature and package hash; release publishing includes the files; Linux install help and README document the repository (STATED, #370 Proposal/Done when).
Out of scope: self-updating the deb from inside VERA; changes to the NSIS, AppImage or portable update paths (STATED, #370 Not in scope). Creating the real project signing key is the maintainer's action (INFERRED: it is an identity/credential).
Constraints: no backward-compat code, version fields stay 1 (memory rule); pinned tools; electron-updater keeps verifying only installed builds; repository served from GitHub release assets, which are flat files (OBSERVED feed work 48e6b5c4), so the apt repository uses the flat format (`deb [signed-by=...] <feed> /`).
Success signals: unit tests for managed link/openRelease; renderer test for the managed button; tooling tests for metadata and verify checks; a WSL probe where unprivileged apt (custom state, simulated installed old version) verifies InRelease with the published key, sees the new candidate, simulates the upgrade and downloads the .deb with hash check.
Evidence: Gitea #370 body (read 2026-11-21); files cited above; WSL Ubuntu 24.04 has dpkg-deb, apt-ftparchive, gpg, gpgv, apt 2.8.4, sudo needs a password (OBSERVED command output).
Assumptions: apt follows the GitHub latest/download redirect for InRelease/Packages/.deb (INFERRED: apt https follows redirects that keep https).
Unknowns: real signing key and its fingerprint (none exists yet); end-to-end against a published GitHub release (not run until a release is published).
Decision-blocking questions: none. The Updates page keeping the download link once the repository exists is decided as a ruling (see Rulings).
Proposed behaviors: (accepted by ruling) managed keeps the confirmed download link and its text names both apt upgrade and the downloaded .deb; the repository is built only when `VERA_APT_KEY` names a signing key, otherwise delivery:verify warns that deb installs get only the download link.

## Requirement coverage

| Behavior | Requirement | Design |
|---|---|---|
| deb offer carries the .deb link; managed openRelease opens it after confirmation; text names apt upgrade and the downloaded .deb; no download/install | REQ-PLAT-f905ba1a (revised) | link pick per distribution in update-backend; openRelease admits managed; panel shows the link button for managed |
| Linux delivery with VERA_APT_KEY writes a signed flat apt repository; none without it | REQ-PLAT-b4057998 | apt-repository.mjs buildAptRepository, called by build-vera-installers on Linux |
| delivery:verify fails a bad repository, warns when a Linux part has none | REQ-PLAT-be9e76a2 | apt-repository.mjs checkAptRepository from verify-delivery; warning in deliveryWarnings |

## Design

**Approach.** App side: the electron-updater DebUpdater already reads `latest-linux.yml`, which lists the AppImage and the .deb (OBSERVED electron-builder merge, feed work 48e6b5c4). The backend picks the offer link by platform and distribution (`.exe` win32, `.AppImage` installed Linux, `.deb` managed) and keeps the same-origin feed-folder rule; `Updates.openRelease` admits `portable` and `managed`; the panel shows the confirmed "Open download link" button for both (REQ-PLAT-f905ba1a). Tooling side: a new `02_Tools/delivery/apt-repository.mjs` writes a flat repository (`deb [signed-by=...] <feed> /`) beside the deb in the Linux part: `Packages` (the deb's `dpkg-deb -f` control plus Filename, Size, SHA256), deterministic `Packages.gz`, `Release` (Origin, Label, Date, Architectures, SHA256 of both indexes), `InRelease` and `Release.gpg` (gpg, SHA512 digest), and the binary public key `vera-archive-keyring.gpg` (REQ-PLAT-b4057998). GitHub release assets are flat, so a pool/dists layout is impossible (technical constraint); `releases/latest/download/` serves every file of the newest release, so Packages always names a deb of the same release. Rejected: apt-ftparchive (apt-utils is optional; dpkg-deb is essential), signing at publish time on Windows (splits the build from its proof).

**Interfaces and data.** `buildAptRepository({ folder, deb, key, date, control?, gpg? })` returns the written file names and the signing key fingerprint; control and gpg runners are injectable for tests. `checkAptRepository(folder, files, { fingerprint, gpgv })` returns problem strings: incomplete set, signature not valid or by another key (gpgv `--status-fd` VALIDSIG fingerprint), Release size/hash mismatch for Packages or Packages.gz, Packages.gz not the gzip of Packages, Packages entry not exactly the part's deb by name, size and SHA256 (REQ-PLAT-be9e76a2). `delivery.json` records `aptKey: <fingerprint>` on the Linux part; verify fails when files exist without aptKey or aptKey without files, and `deliveryWarnings` warns for a Linux part without aptKey. verify-delivery and delivery:release take `--gpgv <path>`; default `gpgv` on PATH, then Git for Windows `usr/bin/gpgv.exe`. `VERA_APT_KEY` is read only on Linux by build-vera-installers.

**Files and test seams.** desktop `main/update-backend.ts` (+test), `main/updates.ts` (+test), `renderer/components/updates.tsx` (+test), four locale files, mock API; `02_Tools/delivery/apt-repository.mjs` (new), `build-vera-installers.mjs`, `delivery-common.mjs`, `verify-delivery.mjs`, `publish-github-release.mjs` (release body row, `--gpgv` passthrough); tests `tests/tooling/apt-repository.test.ts` (injected runners on every host; real dpkg-deb/gpg/gpgv/apt-get end-to-end on Linux only, apt unprivileged with a simulated older installed version and an HTTP server that redirects like GitHub). Docs: Linux install help (four languages), 07_Delivery/02_Tools READMEs, Delivery.md.

**Risks and open decisions.** The real signing key does not exist; creating it is the maintainer's step (documented). A release published between apt reading InRelease and Packages gives a one-time hash mismatch that the next `apt update` resolves (flat repository without by-hash). Old 0.x installs have no feed or repository.

**Requirement map.** REQ-PLAT-f905ba1a: link pick + managed openRelease + panel/text. REQ-PLAT-b4057998: buildAptRepository + build-vera-installers + aptKey record. REQ-PLAT-be9e76a2: checkAptRepository + verify-delivery + warning.

## Log

- 2026-11-21 frame: journal opened
- 2026-11-21 frame: completed; next specify - scope recorded (autopilot) (7 Done checklist item(s) left unticked)
- 2026-11-21 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-21 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-11-21 build: red: vitest update-backend/updates/renderer updates tests exit 1 - no .deb link pick, managed openRelease DENIED, no apt text (REQ-PLAT-f905ba1a)
- 2026-11-21 build: green: vitest update-backend, updates, renderer updates, mockApi, i18n tests exit 0, 40 passed (REQ-PLAT-f905ba1a)
- 2026-11-21 build: red: vitest tests/tooling/apt-repository.test.ts exit 1 - apt-repository.mjs missing (REQ-PLAT-b4057998, REQ-PLAT-be9e76a2)
- 2026-11-21 build: green: vitest tests/tooling/apt-repository.test.ts exit 0 on Windows (3 passed, apt e2e skipped) and in WSL Ubuntu 24.04 (4 passed incl. unprivileged apt update/-s upgrade/download through a 302 redirect) (REQ-PLAT-b4057998, REQ-PLAT-be9e76a2)
- 2026-11-21 build: green: vitest tooling delivery/github-release/apt-repository exit 0, 19 passed 1 skipped (apt e2e, Linux only); verify-delivery smoke on a synthetic signed delivery: no apt problem when valid, changed deb and missing aptKey reported (REQ-PLAT-be9e76a2, REQ-PLAT-b4057998)
- 2026-11-21 build: DEVIATION design: no structure/sequence/state diagrams drawn although brief asked for them - the design note and coverage table carry the flow; costs a visual aid for review
- 2026-11-21 build: review round 1: spec - REQ-PLAT-b4057998 'no repository without VERA_APT_KEY' untested, knowledge updates.md line 16 still says portable-only confirmation; quality (approved) - keyring export follows gpg.conf armor, early key check only lists the key, gpgv stderr dropped, EXPKEYSIG passes as VALIDSIG
- 2026-11-21 build: green: round-1 fixes - vitest focused desktop+tooling exit 0 (64 passed, 1 skipped) on Windows; apt-repository.test.ts 5 passed in WSL Ubuntu 24.04; mutations (export without --no-armor, VALIDSIG without GOODSIG) each turn a test red (REQ-PLAT-b4057998, REQ-PLAT-be9e76a2)
- 2026-11-21 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-21 validate: inspection (REQ-PLAT-b4057998): build-vera-installers.mjs reads the key only via aptKeyFor(values.platform), checks it with signingKey before packaging, and calls buildAptRepository only inside if (aptKey); without VERA_APT_KEY or on windows-x64 no repository file is written
- 2026-11-21 validate: final: aegis check --task TASK-35eaad21 --strict --run exit 1; lint, check:i18n, check:help exit 0; typecheck exit 1 with 10 errors, all in untouched files (main/ipc-router.test.ts, preload/bridge.test.ts, main/index.ts) because the worktree's node_modules junction links @vera/* to the main checkout, whose shared package already has the #368 plan-review channels; 0 errors in changed files (tsc -b output filtered). After the proof only .agentic/context/environment.md gained the VERA_APT_KEY row; check --task --strict exit 0. Remaining 36 warnings are pre-existing (other journals, help files outside layout globs).
- 2026-11-21 validate: DEVIATION validate: typecheck of the strict proof cannot pass in this worktree (shared node_modules links @vera/* to the main checkout) - covered by tsc filtered to the changed files (0 errors); misses whole-project type consistency against this branch's own shared package, which a run in a checkout with its own npm ci would give
- 2026-11-21 validate: completed; next done

## Rulings

- RULING-001 | date=2026-11-21 | decision=Deb (managed) keeps the confirmed download link after the apt repository exists; its Updates text names apt upgrade for users who added the VERA repository and installing the downloaded .deb otherwise | reason=Both #370 Done-when bullets hold at once and a deb user who never added the repository still has a route; no extra state is needed to know whether the repository is configured | source=technical | supersedes=none
- RULING-002 | date=2026-11-21 | decision=The apt repository is a flat repository (suite /) on the update feed folder, signed at Linux build time with the key named by VERA_APT_KEY; without it no repository is built and delivery:verify warns | reason=#370 asks for the same static host as the feed; GitHub release assets are flat files; the private key stays with the maintainer | source=technical | supersedes=none


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-35eaad21.md
changed: deb .deb link + managed openRelease (desktop main/renderer/locales); apt-repository.mjs + build/verify/release wiring; help en/ro/de/fr, delivery docs, knowledge updates.md, environment.md
evidence: focused vitest desktop+tooling exit 0 (64 passed, 1 skipped); WSL apt-repository.test.ts exit 0 (5 passed); review round 2 approved/approved; check --strict --run: lint/i18n/help exit 0, typecheck exit 1 only in untouched files (worktree @vera links)
issues: real apt signing key not created; apt end to end only in WSL, not native Ubuntu or a real GitHub release; typecheck limited by the worktree setup
spec_compliance: approved
implementation_quality: approved
review_round: 2

## Delivery report (2026-11-21)

- stage: validate; type: feature; branch: feature/370-371-release
- requirements:
  - REQ-PLAT-f905ba1a - Announce portable and managed updates
  - REQ-PLAT-b4057998 - Build a signed flat apt repository next to the deb
  - REQ-PLAT-be9e76a2 - Verify the apt repository signature and hashes
- deviations: 2 recorded
  - design: no structure/sequence/state diagrams drawn although brief asked for them - the design note and coverage table carry the flow; costs a visual aid for review
  - validate: typecheck of the strict proof cannot pass in this worktree (shared node_modules links @vera/* to the main checkout) - covered by tsc filtered to the changed files (0 errors); misses whole-project type consistency against this branch's own shared package, which a run in a checkout with its own npm ci would give
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=2
- diff vs task base 48e6b5c: 38 file(s) changed, 996 line(s) added
- checks: errors=0 warnings=36 notes=40
- checklist: 0/9 done; open: diff reviewed against scope, requirements, design, error paths, portability, security and unrequested work; knowledge pages of changed components current with the reviewed code; project and environment context reconciled with the candidate; requirements re-read: status, prose, verification, paths and links true; manual or inspection verification recorded where applicable; explicit review approved, when enabled; final `check --strict --run` result logged truthfully after the last edit; remaining warnings and pre-existing failures explained; `report` appended

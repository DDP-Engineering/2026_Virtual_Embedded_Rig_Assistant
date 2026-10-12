# Session artifacts

## Behavior and interface

artifact_save is class session, sequential, no approval. Parameters name/content/description?/overwrite?; output {ref:"artifact:<name>",bytes}. Name uses1..100 ASCII letters/digits/dot/underscore/hyphen, excludes dot/dotdot, Windows reserved device stems and terminal dot (portable ordinary-file boundary). UTF8 byte ceiling5*1024*1024, following existing grep convention. Session read-only permission mode permits session artifacts; workbench read-only refuses writes. Disabled tools remain disabled.

Application-managed .vera/artifacts/<ses_ULID>/<name> uses strict ordinary ancestor/file and canonical confinement checks. General file tools retain their .vera denial. Save admission uses existing workbench WriteQueue, current ownership/abort checks, exclusive0600 same-folder temporary/fsync/rename and metadata/event transaction. Overwrite updates existing art_ULID; untracked on-disk collisions require operator reconciliation. Rows in existing schema1 require no migration; database uniqueness remains case-sensitive, Windows aliases refuse collision instead of producing multiple metadata rows. A file/hash mismatch is refused by open/citations, so interrupted filesystem/SQLite commits do not expose false verified content; a later explicit overwrite can repair. On synchronous database failure after rename, retained ownership permits restoring previous bytes (or removing the new file). If ownership is lost, the completed rename remains and the mismatched metadata/file is refused until an authorized overwrite repairs it. External filesystem changes are data conflicts. No general write/edit policy changes.

ArtifactsRepository owns CRUD, session/name unique row, time/id ascending list. ArtifactSummary={artifactId,sessionId,name,mime,bytes,sha256,description:string|null,createdAt}; ArtifactContent adds content. MIME text/markdown for .md/.markdown (case-insensitive), text/plain otherwise. UTC timestamps from injected clock. artifact.saved follows committed metadata/event; shared existing event/reducer remains compatible.

IPC artifacts.list {sessionId}->ArtifactSummary[]; artifacts.open/reveal/export {artifactId}; open->ArtifactContent; reveal->{}; export->{exported:boolean}. Main keeps SessionsHost lifetime while native dialog waits, reads source again after selection, rejects export destination within the managed .vera namespace, scrubs content before external write and snapshot responses. Save dialog defaultPath=name; cancellation does no write. VERA_TEST_DIALOG_PATH applies only under __VERA_TEST__, production behavior remains native dialog.

parseArtifactRef/formatArtifactRef and shared validArtifactName are pure. Core citations require successful issued ref plus matching session metadata and current verified bounded file; missing/fabricated/foreign refs false. Existing line refs retain behavior.

## Presentation

Artifacts tab queries snapshot before subscription then uses artifact.saved revision including duplicate overwrite events. List shows name, bytes and locale time; selected file opens from IPC. Markdown uses established inert renderer (skip HTML, no navigation/images); plain text uses wrapped pre. Export/Reveal actions show errors and lock while pending, retries reload failed requests. View keys include workbench/session/revision/artifact; obsolete completions cannot replace current selection. No artifact editor or binary viewer. Citation validity is supplied by core; tab is the requested internal viewer entrypoint.

## Acceptance and assumptions

Invalid names/duplicate/overlimit errors; summary.md plus valid/missing refs; appearance/open/export/native cleanup. Unit/integration tests cover confinement, ownership, modes, overwrite/restart, concurrent sessions and failed persistence. Electron/browser/CLI prove actual composed consumers.5MiB and portable reserved names are derived from existing bounded file conventions and safety constraints. Crash between resources can leave orphan/mismatched bytes; reads refuse mismatches and explicit overwrite repairs. No automatic recovery schema is added.

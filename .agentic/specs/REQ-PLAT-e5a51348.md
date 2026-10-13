# Native packaging and embedding spike contracts

## Behavior

The build delivers pinned native CPU SQLite/ORT libraries and offline document assets for Windows/Linux x64. Distribution target/layout/hash/budget contracts are in [Desktop distribution contract](REQ-PLAT-03f3a066.md). Build-time preparation is permitted; runtime model loading uses real resources/models with allowRemoteModels=false and local_files_only=true. BGE-small-en-v1.5 q8 at Xenova revision ea104dacec62c0de699686887e3f920caeb4f3e3 is selected by ADR0015.

## Interface and lifecycle

`npm run package` always compiles VERA_TEST=0 and uses a release output directory. `npm run package:test` compiles VERA_TEST=1 and uses a labelled test output directory. No runtime environment can change the compiled constant. Both use electron-builder v26 configuration under apps/desktop. Native libraries reside in app.asar.unpacked; extraResources materializes models as real files outside the archive (same native-access purpose as asarUnpack).

The packaged test shell accepts `--packaging-probe=<absolute JSON path>` after readiness, then runs probes and exits 0 on success or 1 on probe failure. It rejects unpackaged launches as packaging proof. This CLI hook has no renderer IPC exposure. Existing sandbox/CSP/origin/IPC rules are preserved. A JSON report contains schema version, OS/arch, Electron/Node versions, packaged=true, resource path, timestamp, per-probe status/results/errors and timing units in milliseconds. The external host harness records SHA256 of the exact artifact separately; the app does not claim host isolation.

The SQLite probe opens a unique temporary on-disk database, enables WAL, creates unicode61 with identifier underscore token characters and a separate trigram table, inserts I2C1_CR1 and queries whole token and quoted fragment C1_C, checks WAL files while open and persistence after reopen, and always cleans up. It measures dynamic native load separately. node:sqlite runs the same SQL through its adapter or records the real error.

The embedding host starts one emitted ESM worker with the real model directory and three fixed engineering sentences. The worker loads transformers on Node/CPU (onnxruntime-node), disables remote model loading and caching, measures import and load separately, then records each chunk timing, dimension, finite values, L2 norm and vector digest. The host fails after a bounded five-minute deadline, on worker error, malformed result or premature exit, and terminates the worker after completion. Float32 normalized 384-vectors are the oracle, not stubs.

## Build asset verification

A source manifest contains repository, immutable revision, model id, license attribution and path/URL/SHA256/bytes for each required model/config/tokenizer/license file. URL paths preserve the revision. The downloader checks path confinement, lengths and digests of cached and newly fetched bytes before atomic promotion; an altered existing file fails rather than silently replacing it. Packaging verifies assets independently. Downloads occur only during explicit build/preparation commands.

## Acceptance

Package/unpacked bytes and native/model contributions are recorded per OS. The Windows installer limit is250000000bytes with persisted contributors; ZIP size is measured. Only target OS/x64 native runtimes ship. Linux CUDA/TensorRT binaries are excluded; Windows retains upstream ORT DirectML/dxcompiler/dxil companions and pinned app-local VC++ DLLs for loader compatibility. The worker selects CPU execution. External evidence binds OS/isolation, matching artifact hashes and actual process results. Current connected Windows execution demonstrates feasibility and loaded DLL paths; real clean/offlineWindows and VC++ self-containment acceptance remain pending until final release. Release app code excludes probes/switches/fixtures.

## Release verification obligation

The authorized current-host Windows scope remains in force under verification-policy.md. Clean/offlineWindows and actual VC++ self-containment on that environment must be settled before final release. App-local import closure and current-host loaded paths supplement this obligation. Full release package session/egress/upgrade checks remain WP31–33. Runtime remote model loading is disabled on both platforms.

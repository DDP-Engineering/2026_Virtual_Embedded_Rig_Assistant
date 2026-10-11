# Native packaging and embedding spike contracts

## Behavior

The build produces Windows x64 zip and Linux x64 AppImage only for this foundation spike. Build-time download of pinned assets is permitted; runtime model loading uses the real resources/models directory with allowRemoteModels=false and local_files_only=true. bge-small-en-v1.5 quantized ONNX (q8) at Xenova revision ea104dacec62c0de699686887e3f920caeb4f3e3 is the feasibility fixture. Final model choice and recall remain WP-24.

## Interface and lifecycle

`npm run package` always compiles VERA_TEST=0 and uses a release output directory. `npm run package:test` compiles VERA_TEST=1 and uses a labelled test output directory. No runtime environment can change the compiled constant. Both use electron-builder v26 configuration under apps/desktop. Native libraries reside in app.asar.unpacked; extraResources materializes models as real files outside the archive (same native-access purpose as asarUnpack).

The packaged test shell accepts `--packaging-probe=<absolute JSON path>` after readiness, then runs probes and exits 0 on success or 1 on probe failure. It rejects unpackaged launches as packaging proof. This CLI hook has no renderer IPC exposure. Existing sandbox/CSP/origin/IPC rules are preserved. A JSON report contains schema version, OS/arch, Electron/Node versions, packaged=true, resource path, timestamp, per-probe status/results/errors and timing units in milliseconds. The external host harness records SHA256 of the exact artifact separately; the app does not claim host isolation.

The SQLite probe opens a unique temporary on-disk database, enables WAL, creates unicode61 with identifier underscore token characters and a separate trigram table, inserts I2C1_CR1 and queries whole token and quoted fragment C1_C, checks WAL files while open and persistence after reopen, and always cleans up. It measures dynamic native load separately. node:sqlite runs the same SQL through its adapter or records the real error.

The embedding host starts one emitted ESM worker with the real model directory and three fixed engineering sentences. The worker loads transformers on Node/CPU (onnxruntime-node), disables remote model loading and caching, measures import and load separately, then records each chunk timing, dimension, finite values, L2 norm and vector digest. The host fails after a bounded five-minute deadline, on worker error, malformed result or premature exit, and terminates the worker after completion. Float32 normalized 384-vectors are the oracle, not stubs.

## Build asset verification

A source manifest contains repository, immutable revision, model id, license attribution and path/URL/SHA256/bytes for each required model/config/tokenizer/license file. URL paths preserve the revision. The downloader checks path confinement, lengths and digests of cached and newly fetched bytes before atomic promotion; an altered existing file fails rather than silently replacing it. Packaging verifies assets independently. Downloads occur only during explicit build/preparation commands.

## Acceptance

Package and unpacked byte counts and ONNX/model contributions are recorded per OS. Windows package fails above 250,000,000 bytes and lists largest contributors. Only target OS/x64 native runtimes ship. Linux CUDA/TensorRT binaries are excluded; Windows retains the upstream ORT DirectML/dxcompiler/dxil companions for loader compatibility. The embedding worker explicitly selects CPU execution. WP-05 acceptance executes a fresh extraction of the exact final Windows ZIP on the current connected Windows host and the exact Linux AppImage in an actually isolated Ubuntu VM. External evidence records OS, host connectivity, matching expected artifact hashes before/after, actual process exit and packaged runtime results. The connected Windows proof demonstrates runtime feasibility on that host; it makes no clean/offline or VC++ independence claim. Linux evidence includes disabled adapters/routes and restoration. Release output and packaged app code exclude probe entries/switches/fixtures.

## Release verification obligation

The authorized WP-05 Windows verification scope is recorded in TASK-b862091d RULING-004. Clean/offline Windows execution and VC++ runtime independence remain unproven and must be settled before final release in WP-30/WP-33, including verified app-local redistribution if the clean supported OS lacks the imported runtime DLLs. NSIS/deb and full release package smoke also stay with WP-30/WP-33. Runtime remote model loading remains disabled on both platforms.

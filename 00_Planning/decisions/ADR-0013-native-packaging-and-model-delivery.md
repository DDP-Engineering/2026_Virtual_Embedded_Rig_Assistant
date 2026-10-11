# ADR-0013: Native packaging and verified local model delivery

Date: 2026-10-11
Status: Accepted for WP-05 — offline Linux and current connected Windows ZIP passed; clean/offline Windows and VC++ independence required before final release WP-30/WP-33

## Context

WP-05 checks ADR-0005's SQLite driver/tokenizers and ADR-0006's local worker runtime in actual
packages before database and indexing integration. Electron 44.7.0 remains the shell baseline.
The spike produces Windows x64 zip and Linux x64 AppImage; additional targets belong to WP-30.

## Decision

Use better-sqlite3 13.0.3 N-API prebuilds with WAL, FTS5 unicode61 (underscore identifier tokens)
and a separate trigram table. Preserve node:sqlite as an observed alternative, not an automatic
production fallback. Both drivers passed the same SQL in offline Linux and a fresh extraction of
the exact final Windows ZIP on the current connected host. This confirms ADR-0005 for the
authorized WP-05 scope; clean/offline Windows remains a final-release obligation.

Use transformers 4.3.1 with onnxruntime-node 1.30.0 CPU in a worker. The feasibility fixture is
Xenova/bge-small-en-v1.5 q8 at revision `ea104dacec62c0de699686887e3f920caeb4f3e3`.
WP-24 still selects the final model and evaluates retrieval. The tracked manifest pins HTTPS
asset URLs, SHA256, byte lengths and model-card provenance; explicit preparation/build commands
verify downloads before promotion and reverify cached assets. Generated model files stay out
of Git. Runtime disables remote model loading and filesystem/browser caches.

Use electron-builder 26.17.0 and its `asarUnpack` configuration for SQLite/ORT/sharp native
libraries; models ship through `extraResources` outside ASAR. Stage the installed locked runtime
dependency closure before packaging, filter foreign platform binaries and Linux CUDA/TensorRT libraries and inspect final
ASAR app code and native architecture. Exact versions and explicit install-script denials keep
N-API prebuild bytes intact and avoid an optional CUDA download or compiler requirement.
Windows retains upstream ORT DirectML/dxcompiler/dxil companions; their safe removal has not been
proved. This does not select a GPU provider: the embedding worker explicitly uses CPU.

`package:test` compiles the probe and worker; `package` compiles them out. Both modes inspect
emitted and packaged app code. The packaged test hook creates only temporary SQLite data and
records real load/per-sentence timings and finite normalized 384-vectors. Host harnesses record
observed host connectivity or isolation and bind reports to artifact hashes; the app never claims host isolation.

## Evidence and acceptance

[WP-05 measurements](../../06_SoftwareDocu/wp05-packaging-measurements.md) contains exact hashes,
sizes, results and durable raw evidence. Linux offline WAL/FTS5/reopen and real worker embeddings
passed. The fresh Windows final-ZIP execution passed both SQLite drivers and three real worker
embeddings, with packaged=true, matching before/after hashes and actual exit 0. Both Windows zip
modes remain below 250,000,000 bytes; both OS release ASAR inspections exclude probe markers.
Human authorization in TASK-b862091d RULING-004 accepts this connected-host proof for WP-05.
The historical isolated Sandbox attempt failed before Electron under Smart App Control and is
preserved as failed evidence. It does not establish clean/offline Windows or CRT independence.

## Alternatives considered

- Checking the model into Git adds roughly 35 MB; immutable URLs plus digest verification provide
  reproducible delivery while keeping the source tree small.
- System-installed ONNX or remote model loading conflicts with self-contained offline operation.
- node:sqlite works in observed Electron Node 24.21.0 builds, but this spike does not change the
  production driver decision or introduce a storage abstraction.
- electron-builder 27 changes the configuration contract; v26 retains the planned asarUnpack path.

## Consequences

The runtime/model add measurable package weight; Windows compressed size is enforced at build.
The bundled fixture is 34,961,638 bytes, including 34,014,426 bytes of quantized ONNX weights.
The builder adds eight moderate development audit findings through sprintf-js <=1.1.3, whose
latest available release is 1.1.3. Its format inputs are repository-controlled build descriptors;
runtime-only audit reports zero vulnerabilities. This accepted development limitation is recorded
in the task journal and does not waive security checks or Linux offline acceptance.

Before final release, WP-30/WP-33 must prove the actual Windows artifact on a clean offline
environment that permits its execution and settle the imported MSVCP140*/VCRUNTIME140* runtime
DLLs, which are absent from this ZIP. Current-host success cannot establish their independence.
Verified app-local redistribution is required if the clean supported OS lacks them. Packaging
and this spike change no host or guest security policies. Final signing and full distribution
smoke remain part of the release work packages.

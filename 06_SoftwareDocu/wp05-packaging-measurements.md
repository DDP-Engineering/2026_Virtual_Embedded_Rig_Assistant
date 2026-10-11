# WP-05 packaging measurements and execution procedures

Task: TASK-b862091d. Source base: `3e0c5a0b8dfbb14bf7ab7636e7858fa4b3cc0681`.
Measured on 2026-10-11 local; Linux offline evidence dated 2026-10-10 UTC and fresh Windows
current-host execution dated 2026-10-11 07:16 UTC. **WP-05 acceptance:** Linux offline and the exact
Windows ZIP on the current connected host passed, under the human-authorized scope in
TASK-b862091d RULING-004. Clean/offline Windows and VC++ runtime independence remain unproven and
required before final release in WP-30/WP-33. No production storage or final model choice is introduced.

## Artifacts

All sizes are bytes; MB uses 1,000,000 bytes. Windows budget is 250,000,000 bytes.
Unpacked totals count ASAR plus its physical unpacked files once. ORT totals include packaged
onnxruntime-node files; model totals include the seven model/tokenizer/card assets.

| Platform / mode | Artifact bytes | Unpacked bytes | ORT bytes | Model bytes | App-code exclusion / native architecture |
|---|---:|---:|---:|---:|---|
| Windows x64 test zip | 228,551,334 | 519,861,134 | 67,094,331 | 34,961,638 | Probe present / x64 only |
| Windows x64 release zip | 228,548,520 | 519,852,884 | 67,094,331 | 34,961,638 | Probe absent / x64 only |
| Linux x64 test AppImage | 179,384,351 | 409,358,016 | 46,236,643 | 34,961,638 | Probe present / x64 only |
| Linux x64 release AppImage | 179,384,496 | 409,349,762 | 46,236,643 | 34,961,638 | Probe absent / x64 only |

| Artifact | SHA256 |
|---|---|
| `VERA-test-0.0.0-win-x64.zip` | `9b48bb7463b77af901253ff839195ca9a8c32420b0d57bbad72aa3e21b5b6793` |
| `VERA-0.0.0-win-x64.zip` | `aa6329f06cd1a1c17306d9b44f0b64314613ce9aecb7292586563d58cb7999c0` |
| `VERA-test-0.0.0-linux-x86_64.AppImage` | `71a3101be50c34c89a644a2a4b7d0d120bd20d5a3f15ee2038379dc5c9a448ae` |
| `VERA-0.0.0-linux-x86_64.AppImage` | `582c6c187aab1f37fb22535941f79cf8cba4b4e69a6582d297af63962684a44b` |

Raw build reports with largest contributors and dependency versions:
[Windows test](evidence/wp05/windows/test-package.json),
[Windows release](evidence/wp05/windows/release-package.json),
[Linux test](evidence/wp05/linux/test-package.json),
[Linux release](evidence/wp05/linux/release-package.json).
Windows retains upstream ORT DirectML/dxcompiler/dxil companion DLLs (DirectML is 18,527,584
bytes); the probe explicitly selects CPU. Their safe removal has not been demonstrated.
The Windows executable contributes 246,302,208 unpacked bytes, q8 weights 34,014,426 bytes and
ORT DLLs are the next large native share. Linux executable contributes 228,605,256 bytes,
libonnxruntime 45,828,512 bytes and sharp libvips 18,699,288 bytes.

## Actual offline runtime result

Ubuntu WSL2 x64 VM: kernel 6.6.87.2; Electron 44.7.0 / Node 24.21.0 / N-API 10.
The completed AppImage was extracted and executed through `--appimage-extract-and-run`, as a
non-root user under Xvfb. The whole VM's eth0 and docker0 links were down; only lo was up.
Artifact SHA256 is identical before/after execution. Adapters and IPv4/IPv6 routes were restored
and their snapshots compared equal. A second default route with metric 50/protocol openr was
added temporarily in this dedicated VM to verify fidelity across distinct metrics/protocols; it
was removed after the run, preserving the original VM configuration.
The host harness makes the isolation assertion; the application reports only packaged runtime facts.

| Probe | Offline Linux result |
|---|---|
| better-sqlite3 13.0.3 native load | Passed, 16.3114 ms |
| Primary WAL / unicode61 / trigram / reopen | WAL and WAL file present; both queries find `I2C1_CR1`, including `"C1_C"`; reopened row count 1 |
| node:sqlite native load | Passed, 0.4321 ms |
| Fallback WAL / unicode61 / trigram / reopen | Same successful results; both SQLite versions 3.53.4 |
| Embedding worker / runtime | Real worker, onnxruntime-node 1.30.0 CPU, transformers 4.3.1, q8, remote models false |
| Runtime import / model+tokenizer load | 181.9435 / 339.4831 ms |
| Sentence 1 / 2 / 3 | 9.7800 / 5.7889 / 5.2345 ms |
| Vectors | 384 finite Float32 values each, L2 norm within 0.0001 of 1; digests/sample values recorded |
| Overall / process exit | Passed / 0 |

Sentences are fixed in the compiled probe: peripheral-clock register, SDA/SCL pull-ups and watchdog
reset. These are one observed run, not a performance benchmark or retrieval evaluation.
Evidence: [probe](evidence/wp05/linux/probe.json), [offline links](evidence/wp05/linux/links-offline.json),
[offline routes](evidence/wp05/linux/routes-offline.json), [before hash](evidence/wp05/linux/artifact.sha256),
[after hash](evidence/wp05/linux/artifact-after.sha256), [restored routes](evidence/wp05/linux/routes-restored.json).

## Actual Windows current-host runtime result

The final instrumented ZIP with the SHA256 above was extracted into a new unique temporary
directory and executed on the current connected Windows x64 host. The app reports packaged=true,
Electron 44.7.0 / Node 24.21.0 / N-API 10. The real child process exit was 0, the independent driver
oracles passed, and the ZIP's expected SHA256/228,551,334 bytes match before and after execution.
Host networking remained enabled; this execution makes no host-isolation or clean-host claim.

| Probe | Current connected Windows result |
|---|---|
| better-sqlite3 native load | Passed, 87.1062 ms |
| Primary WAL / unicode61 / trigram / reopen | WAL and WAL file present; both identifier queries find `I2C1_CR1`; reopened count 1 |
| node:sqlite native load | Passed, 0.7944 ms |
| Fallback WAL / unicode61 / trigram / reopen | Same successful results; both SQLite versions 3.53.4 |
| Embedding worker | onnxruntime-node 1.30.0 CPU, transformers 4.3.1, q8, remote models false |
| Runtime import / model+tokenizer load | 876.0007 / 610.8634 ms |
| Sentence 1 / 2 / 3 | 18.4178 / 11.1257 / 8.9676 ms |
| Vectors | Three finite normalized 384-vectors; digests identical to the Linux observation |
| Overall / actual process exit | Passed / 0 |

Evidence: [probe](evidence/wp05/windows/current-host/probe.json),
[execution and actual exit](evidence/wp05/windows/current-host/execution.json),
[connected host snapshot](evidence/wp05/windows/current-host/host.json),
[before hash](evidence/wp05/windows/current-host/artifact-before.json),
[after hash](evidence/wp05/windows/current-host/artifact-after.json),
[execution driver source](evidence/wp05/windows/current-host/driver.ps1.txt).
For repetition, save the driver source as a `.ps1` file and supply `-Artifact`, a new absolute
`-EvidenceDirectory`, and the expected `-ExpectedSha256`. The driver records host connectivity,
extracts into a unique directory, captures stdout/stderr, keeps the process handle for the actual
exit code and checks SQLite and worker oracles. It changes no adapters or security policies.
These timings describe one execution, not a benchmark.

## Historical Windows offline attempt and release obligation

Windows Sandbox build 26100: Networking=Disable, no active network adapter, only loopback routes. Hidden-adapter enumeration
finds four Not Present virtual/debug adapters; all IP compartments contain only loopback interfaces.
Hash before/after matches the Windows test ZIP above. Extraction succeeded, then Start-Process
failed at **application-launch** because Smart App Control blocks the unsigned VERA.exe.
CodeIntegrity 3033/3077 and 3118 identify policy
`{0283ac0f-fff1-49ae-ada1-8a933130cad6}` VerifiedAndReputableDesktop.
[Isolation](evidence/wp05/windows/isolation.json), [completion](evidence/wp05/windows/completion.json),
[before](evidence/wp05/windows/artifact-before.json), [after](evidence/wp05/windows/artifact-after.json),
[Code Integrity](evidence/wp05/windows/code-integrity.json), [signature](evidence/wp05/windows/signature.json),
[original WSB configuration](evidence/wp05/windows/VERA-offline.wsb).

An earlier retry reused a fixed extraction directory and failed because files already existed;
[retry-completion](evidence/wp05/windows/retry-completion.json) records that distinct error. The
repeatable harness uses a unique directory; its latest application-launch failure confirms the
policy blocker independently. No host or guest security policy was changed.

A [connected Windows diagnostic](evidence/wp05/windows/connected-diagnostic.json), performed on
the unpacked build before final ZIP creation, passed both SQLite drivers and three real embeddings:
primary/fallback load 31.9051/2.1546 ms, import/load 303.5096/1181.6792 ms, chunks
35.6469/25.7275/21.6871 ms. This diagnostic has no offline acceptance claim and is not bound to
the final ZIP hash and is superseded for current-host acceptance by the fresh ZIP-bound run above.
Windows clean/offline measurements are deferred under explicit human authorization, not passed.
Read-only PE analysis identifies required MSVCP140*/VCRUNTIME140* DLLs in ORT imports; they are
absent from this ZIP. Before final release, WP-30/WP-33 must execute the actual artifact on a clean
offline Windows environment and settle OS/runtime availability or verified app-local redistribution.
Current-host success does not demonstrate VC++ independence or clean-host self-containment.

## Repeatable Windows offline execution

Use a Windows x64 machine/VM that permits this development executable. Isolate that environment
externally before execution, then transfer the exact test ZIP and `probe-windows-offline.ps1`.
The harness verifies isolation and never changes adapters or security policy. It requires the
expected hash, enumerates hidden adapters/all IP compartments and rejects non-loopback routes,
records the hash before/after, uses a unique extraction directory, captures logs,
and has a 10-minute process deadline around the worker's 5-minute deadline.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\probe-windows-offline.ps1 `
  -Artifact .\VERA-test-0.0.0-win-x64.zip `
  -ExpectedSha256 9b48bb7463b77af901253ff839195ca9a8c32420b0d57bbad72aa3e21b5b6793 `
  -EvidenceDirectory C:\VERA-evidence
```

Collect `artifact-before.json`, `artifact-after.json`, `isolation.json`, `probe.json`,
`completion.json`, `stdout.log` and `stderr.log`. Acceptance requires identical expected hashes,
no active adapter, completion passed/exit 0, packaged true, SQLite primary passed and embeddings
passed with all three vectors. node:sqlite outcome is recorded even if unavailable.

For an eligible Sandbox host, from the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File 05_Software/scripts/probe-windows-sandbox.ps1 `
  -Artifact 05_Software/release/test/VERA-test-0.0.0-win-x64.zip `
  -EvidenceDirectory 02_Tools/cache/wp05/windows-offline-new -Launch
```

The launcher maps input read-only and evidence writable, disables networking in WSB, and copies
the same offline helper as its LogonCommand. A policy refusal remains a failed probe.
See [Microsoft WSB configuration](https://learn.microsoft.com/en-us/windows/security/threat-protection/windows-sandbox/windows-sandbox-configure-using-wsb-file)
for the isolation and mapped-folder contract.

## Repeatable Linux VM execution

On the isolated test VM, create an absolute evidence directory, then run as root:

```bash
bash 05_Software/scripts/probe-linux-offline.sh /absolute/VERA-test-0.0.0-linux-x86_64.AppImage /absolute/evidence test-user
```

This harness snapshots links/routes, disables all non-loopback adapters for the probe, verifies
the before/after artifact hash, and restores adapters/routes on success or failure. Supported IPv4/IPv6 route attributes,
including metrics and protocols, are replayed and compared with the complete snapshot; unsupported
topologies fail before any adapter changes. It is intended
for the dedicated VM, never the host. Run it only after packaging finishes; do not run other
network-dependent jobs in that VM during isolation.

## Delivery and release boundary

`resources/model-manifest.json` pins seven HTTPS URLs to the immutable model revision
`ea104dacec62c0de699686887e3f920caeb4f3e3`.
Model card attribution is included with the assets. The preparer checks cache and downloads against
length/SHA256 before atomic promotion, rejects corrupt cache/path escape and supports offline
verification. The package build invokes preparation; runtime permits local assets only.

Both OS test/release builders inspected all packaged `out/**/*.js|cjs|html` for
`packaging-probe`, `I2C1_CR1`, `allowRemoteModels` and `embedding-worker`; test contains all,
release contains none. Native libraries are physical unpacked files, including transitive sharp
libraries; models live in real resources/models. Windows budget and host OS/x64 native binary assertions
passed. Focused tests also execute both emitted identities with runtime VERA_TEST=1 and inspect
real ASAR archives on each platform.

[ADR-0013](../00_Planning/decisions/ADR-0013-native-packaging-and-model-delivery.md) accepts the
observed native-driver/model-delivery decisions for WP-05 under the authorized verification scope.
WP-24 final model/recall, WP-30 full targets and WP-33 actual release smoke retain their separate
acceptance work, including the explicitly deferred clean/offline Windows and VC++ proof.

# Wireshark workflow evaluation

Run from `05_Software` with the pinned Node toolchain. Build the workspace libraries with
`npm run typecheck` through the wrapper, and make native TShark available on the process PATH.
The evaluator uses a disposable profile and installs the checked-in official analysis package
there, using its catalog classification and verified package hash. It uses the CLI and VERA model
gateway for both deterministic loopback replay and real models.

```powershell
python ../02_Tools/environment/npmw.py npm run eval:wireshark -- run --provider replay --repeats 2
python ../02_Tools/environment/npmw.py npm run eval:wireshark -- run --provider custom --base-url http://192.168.1.13:1234/v1 --model qwen/qwen3.8-27b --reasoning low --cases filter-recovery,sensitive --repeats 1 --timeout 95
```

Use an authorized OpenAI-compatible HTTPS endpoint and `--key-env <NAME>` for hosted probes.
The custom provider routes through a loopback model proxy that observes completion bodies in
memory and forwards them only to the configured origin. Keep web tools off and use the frozen
synthetic cases. Each case has a wall-clock limit (120 seconds by default, 180 at most) and a
maximum of ten VERA tool calls and ten proxy completions. The case-specific call and byte ceilings
are scoring thresholds. The evaluator offers the typed Wireshark analysis and import tools plus
local file listing, skills and help. Shell commands, generic programs, raw reads and live capture
are unavailable in this evaluation profile.

## Frozen cases

`cases/wireshark.yaml` holds the prompts, expected calls, source-file digests, facts and frame
numbers. A source digest mismatch stops the run before inference. Shared inputs originate in the
[functional fixture inventory](../../tests/fixtures/wireshark-tshark/README.md).
`python evaluators/wireshark/cases/build.py` reproduces the two evaluator-only captures.

| Case | Independent oracle |
| --- | --- |
| Import | The eight-frame fictional board capture is retained byte for byte. Managed frame 6 has Modbus values 235 and 258. |
| Offline triage | CoAP frames 3 and 4 share message ID 4660. The latter is response code 69 (2.05). |
| Filter recovery | The invalid trailing conjunction is diagnosed before the corrected two-row CoAP query. Frame 4 has code 69. |
| Empty | The file has an interface header and zero packets. Endpoint evidence is unavailable. |
| Incomplete | Frame 9 has 56 captured bytes of 68 wire bytes. Missing payload is unavailable. |
| Comparison | Equal 500 ms windows yield three changed conversations, one added and one missing. The candidate has one TCP retransmission at frame 6. |
| Sensitive | Frame 4 holds synthetic HTTP credentials and a planted raw payload. The bounded TCP follow produces a byte count and the source-frame reference. |

## Measurements

The result checks expected ordered typed operations and arguments, after-error recovery and
observable tool fields. Successful capabilities and metadata lookups on the declared captures
count toward the call budget. A workbench reference with the expected path and digest can stand
in for the path. The scorer reports agreement with the requested facts and adherence to the
requested answer format separately. Each required citation must match the source digest,
original frame number and VERA verdict. Each fact must cite exactly its expected frames.
A successful case respects its call and data budgets. Cases with planted canaries also
require a clean observation of the model requests and CLI output.

Reports distinguish UTF-8 bytes in CLI tool result events from the peak bytes of tool content in one
observed model request, which can include previous tool results. The raw, hex and Base64 canary
checks cover the CLI events and separate model request bodies. The saved report omits request bodies
and keeps the observation counts, HTTP status and model IDs reported by completion streams.
Unobserved requests and cases without planted canaries are explicit. Rescoring rereads the saved events and retains the original
model observation when the canaries are unchanged. These checks sample planted data and do not
establish a general disclosure guarantee.

Use the shared `report` and `rescore` commands on `run.json`. Each run includes the original CLI
event streams, the selected fixture digests and the harness identity. Compare runs with matching
case selection and harness and inspect the reported runtime and platform before drawing conclusions.

## Native coverage

Use the replay on a native host for offline tool evidence. The functional acceptance commands also
cover derivation, firmware and UART imports and live acquisition. The former use saved captures.
Actual short and rolling captures require an explicitly selected test interface and an isolated lab.
See the [Wireshark functional proof inventory](../../tests/README.md). Ticket #334 has the Windows
Desktop receipts for selecting an exact cited source and derived frame. Ticket #332 has WSL2
proof for bounded short and stopped rolling acquisition, retained capture readback and loss
accounting. Native Ubuntu, live Windows and complete-suite acceptance are final-verification gates.

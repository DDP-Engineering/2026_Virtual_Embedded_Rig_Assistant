# ESP32 eFuses and image security

Official plugin, format 1, Windows x64 and Linux x64. The ESP32 pack's **Security
(irreversible)** group is off by default. Install the package, explicitly enable it for a
workbench, then use the user-triggered program installation action. Nothing burns on installation.

Both programs come from `pip: esptool>=5,<6` using the existing managed uv runtime. They share
that package's environment. Actual 5.6.0 `espefuse --help` and `espsecure --help` print their
version; these are the version probes (neither needs a chip). Do not use `espsecure --version`:
it is not a global version option. esptool v5 supports deprecated underscore command spellings;
VERA's matcher normalizes underscores, hyphens and case without changing raw launch arguments.

| Program/commands | Risk |
|---|---|
| espefuse summary, dump, check-error, get-custom-mac, adc-info | device-read |
| espefuse burn-*, write-protect-efuse, read-protect-efuse, set-flash-voltage | irreversible |
| espefuse --help / -h alone | safe |
| espsecure local key/image operations | safe |
| espsecure --hsm / --hsm-config | blocked |

eFuse bits are **one-time programmable**. A change can never be undone and may **brick the chip**.
Read commands may reset real hardware into its bootloader; this package's tests use no serial
connection and establish no physical reset behavior. Highest risk wins even when a command also
contains help or a read operation. Unknown espefuse commands default to device-write; future
`burn-*` names remain irreversible. Matching is conservative: an argument that is itself a
dangerous command token can raise risk even when used as an option value.

`safe` denotes hardware risk. espsecure writes local keys/images, may overwrite output files,
and `sign-data` modifies its input by default. VERA does not sandbox the subprocess or promise
filesystem confinement. The package does not install esptool's HSM extra and blocks HSM flags.
Keep private keys out of transcripts, artifacts and program output.

The `esp32-efuse-review` skill requires a current summary, an explanation of each requested burn,
one operation per call and a written session artifact plan before any irreversible call.
Loading the skill never implicitly requests a burn. It stops if a chip's coding scheme needs
batched operations rather than bypassing the single-operation rule.

With closed stdin, the actual noninteractive virtual sequence is:

```text
espefuse --chip esp32 --virt --path-efuse-file efuses.bin summary JTAG_DISABLE
espefuse --chip esp32 --virt --path-efuse-file efuses.bin --do-not-confirm burn-efuse JTAG_DISABLE 1
espefuse --chip esp32 --virt --path-efuse-file efuses.bin summary JTAG_DISABLE
```

`--do-not-confirm` skips only the upstream `BURN` prompt. It is an explicit argument bound to
the VERA request, never a fixed prefix. Ask/Auto-edit still require typing `burn-efuse`; the wrong
word leaves approval pending. Bypass needs no prompt and records `decided_by: mode`. Virtual mode
needs `--chip`; its state persists only with `--path-efuse-file`. The above changes only that file.
Check process exitCode 0 and the read-back field (`False (0b0)` to `True (0b1)`), not tool transport
success alone. All acceptance burns use `--virt`; no physical eFuse burn is tested or authorized.

Tests: `tests/integration/esp32-efuse.test.ts` includes offline package/rule/skill checks. Set
`VERA_EFUSE_UV` to the pinned bundled uv for explicit real provisioner/runner/replay acceptance;
this can download managed Python and esptool. `VERA_EFUSE_SCRATCH` selects the owned scratch parent;
`VERA_TEST_EVIDENCE_DIR` retains process argv, parsed results, events and durable approval rows.
Available Linux evidence must identify WSL separately from bare-metal Ubuntu. No ARM64 or physical
hardware execution is established by these virtual tests.

Primary documentation checked 2026-11-04 against the real 5.6.0 help:
[espefuse](https://docs.espressif.com/projects/esptool/en/latest/esp32/espefuse/index.html),
[espsecure](https://docs.espressif.com/projects/esptool/en/latest/esp32/espsecure/index.html).

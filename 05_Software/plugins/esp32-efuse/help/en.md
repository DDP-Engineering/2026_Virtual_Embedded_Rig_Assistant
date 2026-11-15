# ESP32 eFuses and image security

ESP32 eFuses and image security lets the agent review an Espressif chip's eFuses and, only when you explicitly ask, perform one permanent eFuse change at a time. It reads eFuse summaries and raw values with espefuse, and prepares local secure-boot keys, signatures, digests and encrypted images with espsecure. eFuse bits are one-time programmable: a burn can never be undone and can brick the chip. Enable it for a workbench only when needed; in the ESP32 pack its **Security (irreversible)** group is off by default.

## What it needs

- **espefuse** and **espsecure** from the esptool 5 package on PyPI, installed automatically by **Install dependencies** on the plugin page. Nothing burns on installation.
- An ESP32-family board on a serial port for reads and burns. Virtual eFuses (`--virt`) need no chip.
- No required plugins and no configuration parameters.

## How to use it

- "Show the eFuse summary of the ESP32-S3 on COM5." (skill `esp32-efuse-review`)
- "Is secure boot or flash encryption enabled on this chip?"
- "Explain what burning JTAG_DISABLE would do on this ESP32, and write a plan for it."
- "Generate a secure-boot signing key and sign build/app.bin."
- "Try the JTAG_DISABLE burn on virtual eFuses first."

A question about secure boot, an inspection or enabling the plugin never counts as a request to burn. Before any burn the agent reads the current summary, explains the exact field, its current and intended value and how a wrong value could brick this chip, and saves a written plan as a session artifact for your review. It never batches several burns into one command, never retries a failed burn and never adds `--force`. Private key material is kept out of chat and artifacts.

## Risk and approvals

- Safe, runs without asking: help and espsecure operations on local key and image files. Safe describes hardware risk only: espsecure can overwrite output files, and `sign-data` changes its input file when no output is given.
- Device-read: summary, dump, error checks, custom MAC and ADC information. Connecting resets the chip into its bootloader.
- Irreversible: every `burn-*` command, write and read protection, and setting the flash voltage. In Ask and Auto-edit modes VERA asks you to type the command word, for example `burn-efuse`. In Bypass these commands run without asking, so use Bypass with care when this plugin is enabled.
- Blocked: espsecure operations with an external HSM.

## Limits

- Windows x64 and Linux x64.
- All tested burns used virtual eFuses; no physical burn has been tested.
- A chip whose coding scheme needs several fields burned together is not handled; the agent stops and explains.
- References: https://docs.espressif.com/projects/esptool/en/latest/esp32/espefuse/index.html and https://docs.espressif.com/projects/esptool/en/latest/esp32/espsecure/index.html

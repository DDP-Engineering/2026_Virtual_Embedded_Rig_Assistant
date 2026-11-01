# ADR-0018: Hardware risk levels and irreversible operations

Date: 2026-11-01
Status: Accepted by the user on 2026-11-01, with `bypass` allowing irreversible commands.

## Context
On a bench, "read-only" is not free of side effects: `esptool chip-id` resets the chip into its
bootloader. Some operations can be undone by flashing again; others can never be undone: burning an
ESP32 eFuse, enabling secure boot or flash encryption, setting STM32 RDP level 2, writing OTP memory.
Some act outside the device: transmitting on a live CAN bus, switching a power supply. The existing
read/write tool classes and permission modes cannot express these differences.

## Decision
Every program command gets one level through the plugin's rules:

| Level | Meaning |
|---|---|
| `safe` | no effect on hardware |
| `device-read` | touches hardware without changing stored state; may reset or halt it |
| `device-write` | changes stored state that a reflash restores |
| `irreversible` | a permanent change, or physical actuation outside the device |
| `blocked` | never runs |

The highest level of all matching rules applies; an unmatched command is `device-write`.

| Mode | Runs without asking | Asks |
|---|---|---|
| `read-only` | `safe` | nothing else runs |
| `ask` | `safe` | `device-read`, `device-write`; `irreversible` with a typed confirmation |
| `auto-edit` | `safe`, `device-read` | `device-write`; `irreversible` with a typed confirmation |
| `bypass` | everything except `blocked` | — |

The typed confirmation is the matched subcommand (for example `burn-key`), checked in core, used
once and never remembered. In `bypass`, irreversible commands run unattended and are recorded as
decided by mode. Switching to `bypass` warns about the irreversible rules of the enabled plugins.
Plugins built around irreversible operations (`esp32-efuse`) are disabled by default.

Exception (accepted by the user on 2026-11-01): commands of a `trial` plugin (ADR-0016) wait for a
user approval in every mode, `bypass` included, and its irreversible commands also need the typed
confirmation.

## Alternatives considered
- Typed confirmation in every mode, including `bypass` (the first proposal): rejected by the user,
  because `bypass` means the user accepts unattended operation.
- A separate per-workbench opt-in list for irreversible rules: dropped as redundant with enabling
  the plugin and the typed confirmation.
- Forbid irreversible operations for the agent entirely: provisioning flows (production eFuse burns,
  secure boot) could then not be assisted at all.

## Consequences
- In `bypass`, a prompt-injected or mistaken command can permanently damage a board. The remaining
  guards are the bypass warning, dangerous plugins being disabled by default, and the rules
  themselves.
- Plugin authors must classify every command; CI lints dangerous tokens in low-risk rules
  (ADR-0019).
- Irreversible paths are tested with virtual hardware (`espefuse --virt`), never real eFuses.

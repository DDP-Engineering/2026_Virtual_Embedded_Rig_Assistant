# SCPI bench instruments (scpi-instruments)

Program `scpi` identifies the bench instruments a workbench declares, reads values, captures waveforms, changes
settings and powers a DUT output for a bounded hold - only through the validated profiles in `profiles/`. There is no
raw SCPI, no instrument search on the network and no driver installation.

## Install

`vera plugin install` (or Install in the Plugins page) runs `scripts/scpi_tool.py` with VERA's uv, which installs the
pinned PyPI packages once: PyVISA 1.16.2, pyvisa-py 0.8.1, pyserial 3.5 and pyusb 1.3.1. Nothing else is installed:

- USBTMC through pyvisa-py needs libusb 1.0 (Ubuntu: `sudo apt install libusb-1.0-0`; Windows: libusb-1.0.dll on PATH)
  and access to the device (Ubuntu: a udev rule you add; Windows: a WinUSB driver bound to the instrument, for example
  with Zadig). VERA changes neither.
- `backend: "ivi"` in `lab/resources.json` uses a VISA library you installed (NI-VISA, Keysight IO Libraries) instead
  of pyvisa-py; VERA neither installs nor configures it.

## Declare the bench

`lab/resources.json` in the workbench (format 1) lists each instrument: `alias`, `kind: "visa"`, the VISA `resource`
name, the instrument's `serial` number (optional, recommended), the `profile`, the `backend` (`py` default or `ivi`),
bench `limits` per channel below the profile's, and a `note`. VERA reads it before approving a run, shows the alias,
the resource and the file's SHA-256 in the approval, and refuses the run if the file changes before it starts.

## Operations

| Operation | Effect | Risk |
|---|---|---|
| `capabilities (--profile ID \| --alias A)` | profile and effective limits, no I/O | safe |
| `discover-configured [--list-local]` | the registry; with `--list-local` this computer's serial ports and USBTMC devices (pyserial, pyusb; VISA's resource search is never used because pyvisa-py's TCPIP listing broadcasts on the network) | safe / device-read |
| `decode --capture FOLDER` | recomputes a capture's series from its raw block and preamble | safe |
| `identify --instrument A` | `*IDN?` against the profile and the declared serial number | device-read |
| `read --instrument A [--channel CH]` | multimeter reading, or power supply voltage and current | device-read |
| `capture --instrument A --channel CH` | waveform transfer settings, preamble, data block | device-read |
| `status --instrument A` | settings and output states | device-read |
| `configure --instrument A --set NAME=VALUE ...` | settings, then readback | device-write |
| `close --instrument A` | every output off, then readback | device-write |
| `output --instrument A --channel CH --voltage V --current I --hold S` | off check, set-points, on, hold, off, readback | irreversible (`output`) |

Settings: multimeter `function` (`voltage-dc`, `voltage-ac`, `current-dc`, `current-ac`, `resistance`, `frequency`)
and `range` (a range of the function, or `auto`); oscilloscope `timebase` (s/div), `<CHANn>.scale` (V/div),
`<CHANn>.offset` (V); power supply `<CHn>.voltage`, `<CHn>.current` (only while that output is off).

Every instrument operation writes `embedded-lab-results/<run-id>/result.json` (format 1, kind `scpi-result`, status
`pass`, `fail`, `incomplete`, `blocked` or `error`) with the tool and PyVISA versions, the identity, the profile and its
verification status, the lifecycle (phases, `physical` state), values or series with units, problems, the commands
sent and the artifacts with SHA-256. Exit codes: 0 pass, 1 fail, 2 refused or blocked before any effect, 3 incomplete
or error during I/O. Problem codes: `truncated-transfer`, `visa-timeout`, `instrument-absent`, `driver-missing`,
`connection-lost`, `reconnected`, `unexpected-reply`, `identity-mismatch`, `profile-unknown`, `registry-changed`,
`state-unknown`, `readback-mismatch`, `output-on`, `clipped`, `stopped`, `limit`, `request`, `internal`. A refusal
before any instrument is contacted prints its document without creating a run folder.

## Reservation and cleanup

VERA reserves the declared instrument for the run before anything is sent: a second run, session, alias of the same
connection (same resource key, or the same declared serial number), VERA desktop window or CLI gets BUSY. Inside one
VERA process (not between the desktop app and the CLI), a run naming a serial port (serial-monitor, a sigrok-cli
driver's `conn=COM3`) and an `ASRL3::INSTR` instrument exclude each other.
Limits: VERA cannot lock out other programs, sigrok-cli's TCP and USB connections are not reserved, and two host names
of one address are not recognised as one instrument unless the entries declare the serial number.

On Stop, timeout, session stop, workbench close or app exit VERA first asks the helper to stop (it switches the output
off and reads it back within 10 s); if it cannot, VERA ends it and runs `scpi close --instrument <alias>` (60 s). When
neither confirms the state, the run reports `physical: unknown`, and `configure`/`output` on that instrument are
blocked until a `close` confirms it. For a multimeter or oscilloscope `close` confirms only that there is no output
to energize; their settings are not restored. VERA passes the approved `lab/resources.json` hash to the run and its
cleanup, and the helper refuses an edited registry (`registry-changed`). Nothing can switch an output off when the whole computer or VERA is lost; the next
run then reports the state as unknown.

## Support matrix

| Profile | Models | Transports offered | Verified on a real instrument |
|---|---|---|---|
| `keysight-34461a` | 34460A, 34461A | TCPIP INSTR/SOCKET, USBTMC | no |
| `rigol-ds1000z` | DS1054Z, DS1074Z, DS1104Z (+ Plus) | TCPIP INSTR/SOCKET, USBTMC | no |
| `rigol-dp800` | DP832, DP832A | TCPIP INSTR/SOCKET, USBTMC, serial | no |

| Platform | Backend | State |
|---|---|---|
| Windows x64 | pyvisa-py | offline tests with a simulated PyVISA; real PyVISA 1.16.2 + pyvisa-py 0.8.1 installed by VERA's provisioner ran identify, read, capture and output over TCPIP SOCKET against local simulated servers (2026-11-13) - no instrument |
| Ubuntu x64 (native) | pyvisa-py | not run yet |
| either | `ivi` (vendor VISA) | not run yet |

A transport or model is listed as verified only after a run against a real instrument (model, firmware, transport and
OS recorded in the profile's `verification.instruments`). PyVISA's support of an interface does not prove any
instrument or driver works.

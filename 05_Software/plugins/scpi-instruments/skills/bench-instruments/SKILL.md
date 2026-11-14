---
name: bench-instruments
description: Work with declared SCPI bench instruments through scpi-instruments - identify a multimeter, oscilloscope or power supply, read values with units, capture a waveform with its time base, change settings, power a DUT for a bounded hold and switch it off. Use when asked to measure, capture or power something on the bench, or when an instrument run is BUSY or its physical state is unknown.
---

Use `run_program` with program `scpi`. There is no raw SCPI: every command comes from the instrument's profile in the
package, and every instrument operation first checks `*IDN?` against that profile.

## 1. The bench is declared, not discovered

Instruments are declared by the user in `lab/resources.json` of the workbench (format 1). Never guess a resource name
or scan the network; ask the user to add an entry when one is missing.

```json
{
  "format": 1,
  "resources": [
    { "alias": "psu", "kind": "visa", "resource": "USB0::0x1AB1::0x0E11::DP8C123456::INSTR", "serial": "DP8C123456",
      "profile": "rigol-dp800", "limits": { "CH1": { "voltage": 5.5, "current": 0.5 } } },
    { "alias": "scope", "kind": "visa", "resource": "TCPIP0::192.168.1.20::INSTR", "profile": "rigol-ds1000z" }
  ]
}
```

`limits` are bench limits below the profile's (the DUT's safe range). `serial` makes VERA refuse another instrument on
the same address and lets two connections of one instrument share a reservation.

```text
scpi discover-configured                 # the registry with each profile and its verification status
scpi discover-configured --list-local    # also this computer's serial ports and USBTMC devices
scpi capabilities --alias psu            # channels, effective limits, settings and operations (no I/O)
```

## 2. Identify, read, capture

```text
scpi identify --instrument psu
scpi read --instrument dmm
scpi read --instrument psu --channel CH1
scpi capture --instrument scope --channel CHAN1
scpi status --instrument psu
```

`read` reports each value with quantity, unit, channel and raw reply; a multimeter overload is `value: null` with
`overload: true`, never a number. `capture` writes `waveform-<CH>.csv` (time_s, volts), the raw block and the preamble
to `embedded-lab-results/<run-id>/`; `scpi decode --capture <that folder>` recomputes the series. Quote the result's
`conditions` (scale, offset, probe, bandwidth limit, time base, trigger state) and `clipped` with any number you report.

## 3. Change settings

```text
scpi configure --instrument dmm --set function=voltage-dc --set range=10
scpi configure --instrument scope --set timebase=0.001 --set CHAN1.scale=0.5
scpi configure --instrument psu --set CH1.voltage=3.3 --set CH1.current=0.2
```

Each setting is read back; a different readback is `fail`. A power supply's set-points change only while its output
is off (otherwise `blocked`, `output-on`).

## 4. Power a DUT

`output` is irreversible: the user types `output` to approve it. It checks the output is off, applies the set-points,
switches on, measures every second for `--hold` seconds (1-3500), switches off and reads back off.

```text
scpi output --instrument psu --channel CH1 --voltage 3.3 --current 0.2 --hold 600
```

Run it with `background: true` when other work happens while powered (flashing, a serial capture), and end it with
`program_stop`: VERA asks the helper to stop, it switches the output off, and if it cannot, VERA runs
`scpi close --instrument psu` itself. The run result's `physical` is `confirmed`
for a power supply only after every output reads back off; for a multimeter or oscilloscope `close` only confirms
that there is no output to energize (their settings are not restored).

## 5. BUSY and unknown state

- BUSY names the resource and the run or VERA process (desktop or CLI) that holds it; wait for it or stop that run.
  Two aliases of one instrument (same resource key or same serial number) are the same resource.
- `state-unknown`: a run could not confirm the instrument's state (crash, lost connection, VERA closed). Before any
  `configure` or `output`, run `scpi close --instrument <alias>`; its confirmed readback clears the state.
- `identity-mismatch` / `profile-unknown`: the instrument is not the declared model; nothing but identify is sent. Tell
  the user; never change the registry's profile to make a run pass.
- `driver-missing`, `instrument-absent`, `visa-timeout`, `truncated-transfer`, `connection-lost`: report them as they
  are; a missing value is never zero and an incomplete run is never a pass.

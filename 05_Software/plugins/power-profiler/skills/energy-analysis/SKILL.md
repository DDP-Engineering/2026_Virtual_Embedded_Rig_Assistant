---
name: energy-analysis
description: Analyse power captures offline - mean/min/max current, energy and charge integrals, time in sleep/active states, energy per wake-up or per event, A/B firmware comparison that keeps setup differences apart from firmware changes (criteria judged by lab-validate), a battery-life interval with its assumptions, and a report. Use after a power capture, or to import a power export file (CSV) for analysis.
---

Use `run_program` with `power-analyze` (offline, safe). Every number is computed by the helper; never
estimate one yourself, and never fill a gap or an overflow with a guess.

## 1. Inspect and measure

- `power-analyze inspect --capture <run>`: rows, gaps, overflow, markers, firmware.
- `power-analyze import --csv data/export.csv --time-column t --time-unit s --current-column i
  --current-unit mA --voltage-column v --voltage-unit V [--marker 0=gpio]` turns another tool's export into a
  capture folder; the meter identity is then declared, not measured.
- `power-analyze measure-energy --capture <run> [--from 2 --to 12]`: energy (J) = integral of v x i, charge
  (C) = integral of i. Over a gap or an overflow both are **withheld** (null) with the covered values - report
  them as such, never as the total.
- Sign and offset: `--sign -1` when the meter was wired reversed; `--current-offset <A>` with
  `--offset-source` (for example a capture with the DUT disconnected). Reverse current is reported, not hidden.

## 2. Events and states

`power-analyze segment --capture <run> --markers 0 --event high` (or `cycle`), `--threshold 0.001` for
bursts seen in the current itself, or `--timestamps <file>` on the capture's own clock (its `capture` field is
the SHA-256 of the capture's result.json). Timestamps of the PC's UART arrival time are refused. Add
`--states sleep:0.0001,active` for time and energy per state. Quote the `sync` method with every
per-event number.

## 3. Firmware A/B

Capture A and B with the same setup and `--firmware` each, segment both the same way, then
`power-analyze compare --a <seg A> --b <seg B> [--energy-limit 0.0005]`. Read `classification`:
`firmware-change` (only then attribute the difference to the firmware), `setup-difference` (list what
differs; recapture), `same-firmware` (repeatability), `unidentified` (a capture has no firmware). For a
verdict, run `lab-validate compare --request <compare run>/lab-validation-request.json`; lab-validate makes
criteria incomplete when the source conditions (setup) differ.

## 4. Battery life

`power-analyze battery --profile <segment run> --battery battery.json` with capacity (mAh) or energy (Wh),
the battery voltage range, the usable fraction, the conversion (`direct`, `linear`, or `switching` with its
efficiency range), quiescent current and self-discharge when known. It prints an interval and its
assumptions, never one number; it refuses when a needed value is missing - ask the user rather than invent it.

## 5. Report

`power-analyze report --run <capture> --run <segment> ...` writes report.md/report.html with current plots;
point the user at it.

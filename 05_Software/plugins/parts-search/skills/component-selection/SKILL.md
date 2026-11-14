---
name: component-selection
description: Select an electronic component on evidence - write the hard constraints and preferences, search suppliers with parts_search, confirm critical values in the manufacturer's datasheet with page and conditions, and compare with parts-compare. Use when asked to choose, compare, replace or source a MOSFET, regulator, op-amp, resistor, capacitor, diode, inductor or similar part.
---

The host tool `parts_search` searches the supplier catalogs the user enabled in Settings > Parts search; the
program `parts-compare` (through `run_program`) compares candidates offline. Neither orders anything, and neither
changes a schematic or BOM. Load the skill `component-families` for the checks of each part family.

## 1. Write the request first

Before searching, write down with the user:

- **Hard constraints** - limits a part must meet, each with its conditions: for a MOSFET switching 5 A from 24 V
  with a 3.3 V gate drive, `VDS >= 30 V`, `RDS(on) <= 40 mΩ at VGS <= 3.3 V`, `ID >= 5 A at Tc 25 °C`, package.
- **Preferences** - what ranks the parts that pass, in priority order (lower RDS(on), price, stock).
- **Quantity** and the currency prices are compared in. A replacement also names the part it replaces with its
  pinout and footprint.

Ask when a hard constraint or its condition is missing; do not invent a margin or a drive voltage.

## 2. Search

```text
parts_search {"query": "N-channel MOSFET 30 V SOT-23", "limit": 10}
parts_search {"mpn": "BSS806NE"}
```

Only the query or part number leaves VERA. Each supplier reports a status: `key-required`, `auth`,
`rate-limited`, `timeout`, `unavailable` or `failed` mean no offers from it - never fill the gap yourself. Offers
are a snapshot at `retrievedAt` without taxes or shipping; supplier parameters are unconfirmed. Show a supplier's
`notice` with its data (TME: "powered by TME.eu Data; no guarantee of data accuracy"). If the tool is not offered,
the user must enable Web access, this plugin for the workbench and a supplier in Settings > Parts search.

## 3. Confirm critical values in the datasheet

For each candidate, open the manufacturer's datasheet (web_read, web_download or a local copy) and record each
critical value with its page or table, its basis (`min`, `typ`, `max`, `nominal`, `rating`) and its test
conditions (VGS, ID, temperature, frequency). A value is `confirmed` only after you checked it on that page; a
value taken from text extraction or a supplier page stays `proposed`. Never read a value off a curve or a scanned
page - ask the user to read it and confirm it. A different parameter is never evidence: VGS(th) says nothing about
RDS(on) at your drive voltage.

## 4. Compare

Write the request as JSON (`parts-compare compare --help` lists every field) and run:

```text
parts-compare compare --input <request>.json
```

It decides each candidate from the hard constraints alone: `eligible` (all pass), `unknown` (a value is not
proven under the right conditions - the reasons say which), `rejected` (one fails). Only eligible parts are ranked
by the preferences, so a cheaper part that fails or is unproven is never proposed. Cut-tape and reel offers of one
MPN and package are one device; a different MPN is another device. Prices use the order quantity raised to the
MOQ and multiple, compare by the cost of that quantity and only within one currency; offers older than 24 hours
are marked stale.

## 5. Report

Give the proposed part (or say none is proven), the checks with their datasheet pages and conditions, the
unknowns and what would settle them, and the offers with their capture time. `bom.csv` is a proposal for the user;
never present it as ordered or as an update of the project BOM. Call a part a drop-in replacement only when
parts-compare says `dropIn: yes` (pinout and footprint confirmed on datasheet pages).

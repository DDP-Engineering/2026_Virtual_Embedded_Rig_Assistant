# parts-search fixtures

Fictional parts ("Fictional Semi") for `parts-compare`. `{{-1h}}` and `{{-25h}}` are replaced by the test with the
run's time minus one or twenty-five hours, so the stale rule (older than 24 hours) is exercised without a clock.

## mosfet-24v.json - expected outcome, derived by hand

Request: quantity 100, currency EUR; hard constraints `VDS >= 30 V`, `RDS(on) <= 40 mΩ at VGS <= 3.3 V`,
`Channel == N`; preferences RDS(on) min, then price; replaces FS3025 (pinout `1=G 2=S 3=D`, footprint SOT-23).

| Candidate | VDS | RDS(on) evidence | Outcome | Why |
|---|---|---|---|---|
| FS3040 | 30 V rating, pass | 28 mΩ only at VGS 10 V; VGS(th) 0.9 V is another parameter | unknown | "VGS 10 V does not meet VGS <= 3.3 V" (E03-C) |
| FS3025L (+ fs3025l reel) | pass | 35 mΩ max at 2.5 V qualifies; 24 mΩ at 4.5 V does not | eligible | worst qualifying value 35 mΩ <= 40 mΩ |
| FS3025L-P | pass | 38 mΩ max at 3.3 V (boundary, `<=` holds) | eligible | 38 mΩ <= 40 mΩ |
| FS6020 | 20 V rating, fail | 18 mΩ at 2.5 V passes | rejected | VDS 20 V < 30 V; cheapest (0.05 EUR) yet never proposed |
| FS3030T | supplier value only | 30 mΩ typ; 36 mΩ max proposed | unknown | "supplier value", "typical value is not a guarantee", "proposed" (E03-C) |

- Identity (E03-D): `FICTIONAL SEMI` / `fs3025l` / `SOT-23` folds to the same device as FS3025L: one device with
  two offers (cut tape and reel) and a merge warning. FS3025L-P is a pinout variant with its own MPN: a separate
  device.
- Ranking: eligible FS3025L (representative RDS(on) = worst confirmed max over its rows = 35 mΩ) before
  FS3025L-P (38 mΩ). Then the unknown ones in request order (FS3040, FS3030T), then FS6020. Proposed: FS3025L.
- Drop-in: FS3025L pinout `1=G  2=S 3=D` and footprint `sot-23` equal the replaced part after folding case and
  spaces, both with pages: `yes`. FS3025L-P pinout differs: `no`. FS3040 states neither: `unknown`.
- Offers of FS3025L at quantity 100:
  - Mouser cut tape: order 100, break 100 -> 0.19 EUR, extended 19.00 EUR, captured 1 h ago, not stale.
  - DigiKey reel: MOQ 3000 -> order 3000, break 3000 -> 0.07 EUR, extended 210.00 EUR, captured 25 h ago, stale.
- FS3025L-P at TME: MOQ 10, multiple 10 -> order 100; break 10 -> 0.15 EUR, extended 15.00 EUR.
- bom.csv: one `proposed` row for FS3025L with the Mouser offer (lowest extended price, 19.00 < 210.00 EUR):
  `proposed,100,Fictional Semi,FS3025L,SOT-23,mouser,FS-3025L-CT,Cut Tape,100,0.19,EUR,<captured>,no`.
- Warnings: the merge of candidates 1 and 2, and one stale offer.

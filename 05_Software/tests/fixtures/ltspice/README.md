# ltspice fixtures

Fictional circuits for `ltspice-tool`. Every expected value below is derived by hand, with its tolerance, before any
engine run; the tests assert these numbers. `divider.cir`, `rc.cir`, `switch.cir`, `load.cir`, `noise.cir` and
`singular.cir` are the ngspice fixtures unchanged, so one request runs on both engines (E05-C). LTspice stores
dependent values of real analyses as float32: about 7 significant digits.

## Analytic references (E05-A, E05-C)

| Fixture | Request | Expected | Tolerance | Derivation |
|---|---|---|---|---|
| divider.cir | op, v(out) | 2.163934 V | 1e-6 relative | 12 V x 2.2k / (10k + 2.2k) |
| divider.cir | op, RB = 10k | 6.000000 V | 1e-6 relative | 12 V x 10k / 20k (the `.param` assignment rewritten) |
| rc.cir | tran 1 us..5 ms, v(out) at 1 ms | 0.632121 V | 0.2 % | 1 - e^-1, tau = 1k x 1u = 1 ms |
| rc.cir | ac dec 100, vdb(out) at 159.155 Hz | -3.0103 dB | 0.01 dB | 1/(2 pi R C) = 159.155 Hz, 20 log10(1/sqrt 2) |
| rc.cir | ac, v(out) magnitude at 10 Hz | 0.998031 | 1e-6 relative | 1 / sqrt(1 + (2 pi x 10 Hz x 1 ms)^2) |
| filter.asc | ac dec 100, vdb(out) at 159.155 Hz | -3.0103 dB | 0.01 dB | the same RC drawn as a schematic |
| stage.cir | ac dec 100, vdb(out) at 159.155 Hz | -3.0103 dB | 0.01 dB | the same RC as a subcircuit whose R comes from a nested include |
| switch.cir | average power v(a) x i(Vsense) 1..2 ms | 7.058 W | 0.5 % | I_on = 12/(10 + 0.1) A, P_on = I_on^2 x 10 = 14.116 W, duty 0.5 |
| switch.cir | max of v(a) x i(Vsense) | 14.116 W | 0.5 % | differs from the average by the duty factor |
| noise.cir | noise v(out) V1 dec 5 10..1k Hz, onoise | 2.8789e-9 V/sqrt(Hz) | 1 % | sqrt(4 k T R), T = 300.15 K, R = 1k parallel 1k = 500 ohm |
| library.cir | op, v(a) | 0.55 .. 0.80 V | range | a 1N4148 forward voltage at about 4.3 mA (LTspice's standard.dio, read in place) |

Against ngspice-tool on the same request (when VERA_TEST_NGSPICE is set): divider 1e-6, RC transient 0.2 %, RC
-3 dB point 0.01 dB, noise 1 %. A difference beyond these is a model or dialect question until analysed.

## Failures (E05-D), status failed, exit 3, no criterion passes

- missing-model.cir: D1 names `DNOPE` - LTspice: `Undefined model`, problem `model`.
- missing-subckt.cir: X1 names `NOPESUB` - `sub-circuit name is not defined`, problem `subckt`.
- singular.cir: two DC sources in parallel - `paralleled making an over-defined circuit matrix`, problem `singular`.
- loop.cir: a behavioural source that switches on its own output - `Time step too small`, problem `convergence`.
- divider.cir with vector `v(nonode)`: the raw file has no such vector, problem `vector`.
- schematics/nosymbol.asc: LTspice writes no netlist (a non-zero exit), problem `convert`.

## Sweeps (one `.step` run)

- load.cir: v(out) = 10 x RLOAD / (1k + RLOAD) - RLOAD 1k gives 5 V, 3k gives 7.5 V.
- temp.cir: v(out) = 1k / (1k x (1 + 0.01 (T - 27)) + 1k) - 0 °C: 0.578035 V, 27 °C: 0.5 V, 100 °C: 0.366300 V (1e-5).
- Monte Carlo on RLOAD of load.cir (nominal 1k, 10 %, uniform, seed 7, 5 runs): the same seed gives the same draws;
  seed 8 others; every draw lies within 900..1100 ohm and its point's v(out) equals 10 x R / (1k + R) (1e-5).

## Hostile files (E05-F), all refused with exit 2 before LTspice runs

| File | Refusal |
|---|---|
| hostile/wave.cir, fullwidth.cir (`．ｗａｖｅ`, NFKC) | `.wave` writes a WAV file anywhere |
| hostile/savebias.cir, loadbias.cir, savestate.cir, loadstate.cir | bias and state files |
| hostile/pwl-file.cir, wavefile.cir, scopedata.cir, tbl.cir, continuation.cir | sources reading files (`file=`, `wavefile=` on a `+` line...) |
| hostile/table-include.cir, table-inc.cir, table-lib.cir | `include`, `.inc` or `.lib` inside a B-source expression |
| hostile/fastaccess.cir | `.options fastaccess` rewrites the raw file |
| hostile/fra.cir, machine.cir, unknown.cir | `@` element, `.machine`, an unknown card |
| hostile/string.cir | a quoted string parameter (string values can name files) |
| hostile/nested.cir + nested.lib | `.wave` inside an included file |
| hostile/encrypted.cir + encrypted.lib | an encrypted include cannot be checked |
| hostile/utf16.cir | not UTF-8 (LTspice would read it as UTF-16) |
| hostile/outside.cir, absolute.cir, unc.cir, missing.cir | includes outside the workbench, another file, a network path, a missing file |
| hostile/lib-endl.cir | `.lib C:\Windows\win.ini` with `.endl` after `.end` (a single-name `.lib` is an include outside a section library) |
| hostile/lib-quote.cir | an unterminated quoted `.lib` path |
| hostile/ls-comment.cir, nel-element.cir, ls-include.cir + ls-include.inc | U+2028 or U+0085, which LTspice reads as a line break: refused as `encoding` (text after them would be a live card) |
| hostile/percent.cir + pct%s.inc | a `%` in an include name (LTspice 26.1.1 crashes on it) |
| hostile/nfd-include.cir | an include name not in NFC (LTspice composes it, so it would load another file) |
| hostile/nfd-ä/top.cir + x.inc | a netlist in a folder whose name is not in NFC (the copy's include line names the folder) |
| schematics/nfd-ä/nfd.asc | a schematic in a folder whose name is not in NFC (refused before conversion) |
| hostile/file-noeq.cir, file-glued.cir, scope-noeq.cir, incl-abbrev.cir, inc-glued.cir | LTspice matches `file`, `scopedata` and `.inc` by prefix, also without `=` and glued to a path: refused as substrings |
| hostile/shy-file.cir, zw-include.cir, bom-file.cir, shy-fastaccess.cir | invisible formatting characters (soft hyphen, zero-width space, an inner BOM), which LTspice drops before matching: refused as `encoding` |
| hostile/unc-slash.cir, root.cir | `//server/share/...` and `\Users\...` includes: refused, and the printed refusal shows only the file name |
| hostile/lib-space.cir, inc-semicolon.cir | an unquoted include's whole rest is its file name (`;` included), as LTspice reads it: `standard.dio ..\..\...` leaves the workbench |
| hostile/cycle.cir | the netlist includes itself (its title would be read as a card) |
| hostile/section.cir + section.lib | an absolute `.lib` inside a section library |
| schematics/abs/abs-symbol.asc, up/up-symbol.asc, u16/u16-symbol.asc, sheets/top.asc | symbols named by an absolute or escaping path - also in a UTF-16LE file without BOM and in a sibling sheet |
| schematics/wave.asc | its converted netlist holds `.wave` (refused after conversion, exit 2) |
| schematics/nel/nel-text.asc | a TEXT directive with a 0x85 byte: the converted netlist holds U+0085 (refused, `encoding`) |

`models/stage.lib` holds a quoted `mfg="Fictional"` inside a `.model` card: accepted. `sections.cir` includes the TT
section of `"models/corners.lib"` (a section needs a quoted file name) (`.lib TT` ... `.endl` sections): accepted. `options-path.cir` (validated only) shows its
`.options` with paths by file name. `ltc.cir` (`.lib LTC.lib`, validated only)
and `diode/diode.asc` (a 1N4148 from `standard.dio`) check LTspice-library inputs.

## Limits

- divider.cir with a transient of 2 000 000 points on the standard profile is refused (limit, exit 2).
- switch.cir, tran 10 us..100 ms with maxStep 1 ns and a 2 s time limit: LTspice is stopped, status timeout, exit 3.
- The same run through `limit.py` (data limit 1000 rows): stopped by the data limit, problem `limit`, exit 3.

## Raw files (`raw/`)

Written by LTspice 26.1.1 (Windows 11, 2026-11-13) from the circuits beside them with `LTspice.exe -b <name>.cir`:
real (`tran`), double (`double`, `.options numdgt=8`), complex (`ac`), stepped transient, stepped AC, stepped op, op and
noise. The test derives cut, garbled and backwards copies from `tran.raw`.

Hooks: `raw_dump.py` (parser output as JSON), `change_input.py` (the input changes after the run), `limit.py` (lower
data limit), `write_fail.py` (writing the report fails).

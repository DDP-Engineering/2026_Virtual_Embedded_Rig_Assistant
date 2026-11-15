# Verification fixtures

These fictional inputs support tests, retrieval evaluation and package smoke checks.
They are not application resources and are not included in installers.

`workbenches/demo-board/` is the fictional VERA-DEMO-01 verification project, including
PDF/Markdown documents, notes, pinout, boot log and replay input. Tests copy it
into isolated workspaces before opening or modifying it.
`workbenches/demo-board.json` records its identity and the complete fixture file inventory.

`npm run make:demo-pdfs`, run from `05_Software`, regenerates the three fixture PDFs
from `workbenches/demo-board/sources/`.

`echo-program/echo.mjs` is the program the plugin runner tests start through each compiled
ProcessHost; `ECHO_MODE` selects echoing its arguments and working directory, its environment,
reading stdin, flooding output, ANSI output, or starting a grandchild that runs until killed.

`plugins/echo-tools/` is an installable plugin for the agent's program tools: program `echo` runs
`echo.mjs` (prefix `${pluginDir}/echo.mjs`), its rules cover every risk level, and it ships the skill
`echo-guide`. Core session tests, the CLI integration test and the native e2e install it.

`electrical-model/two-pump-panel.json` is a fictional electrical project model (format 1): one LV
source, the main board, two pump feeders and a lighting circuit with their breakers, cables, contactors,
the PLC I/O, the level transmitter and tags. Its values cite a made-up brief, not a product datasheet.

`electrical-network/network-a.json` is a fictional radial LV network (630 kVA Dyn11 transformer, main and
sub-board, a motor, lighting and a socket circuit) for the electrical-network engine; `tbl-test-cu-pvc.json`
is a fictional cable table with values chosen for the tests. `tbl-nexans-nym-j.json` holds real values typed from
the public Nexans NYM-J product page (read 2026-11-15, cited in the file): DC resistance and the 30 °C current
ratings of each cross-section; it has no correction factors, reactance or k because the page gives none.

`protection-coordination/cat-lv-protection.json` is an industrial catalog typed from public pages read 2026-11-15
(cited per value): Schneider Electric Acti9 iC60N A9F74316, A9F74216 and A9F74340 (se.com UAE product pages: Icu,
Ics, Icn, Ue, In, magnetic band 8 x In +/- 20 %), Eaton Bussmann C10G16, C10G20 and C10G32 gG fuses (eaton.com UK
pages: In, rated voltage, 120 kA), TeSys GV2ME14, LC1D09P7 and LC1D18P7 with their gG fuse coordination tables copied
from the industrial-catalog fixture, and conventional tripping ratios from Schneider Electric's public Electrical
Installation Guide. It holds no time-current points, I2t values or selectivity tables because the pages give none.

`motor-drives/plant-m.json` is a fictional plant (the network A transformer, a main board and three motor circuits:
a 2.2 kW fan, an 11 kW pump with a 400 V delta winding and a 5.5 kW conveyor with a 230/400 V winding) whose motor
and load values come from a made-up brief. `motor-drives/cat-motor-drives.json` is an industrial catalog typed from
public pages read 2026-11-15 (cited per value): TeSys GV2ME10, LC1D09P7/LC1D18P7 with their gG fuse tables and the
Bussmann C10G20/C10G32 fuses copied from the fixtures above, TeSys LRD21 and LAD9V2, Altistart 22 ATS22D32Q and
Altivar Process ATV930U75N4 (se.com UK product pages), and the class 10A tripping band from se.com FAQ FA22893. It
holds no softstarter starts per hour, drive EMC category or motor cable length because the pages give none.
Read 2026-11-16 from the same pages: the height, width and depth of LC1D09P7, LC1D18P7, GV2ME10 and LRD21, the coil
heat dissipation (upper value of 2...3 W) and maximum ambient of the contactors, and LRD21 as accessory of LC1D18P7
(LRD21 page: product compatibility LC1D18...LC1D38, mounting under the contactor); the pages state no loss for LRD21.

`panel-engineering/cat-panel.json` is an industrial catalog typed from public se.com UK product pages read 2026-11-16
(cited per value): Modicon ABLS1A24050 (24 V 5 A, efficiency, 25 W dissipation, 2.5 %/K derating above 50 °C),
Modicon M221 TM221CE16T (4.6 W / 11 W at 24 V, 55 °C horizontal / 35 °C vertical), PanelSeT S3D NSYS3D6420
(600 x 400 x 200 mm) with its plate NSYMM64 (550 x 350 mm), Linergy TR NSYTRV42 terminal blocks and Harmony XB5AA31 /
XB5AA42 push buttons. `panel-engineering/pnl-plant-m.json` is a FICTIONAL panel over plant M (rails, ducts, zones,
rules, scenarios, reserve, the 35 °C ambient and the 5 W wiring allowance come from a made-up brief); its heat-transfer
coefficient 5.5 W/(m²·K) is the painted sheet steel value of the Schneider Electric enclosure catalogue p. 8/110.
It keeps real gaps: no cited data for the LAD9V2 size, the C10G32 fuse holder or the star-delta timer KT1.
`tests/support/panel_thermal_check.py` recomputes its dissipation and temperatures independently.

`power-quality-pfc/plant-q.json` is a fictional plant (the network A transformer and a main board with three motor
groups, a drive group and lighting). `power-quality-pfc/meas-fictional-mdb-day.json` + `.csv` is a FICTIONAL
measurement day at that board (declared `origin: fictional`, CC0), generated from a made-up brief: 96 x 15 min of
P, Q1, S, PF, U, THD and harmonic orders up to 25. `power-quality-pfc/cat-pfc.json` is typed from public se.com UK
product pages read 2026-11-15 (cited per value): VarPlus Can HDuty BLRCH125A150B48, detuned reactor LVR07125A40T,
capacitor contactor LC1DFKP7, plus the Bussmann C10G20/C10G32 fuses copied from the protection fixture. It holds no
capacitor/reactor pairing table because no public one was found; the tests add a fictional one in memory.
`power-quality-pfc/meas-hipe-main-terminal-2017-10-24.json` + `.csv` is REAL data: an excerpt of the HIPE data set
1.0.1 (Bischof, Trittenbach, Vollmer, Werle, Blank, Boehm, KIT; ACM e-Energy 2018, doi 10.1145/3208903.3210278;
https://www.energystatusdata.kit.edu/hipe.php), licensed CC BY 4.0. Changed: main terminal only, 2017-10-24 only,
the first raw reading of each minute (1440 rows, no averaging), 31 of 362 columns renamed, float32 values written with
at most 3 decimals; HIPE does not document whether Q is fundamental, so the file declares `reactive: undeclared`.

`lighting-design/` holds only FICTIONAL data written for the tests by a generator kept outside the repository (no real
product, room or report): `fict-downlight.ies`
(IES LM-63-2002, absolute, Lambertian I0 = 1000 cd, 30 W) and `fict-panel.ldt` (EULUMDAT symmetry 4, I(C, g) =
I0 cos g (1 + 0.3 cos 2C), lamp flux 4800 lm, LORL 90 %, 36 W) are analytic distributions with known flux;
`lgt-office-a.json` is an 8 x 6 x 3 m office with 12 panels, two scenarios, user-entered fictional requirements and a
fictional UF table; `rep-office-a.json` is a fictional DIALux report record (`origin: fictional`, no engine was run);
`model-office-a.json` is a minimal electrical model with the lighting load; `cat-lighting.json` a fictional luminaire
catalog item.

`qelectrotech/` holds the three QElectroTech starter candidates (`dol`, `reversing`, `star-delta`.generated.qet) that
VERA's templates render from the motor-drives assemblies of `qet-templates.test.ts` with deterministic UUIDs; the test
compares a fresh render with them byte for byte (regenerate with `VERA_QET_FIXTURES_UPDATE=1`). Every element symbol in
them is self-authored by VERA (category `embed://import/vera/`); no element of QElectroTech's collection is included.
QElectroTech 0.100.0 (Windows portable) and 0.90 (Ubuntu 24.04 apt, WSL2) open them without a load error.

The remaining folders contain document extraction samples, replay scripts,
translation checker cases and retrieval questions/model manifests.
Existing user workbenches and profiles are never part of this directory.

`app-data/` holds current-format application data: `credentials.json`, `workbench.yaml`
and `interrupted-sessions.json`, the crash-recovery fixture with interrupted sessions.
Every stored format is version 1 during development, so there are no previous-version
or newer-version fixtures.

# Official plugins: electrical power and distribution

## Routing

Select for `industrial-catalog`; `electrical-network`; `protection-coordination`; `motor-drives`; `power-quality-pfc`;
and `lighting-design`.

For industrial-catalog, start at plugins/industrial-catalog/plugin.yaml (no program, ecosystem `electrical`) and
skills/industrial-selection; the catalog format, the `industrial_catalog` tool and their tests belong to
[electrical model](electrical-model.md).

For electrical-network, start at plugins/electrical-network/plugin.yaml (no program, ecosystem `electrical`) and
skills/network-sizing; the engine, the cable-table format, the `electrical_network` tool and their tests belong to
[electrical model](electrical-model.md). For protection-coordination, start at
plugins/protection-coordination/plugin.yaml (no program, ecosystem `electrical`) and skills/protection-selection; the
engine, the `protection_coordination` tool and their tests belong to [electrical model](electrical-model.md). For
motor-drives, start at plugins/motor-drives/plugin.yaml (no program, ecosystem `electrical`) and skills/motor-starting;
the engine, the `motor_drives` tool and their tests belong to [electrical model](electrical-model.md). For
power-quality-pfc, start at plugins/power-quality-pfc/plugin.yaml (no program, ecosystem `electrical`) and
skills/power-factor-correction; the engine, the measurement format, the `power_quality` tool and their tests belong
to [electrical model](electrical-model.md). For lighting-design, start at plugins/lighting-design/plugin.yaml (no
program, ecosystem `electrical`) and skills/lighting-design; the photometry readers, the lighting formats, the engine,
the `lighting_design` tool and their tests belong to [electrical model](electrical-model.md).

The conventions shared by all official plugins (package format, catalog source, packs, versions and evidence
levels) and the page of every other plugin are in [Official plugins](official-plugins.md). The platform that
installs, classifies, approves and runs these programs is [Plugins](plugins.md); plugin skill discovery is
[Skills](skills.md).

## Public interface

- `industrial-catalog` 0.1.0, ecosystem `electrical` (pack Electrical power and distribution, group Industrial
  catalog and selection, default on; activity `design`), Windows x64/Linux x64, no program. Skill
  `industrial-selection`: firm requirements with conditions, selection through VERA's `industrial_catalog` tool,
  eliminations and unknowns explained, coordination only for the exact products and voltage, and a proposal
  applied only through `electrical_model_change`. Loading it enables `electrical_model`, `electrical_model_change`
  and its own `industrial_catalog`; each other electrical plugin tool needs its own plugin. Live supplier offers stay with parts-search; this plugin holds no
  credentials. Format and tool: [electrical model](electrical-model.md), spec REQ-DATA-d7e27def.
- `electrical-network` 0.1.0, ecosystem `electrical` (pack Electrical power and distribution, group Network, cable
  sizing and short circuit, default on; activity `design`), Windows x64/Linux x64, no program. Skill
  `network-sizing`: model inputs checked, a cited cable table and scenarios agreed, VERA's `electrical_network`
  tool run, the governing criterion, unknowns and limits explained, a proposed section applied only through
  `electrical_model_change`. Engine, table format and tool: [electrical model](electrical-model.md), spec
  REQ-DATA-42ce122f.
- `protection-coordination` 0.1.0, ecosystem `electrical` (pack Electrical power and distribution, group Protection
  and coordination, default on; activity `design`), Windows x64/Linux x64, no program. Skill `protection-selection`:
  a current network result confirmed, the profile values (breaking-capacity kind, disconnection times, RCD
  sensitivity) agreed with the user, cited catalog candidates picked, VERA's `protection_coordination` tool run and
  every unknown or not-evaluated criterion explained. Engine and tool: [electrical model](electrical-model.md), spec
  REQ-DATA-a5673202.
- `motor-drives` 0.1.0, ecosystem `electrical` (pack Electrical power and distribution, group Motor starting and
  drives, default on; activity `design`), Windows x64/Linux x64, no program. Skill `motor-starting`: current network
  and protection results confirmed, the process function and limits agreed with the user, motor and load data
  completed through `electrical_model_change`, cited contactors, relays, softstarters or drives picked, VERA's
  `motor_drives` tool run and the comparison, proposal, assembly and scheme explained; no device configured, no
  safety function claimed. Engine and tool: [electrical model](electrical-model.md), spec REQ-DATA-79118f9a.
- `power-quality-pfc` 0.1.0, ecosystem `electrical` (pack Electrical power and distribution, group Power quality and
  reactive compensation, default on; activity `design`), Windows x64/Linux x64, no program. Skill
  `power-factor-correction`: a current network result confirmed, measurements imported with every convention asked,
  the target and limits agreed with the user, cited capacitors, reactors, contactors and protection picked, VERA's
  `power_quality` tool run and displacement versus total power factor, the bank, overcompensation, equipment and
  resonance explained; no step switched, no regulator set, no filter designed. Engine and tool:
  [electrical model](electrical-model.md), spec REQ-DATA-4dc5e2c7.
- `lighting-design` 0.1.0, ecosystem `electrical` (pack Electrical power and distribution, group Lighting design,
  default on; activity `design`), Windows x64/Linux x64, no program. Skill `lighting-design`: the lighting project
  written with every value asked, IES/LDT files and cited utilisation factors collected, VERA's `lighting_design` tool
  run at the preliminary level and its estimate, direct component and diagnostics explained, then the assisted DIALux
  evo flow (same room and photometry built in DIALux by the engineer, report exported, record mapped and verified); no
  DIALux automation, no proprietary file written. Engine and tool: [electrical model](electrical-model.md), spec
  REQ-DATA-affb2e6b.

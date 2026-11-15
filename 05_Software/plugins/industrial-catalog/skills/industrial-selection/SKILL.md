---
name: industrial-selection
description: Select low-voltage equipment on manufacturer evidence - write firm requirements with their conditions, select from the workbench's industrial catalogs with industrial_catalog, explain eliminations and unknowns, check coordination for the exact products and voltage, and propose the choice with its sources. Use when asked to choose, compare, replace or check a contactor, motor circuit breaker, fuse, overload relay, drive, PLC or I/O module or an accessory.
---

The host tool `industrial_catalog` reads the catalogs in `electrical-automation-catalogs/`; it never looks
anything up live, orders or changes a schematic. Live supplier offers come from `parts_search` (parts-search
plugin) and are commercial information only.

## 1. Write the requirements first

With the user, write each firm requirement with its conditions before selecting:

- a contactor for a 4 kW, 400 V motor: `ratedCurrent >= 9 A` at `utilisationCategory: AC-3`,
  `voltage: 400 V`; coil `controlVoltage == 230 V`;
- a motor circuit breaker at a point with a prospective 20 kA at 400 V: `breakingCapacity >= 20 kA` at
  `voltage: 400 V`, `settingCurrentMin <= 8.5 A`, `settingCurrentMax >= 8.5 A`.

Ask when a value or its condition is missing (the voltage, the utilisation category, the ambient temperature);
never assume a margin, a voltage or a category.

## 2. Select

```text
industrial_catalog {"view": "list"}
industrial_catalog {"view": "select", "catalog": "<id>", "category": "contactor", "requirements": [
  {"id": "ie", "parameter": "ratedCurrent", "op": ">=", "value": {"value": 9, "unit": "A"},
   "conditions": {"utilisationCategory": {"text": "AC-3"}, "voltage": {"value": 400, "unit": "V"}}}]}
```

Report every item with its outcome:

- **eligible** - every requirement passed on confirmed values; quote each value with its conditions and source
  (title, revision, page or table, link).
- **unknown** - name the reason: `absent` (no such value), `conditions` (values exist only under other
  conditions; show them) or `unconfirmed` (an extracted value: ask the user to confirm it in the source before
  it decides). Unknown is never a pass and never zero.
- **eliminated** - name the failing requirement with the value and the limit.

A lower price, more stock or a similar name never makes two items equivalent. An order code is the
manufacturer's; a distributor SKU is the distributor's (`items` with `sku` says it matched a SKU). A
distributor's own parameter text is not evidence. Accessories are separate items: their ratings never count
for the item they mount on.

## 3. Coordination

Ask `industrial_catalog {"view": "coordination", "catalog": "<id>", "items": [...], "conditions": {...}}`
with exactly the products of the combination and the voltage. Use only the `applicable` entries; an entry for
another order code, another voltage or a condition you did not state does not apply - say so and leave the
coordination unknown.

## 4. Propose

Present the choice with the catalog `{id, version}`, the requirements, the eliminations and the unknowns. When
the user accepts, propose the model change (`electrical_model_change`: the device's attributes `manufacturer`
and `orderCode`, a source for the catalog) for approval. Do not edit schematics or drawings and do not order
anything. A plugin result that used the catalog records `catalog: {id, version}`.

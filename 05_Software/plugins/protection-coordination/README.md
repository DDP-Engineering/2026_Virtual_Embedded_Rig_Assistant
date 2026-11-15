# protection-coordination

Fuse and circuit-breaker checks for circuits of VERA's electrical project model, built on a stored network result
and an industrial catalog.

- **The tool `protection_coordination`** is VERA's own write tool, offered while a plugin of the electrical or
  automation ecosystem is loaded (never in read-only sessions). It reads `electrical-automation-model.json`, one
  CURRENT `electrical_network` result (a stale one is refused), one catalog in `electrical-automation-catalogs/`
  and the cable table the network result names, evaluates the candidates you name per circuit and stores a new
  `electrical-automation-results/<run-id>/result.json` after approval, like a file write. It copies the network
  result's inputs, so a later model change marks both results stale. It never changes the model and never
  configures a device or a relay setting.
- **Per candidate**: rated voltage; protected poles (breakers); breaking capacity of the kind the normative
  profile names - Icu, Ics (or the cited Ics ratio x Icu) or Icn for breakers, the rated breaking capacity for fuse
  links - at the circuit voltage against the maximum fault current at the circuit origin; Ib <= In <= Iz (the
  setting for adjustable devices); I2 = the cited conventional ratio x In <= 1.45 Iz; automatic disconnection
  within the required time from cited band points (`tripCurrentMax` at `tripTime`, the instantaneous band
  Im x (1 + tolerance) with its operating time) against the minimum line-to-protective-conductor fault current at
  the end; cited let-through energy against k²S²; and a selection verdict per candidate.
- **Per circuit and pair**: RCD type against the types the fed equipment allows (attribute `rcdTypes`, for
  example a drive's manual asking for type B) and sensitivity against the profile's maximum; selectivity,
  cascading and type 1 / type 2 starter coordination only from the catalog's manufacturer tables for exactly
  those products and conditions. Without such a table the pair is not evaluated; curve overlap is never used.
- **Data rules**: only confirmed catalog values whose conditions cover the circuit count; an extracted,
  absent or off-condition value, a curve without a band, a magnetic trip current without tolerance or operating
  time leave the criterion unknown. Icu, Ics and Icn are never substituted for one another.
- **Skill**: `protection-selection`, the workflow from the network result to a reviewed protection result.

Results are preliminary engineering support: no verified design, no conformity statement and no safety
certification. The exact formats are the specifications REQ-DATA-a5673202, REQ-DATA-42ce122f, REQ-DATA-d7e27def
and REQ-DATA-06c0bd54 in VERA's `.agentic/specs/`.

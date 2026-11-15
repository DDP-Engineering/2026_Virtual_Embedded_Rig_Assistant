# Industrial catalog and documented selection

Industrial catalog and documented selection lets the agent choose low-voltage equipment on manufacturer evidence instead of memory or a distributor's product text. It covers contactors, motor circuit breakers, protection, drives, PLC and I/O modules and accessories. Catalogs are files in the workbench that keep the manufacturer order code, the variant and the accessories apart from distributor SKUs, with every parameter cited by source, revision and page or table under its conditions. The agent selects on your firm requirements, explains each elimination and states sources, units and limits. It runs offline and touches no hardware.

## What it needs

- No programs and nothing to install: the plugin has none. The agent uses VERA's built-in `industrial_catalog` tool, which is offered only while the plugin is enabled.
- A catalog in `electrical-automation-catalogs/` in the workbench. You or the agent can write or import one with an ordinary approved file write; a broken file is listed without stopping the others.
- Your requirements with their conditions: the voltage, the utilisation category, the ambient temperature. The agent asks for a missing one instead of assuming a margin.
- No required plugins, hardware or configuration.

## How to use it

- "Which contactors in the catalog suit a 4 kW, 400 V motor at AC-3 with a 230 V coil?" (skill `industrial-selection`)
- "Find the item with order code LC1D09P7 and tell me whether the number I have is an order code or a distributor SKU."
- "Which motor circuit breakers handle 20 kA at 400 V and can be set to 8.5 A?"
- "Why was this item eliminated, and which values are still unknown?"
- "Is the fuse coordination for these two exact products valid at 400 V?"
- "Propose this contactor for the model as manufacturer and order code, with the catalog as its source."

Every outcome is eligible, unknown or eliminated, and each value is quoted with its conditions and source. A lower price, more stock or a similar name never makes two items equivalent. The agent never writes into the catalog on its own.

## Risk and approvals

The `industrial_catalog` tool only reads files: it asks for no approval, looks nothing up live and stores nothing. Writing a catalog, or a model change that records your choice (`electrical_model_change`), asks for approval like any file write. Nothing is scraped, ordered or replaced in a schematic, and there are no device-read, device-write or irreversible commands.

## Limits

- Windows x64 and Linux x64. Verified on Windows x64 and WSL2; not yet run on native Ubuntu x64.
- Missing or unconfirmed values stay unknown and never pass. A value marked extracted is not checked against its source and never decides a requirement.
- Coordination tables apply only to the exact products, voltage and conditions they name; otherwise the coordination stays unknown.
- No whole vendor catalogs and no IEC tables are shipped. The included fixture is small and cited, a few contactors and motor circuit breakers typed from public product pages, and licensed manufacturer coordination tables are not in it. Type only values you may use and record each source's licence terms.
- Live prices and stock come from the parts-search plugin and are commercial information only. A selection is a proposal, not a design approval.

# Parts search and component selection

This plugin helps the agent choose electronic components on evidence. The agent searches the supplier catalogs you enable (Mouser, DigiKey, TME, Farnell, Rutronik), confirms critical values in the manufacturer's datasheet with page and test conditions, and compares the candidates against hard constraints first and preferences second. It writes a comparison and a proposed BOM to a new folder under `electronics-results/`. Nothing is ordered, and no schematic or project BOM is changed.

## What it needs

- **parts-compare**, a Python script in the plugin, which VERA installs itself with **Install dependencies**. It compares offline.
- **Supplier credentials** (`supplier-keys`): the API credential of each supplier you want to search, with the region the searches use. Set them in the plugin page's **Configuration** section: Mouser (API key), DigiKey (client ID and client secret), TME (API token and application secret), Farnell (API key and store) and Rutronik (API key from your Rutronik contact). Credentials stay on your computer and are never shown to the agent.
- **Web access** turned on in **Settings**, and the plugin enabled for the workbench. The search is offered only when both are on and at least one supplier is enabled.
- No hardware and no other plugins.

## How to use it

The agent uses the `component-selection` skill for the workflow and `component-families` for the checks of each part family (MOSFETs, regulators, op-amps, resistors, capacitors, diodes, inductors). It agrees the hard constraints and preferences with you before it searches.

- "Find an N-channel MOSFET in SOT-23 that switches 5 A from 24 V with a 3.3 V gate drive."
- "Look up BSS806NE at the enabled suppliers and show the offers."
- "Compare these three LDOs for 3.3 V at 300 mA from 5 V, cheapest first, for 500 pieces in EUR."
- "Is this MLCC still 10 µF at 12 V DC bias? Check the datasheet."
- "Propose a drop-in replacement for the regulator on the board."

## Risk and approvals

Comparing candidates is rated **Safe**: it runs offline on your computer, opens no network connection, never overwrites and runs without asking. A supplier search sends only the search text or part number to the suppliers you enabled.

## Limits

- Windows x64 and Linux x64.
- Every search is live and VERA stores no supplier result. Offers are a snapshot without taxes or shipping.
- Supplier parameters are unconfirmed until checked in the datasheet. Values on curves or scanned pages must be confirmed by you.
- TME data: powered by TME.eu Data; no guarantee of data accuracy.

# PLG-01...PLG-08 (#262...#269) Plugin management - maturity, plugin page, dependencies, configuration and delivery

PURPOSE: the order and state of the eight packages that make each plugin's maturity, needs, parts,
parameters, operations and state visible on its own entry in the Plugins page, and make the plugin
catalog deliverable as a signed release.
SPEC: Gitea epic [#261](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/261) and its children #262...#269 hold the specification of each work
package (deliverables, Done criteria PLG-0x-A...E); the local copies are
`F:\ProjectsDDP\VERA_Plugin_Management_Plan.md` and `F:\ProjectsDDP\VERA_Plugin_Management_Tickets\`.
This page records only order, state and what was built, so the two never diverge. Where a ticket is
wrong about the code, the code decides.
IDS: the IDs PLG-01...PLG-18 were already used by the first plugin epic (#57...#74). In this initiative an ID
always travels with its issue number: "PLG-01 #262" is this plan, "PLG-01 #57" is the plugin store.
PROCESS: at the user's request (2026-11-14) every child is implemented with AEGIS, in order, on one
branch `feature/261-plugin-management` cut from `master` at 920457e, in the sibling worktree
`F:\2026_Virtual_Embedded_Rig_Assistant_plg`. The implementer hands the candidate back without a commit;
the coordinator checks the evidence and makes one local commit per ticket. Nothing is pushed. Each ticket
runs only its focused tests; the complete suite runs once after PLG-08.
STATE: planned; nothing implemented yet.

## Order

| Order | Package | Issue | Result | State |
|---|---|---|---|---|
| 1 | PLG-01 | [#262](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/262) | Pre-release badge and filter derived from semver; official plugins set to their evidence-based version | planned |
| 2 | PLG-02 | [#263](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/263) | manifest `summary`; pre-install card with name, version, type, summary, platform and risk warnings | planned |
| 3 | PLG-03 | [#264](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/264) | composition (programs, scripts, skills, profiles, documents) and operations by risk on the plugin page | planned |
| 4 | PLG-04 | [#265](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/265) | dependency summary in the catalog index; install with dependencies (required plugins too); re-install | planned |
| 5 | PLG-05 | [#266](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/266) | manifest `settings`; Parts search, MQTT and Wokwi move from App settings to their plugins; configured state | planned |
| 6 | PLG-06 | [#267](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/267) | one status block (dependencies, configuration, use) and pack install from the catalog | planned |
| 7 | PLG-07 | [#268](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/268) | catalog release from `07_Delivery/plugins/`, signed index, stable and pre-release channels | planned |
| 8 | PLG-08 | [#269](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/269) | offline kit per platform of pinned pip and download dependencies | planned |

Each package builds on the page parts of the previous one. PLG-07 and PLG-08 touch delivery only.

## Shared rules

- Pre-release rule: no compatibility, migration or format bump; manifests stay `format: 1`; changed fields
  are edited in place in all official plugins. A lowered version meets the catalog's downgrade refusal;
  test machines uninstall and reinstall.
- One source per fact: maturity from the version, operations from `rules`, skills from `SKILL.md`,
  dependencies from `programs` and `requires`, parameters from the new `settings` block.
- Secrets stay in the CredentialStore and reach programs only through the existing stdin hand-off; the page
  shows stored or missing, never the value.
- Automatic install only for pip, script and download programs and for required plugins; `find` programs
  (vendor tools) get detection, the vendor guide and Check again. VERA never installs a vendor program.
- Every new UI text in en/ro/de; Windows x64 and native Ubuntu x64 (WSL2 stands in where no native Ubuntu
  host exists, recorded as such).

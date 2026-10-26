# Verification fixtures

These fictional inputs support tests, retrieval evaluation and package smoke checks.
They are not application resources and are not included in installers.

`workbenches/demo-board/` is the fictional VERA-DEMO-01 verification project, including
PDF/Markdown documents, notes, pinout, boot log and replay input. Tests copy it
into isolated workspaces before opening or modifying it.
`workbenches/demo-board.json` records its identity and the complete fixture file inventory.

`npm run make:demo-pdfs`, run from `05_Software`, regenerates the three fixture PDFs
from `workbenches/demo-board/sources/`.

The remaining folders contain document extraction samples, replay scripts,
translation checker cases, retrieval questions/model manifests and settings/upgrade
fixtures. Existing user workbenches and profiles are never part of this directory.

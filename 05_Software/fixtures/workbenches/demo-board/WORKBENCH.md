# VERA-DEMO-01

## Device under test
Fictional VERA-DEMO-01 board, STM32-style MCU, revision A. All measurements and pin mappings are demonstration data.

## Bench setup
3.3 V current-limited supply. SWD programmer connects to PA13/PA14. I2C pull-ups connect SDA and SCL to 3.3 V.

## Conventions
Bring-up notes live in docs/notes. Boot captures live in logs. Pin mappings are listed in docs/pinout.csv.

## Known issues
Revision A sometimes delays I2C initialization. Check the boot log before changing pull-up values.

## Learning exercises
GETTING-STARTED.md describes the three example prompts. Use datasheet-reader for electrical limits,
log-analyst for boot evidence and bringup-checklist for a cited plan. Generated PDFs in docs/ have
matching English Markdown in sources/ for use while indexing finishes. The boot capture reports a
20 ms I2C delay followed by ready; sensor ID and LED acceptance still need evidence.

---
name: circuitpython-libraries
description: How to choose, prepare and check CircuitPython libraries that match a board's firmware with circuitpython-tool, from a pinned Adafruit bundle tag. Use whenever a task needs a CircuitPython library (a sensor driver, NeoPixel, displayio helpers) on a board or checks the libraries already in its /lib.
---
# circuitpython-libraries

Libraries come from the Adafruit CircuitPython Bundle. Each firmware major version needs its own compiled files
(`9.x-mpy` for CircuitPython 9): a `.mpy` built for another version fails to import. circuitpython-tool never updates
all libraries and never picks "the latest" bundle: you name the tag.

## Check what the board has

`circuitpython-tool inspect-libraries --volume E: --identity ...` lists each module in /lib with its version and
`abi`: `compatible`, `incompatible` (a .mpy that is not CircuitPython 9+ bytecode, warned `mpy-incompatible`) or
`source` (.py). Replace incompatible modules with a prepared set; do not copy .mpy files from another source.

## Prepare a set (network)

`circuitpython-tool prepare-libraries --library adafruit_bme280 --library neopixel --circuitpython 9 --bundle-tag 20261110`

- Take `--circuitpython` from `identify` (`firmware.major`). Ask the user which bundle tag to pin when the workbench
  does not already use one; tags are the dates of the bundle releases on github.com/adafruit/Adafruit_CircuitPython_Bundle.
- This is the only operation that downloads: the zips of that tag are fetched once, cached with their SHA-256 in
  `~/.vera-circuitpython` and verified later (`cache-changed` if a cached file was altered).
- Dependencies from the bundle's requirements are added (`requiredBy` names who needs them); host-only packages
  (Blinka, typing helpers) are skipped, and `dependency-not-in-bundle` warnings name packages the bundle lacks. `unknown-library` means the name is not in
  the bundle: check its spelling (`adafruit_bme280`, not `Adafruit-BME280`).
- `mpy-incompatible` means the bundle held a file that is not CircuitPython 9+ bytecode: nothing was written.
- The set lands in `<run>/libraries/` with `library-set.json`; deploy it with `deploy --libraries <run>/library-set.json`
  (offline). A set prepared for another major version is refused (`incompatible-libraries`), and one changed since
  it was prepared is refused (`library-set-changed`).

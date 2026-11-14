# arduino-cli fixtures

Data for `tests/integration/arduino-cli.test.ts`; the fake arduino-cli lives in `tests/support/fake-arduino-cli.py`.

| Fixture | Purpose |
|---|---|
| `sketches/VeraBlink` | Core-only sketch; prints `VERA-FIXTURE arduino-cli blink 1.0.0` at 115200 baud at boot and every second (the serial readback of an upload test looks for it). Its `sketch.yaml` carries IDE defaults and a profile that arduino-tool must ignore. |
| `sketches/VeraLibrary` | Uses `SPI` (library of the core) and `VeraCounter` (local, `--library-dir libraries/VeraCounter`); two sketch files. |
| `libraries/VeraCounter` | Local library in the 1.5 layout. |
| `sketches/VeraBroken` | Compile error: `undeclaredThing` at line 2, column 3. |
| `sketches/VeraMissingLib` | Includes a header no library provides (line 1). |
| `sketches/Misnamed` | Main file not named after the folder: not a sketch. |

Real-tool tests compile these with arduino-cli 1.6.0 and the cores `arduino:avr` 1.8.8 and `arduino:samd` 1.8.14
when `VERA_TEST_ARDUINO_CLI` names arduino-cli and `VERA_ARDUINO_HOME` an environment holding both cores.

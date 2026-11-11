# STM32CubeProgrammer

Enable **Programming (STM32CubeProgrammer)** in the STM32 pack. VERA uses the
user's STM32CubeProgrammer and never downloads it: ST requires an account for
the download. On Windows it looks on PATH, in
`%ProgramFiles%\STMicroelectronics\STM32Cube\STM32CubeProgrammer\bin` and in a
`C:\ST\STM32CubeCLT*` or `C:\ST\STM32CubeIDE_*` installation; on Linux in
`~/STMicroelectronics/STM32Cube/STM32CubeProgrammer/bin`,
`/usr/local/STMicroelectronics/...`, `/opt/st/stm32cubeclt*` and the
STM32CubeIDE folders under `/opt/st` or `~/st`. The program is
`stm32_programmer_cli`: VERA program names are lower case, which Windows matches
regardless of case. On Linux PATH finds only a lower-case `stm32_programmer_cli`
link; for a custom install create one, for example
`ln -s /path/to/bin/STM32_Programmer_CLI ~/.local/bin/stm32_programmer_cli`.
The installer adds the ST-LINK drivers on Windows; Linux needs ST's udev rules
(a user step).

| Commands | Risk |
|---|---|
| `-h`, `--version`, `-q`, `-log`, `-vb`, `-y`, modifiers, `-fchecksum`, `-sl`, `-ms`, `-l st-link-only` | safe |
| `-c`, `-l`, reads (`-r`, `-r32`...), `-checksum`, `-v`, `-blankcheck`, resets, halt/run/step, `-ob displ`, `-otp displ`, `-psrss displ`, other displays | device-read |
| `-w`/`-d`, `-w32`/`-w16`/`-w8`, `-e`, `-fillmemory`, `-g`, core-register writes, wireless-stack start/delete | device-write |
| `-ob` with anything but `displ` (above all `RDP=0xCC`), `-rdu`, `-tzenreg`, RDP lock/unlock, OTP writes, keys, SFI/SSFI/SSP, IP modules, `-fwupgrade`, `-antirollback`, `-dsecurity`, `-setdefaultob`, `-psrss`/`-obrss` changes, `-pmic`, debug authentication (`debugauth=` other than 2; typed word `debugauth`), HSM licenses, `-pwr` | irreversible (typed command) |
| `-script` | blocked |
| an unknown command, or a spelling the help does not list | device-write, plus every command it could mean |

The rules read the command line as the CLI does: several commands per line
run in order and all of them count, names are case-insensitive (`-OB`,
`--OPTIONBYTES`) without abbreviations, and numeric arguments may start with
`-`. The CLI also accepts extra leading dashes (`--rdu`) and trims spaces, and
some odd spellings reach other commands, so any dash word the help does not
spell exactly is treated as unknown together with every command its name or
parts could mean (`--rdu` stays irreversible, `-x-script` stays blocked).
Measured on STM32CubeProgrammer 2.23.0; its recorded help is
`tests/fixtures/stm32/STM32_Programmer_CLI-2.23.0-help.txt`, and a test checks
that every command it lists is classified.

## Limits

`-w` is device-write as the ticket defines it, but a hex, srec or ELF image can
carry option-byte or OTP segments that `-w` programs too: check an image's
segments before flashing it. No test has connected to a board or changed option
bytes; the default tests run `--version`, `-l st-link-only`, `-fchecksum` and a
connection to a probe serial number that does not exist. Commands added by later
CubeProgrammer releases count as unknown (device-write) until the rules list
them. Host files written by `-r`/`-u`, `-log`, `-regdump`, `-swv`, `-gc`, `-sl`
or `-ms` (which edits an ELF in place) need no separate approval. OpenOCD is a
later candidate in this ecosystem.

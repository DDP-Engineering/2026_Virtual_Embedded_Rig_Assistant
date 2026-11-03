# REQ-FUNC-42818bb7 — serial-monitor script command line

## Behavior

`05_Software/plugins/serial-monitor/scripts/serial_monitor.py` is a PEP 723 script on pyserial 3.5. The
plugin declares it as program `serial` (`install: { script: scripts/serial_monitor.py }`), so VERA runs it
as `uv run --quiet --offline --script <installed plugin>/scripts/serial_monitor.py <arguments>`. Standard
input is closed by the runner; the script never reads it.

| Command | Risk (plugin rules) | Does |
|---|---|---|
| `--version`, `--help`, `-h` | safe | prints `serial-monitor <plugin version>`, or the usage |
| `list` | safe | prints the ports as JSON; never opens a port |
| `capture` | device-read | reads a console; `--reset` restarts the board first |
| `send` | device-write | writes one line, then reads the reply like `capture` |

Options are parsed by argparse with `allow_abbrev=False`; any other command or option is a usage error.

### list

Prints one JSON array (two-space indent) of the ports `serial.tools.list_ports.comports()` reports, in
the order of the port name. Each element:

| Field | Value |
|---|---|
| `port` | the device name: `COM7`, `/dev/ttyACM0` |
| `vid_pid` | `VVVV:PPPP`, four upper-case hex digits each, or `null` when the port has no USB IDs |
| `serial_number` | pyserial's `serial_number`, or `null` |
| `family` | from the family table, or `null` |
| `description` | pyserial's `description`, or `null` when empty or `n/a` |
| `by_id` | on Linux, the path of the `/dev/serial/by-id/*` link whose target is `port`; else `null` |

Family table:

| VID | PID | family |
|---|---|---|
| `303A` | any | `Espressif native USB` |
| `10C4` | `EA60` | `Silicon Labs CP210x` |
| `1A86` | `7523` | `WCH CH340` |
| `1A86` | `55D4` | `WCH CH343` |
| `0403` | `6001` | `FTDI FT232R` |
| `0403` | `6010` | `FTDI FT2232H (ESP-Prog)` |
| `0403` | `6014` | `FTDI FT232H` |

`by_id`: when `/dev/serial/by-id` is a folder, each entry's `os.path.realpath` is compared with the
`os.path.realpath` of the port's device; the first entry in name order that matches is reported as
`/dev/serial/by-id/<entry>`. An unreadable folder gives no links; entries that resolve to no listed
port are ignored.

### capture

`capture --port PORT [--baud 115200] [--duration 10] [--until REGEX] [--max-bytes 1048576] [--reset]`

1. Opens `PORT` at `--baud`, 8N1, with a 0.1 s read timeout and on POSIX `exclusive=True`, with DTR
   asserted and RTS released (set before opening), then releases DTR. The lines therefore never pass
   through DTR released with RTS asserted, the state that holds an ESP32 in reset: Linux raises both
   lines when a port opens and pyserial then applies DTR before RTS. Without `--reset` the board keeps
   running; DTR alone only pulls IO0 low for a moment.
2. With `--reset`: DTR released, RTS asserted, DTR applied again, 200 ms, input buffer cleared (the
   old firmware's output, while the chip is still held in reset), RTS released, DTR applied again.
   Applying DTR again after an RTS change makes Windows usbser.sys send the new line state. On
   ESP32 boards with the auto-reset circuit this pulses EN with IO0 high: the chip restarts into its
   application; the new boot output is never cleared.
3. Reads until the first stop condition, writing every byte to standard output as soon as it is read
   (flushed):
   - `duration`: `--duration` seconds since the port was opened and reset;
   - `until`: `--until` (Python `re`, searched with `re.search`) matches a line. Bytes are decoded as
     UTF-8 with replacement characters; each complete line (split at `\n`) and the current partial
     line are searched after every read, without a trailing `\r`, so `$` anchors at the line end. The
     partial line keeps at most its last 4096 characters, so a match longer than that inside one very
     long line can be missed;
   - `max-bytes`: `--max-bytes` bytes were written; the last read is bounded so exactly that many bytes
     are written.
4. Closes the port and prints to standard error one line:
   `[serial-monitor] <port>: <n> bytes, stopped by <duration|until|max-bytes>`.

### send

`send --port PORT --text TEXT [--eol crlf|lf|cr|none] [--baud 115200] [--duration 1] [--until REGEX]
[--max-bytes 1048576]`

Opens the port like `capture` (never resets), writes `TEXT` encoded as UTF-8 followed by the line ending
(`crlf` default: `\r\n`; `lf`; `cr`; `none`), flushes, then reads the reply with the capture loop and
prints the same summary line. VERA refuses arguments containing NUL, CR or LF before any rule, so `TEXT`
is always one line.

## Exit codes

| Code | When |
|---|---|
| 0 | `--version`, `--help`, `-h`, `list`, or a capture/send that stopped by duration, until or max-bytes, except below |
| 2 | usage error (argparse): unknown command or option, missing `--port`, `--duration` not a finite number > 0, `--max-bytes` or `--baud` not an integer > 0, `--until` that does not compile; no port is opened |
| 3 | the port could not be opened, or failed while reading or writing: any exception from pyserial (`SerialException`; on Linux also `OSError` or `termios.error`; `ValueError` for an unsupported setting); the bytes already read stay on standard output |
| 4 | `--until` was given and no line matched before the capture stopped |

## Errors

On exit 3 the script prints to standard error `serial-monitor: <error message>` and then:

- when the error's `errno` is `EACCES` (13; pyserial sets it on POSIX):
  ```
  Permission denied. Add your user to the group that owns serial ports, then log out and in again:
    Debian, Ubuntu, Fedora: sudo usermod -aG dialout $USER
    Arch: sudo usermod -aG uucp $USER
  ```
- otherwise: `List the ports again with: serial list. A port that another program or a background
  capture holds cannot be opened; close it or stop that run.`

## Examples

```
$ serial list                                               (abridged: the real output puts each field on its own line)
[
  {"port": "COM4", "vid_pid": "10C4:EA60", "serial_number": "0001", "family": "Silicon Labs CP210x", "description": "CP2102 USB to UART", "by_id": null},
  {"port": "COM7", "vid_pid": "303A:1001", "serial_number": "F4:12:FA:00:11:22", "family": "Espressif native USB", "description": "USB JTAG/serial debug unit", "by_id": null}
]
$ serial capture --port COM7 --reset --until "main_task: Calling app_main" --duration 10
ESP-ROM:esp32s3-20210327
...
I (312) main_task: Calling app_main()
[serial-monitor] COM7: 1830 bytes, stopped by until        (stderr; exit 0)
$ serial capture --port /dev/ttyUSB0
serial-monitor: [Errno 13] could not open port /dev/ttyUSB0: [Errno 13] Permission denied: '/dev/ttyUSB0'
Permission denied. Add your user to ...                     (stderr; exit 3)
```

## Acceptance

The integration tests in `05_Software/tests/integration/serial-monitor.test.ts` run the installed script
under the toolchain's Python with a fake `serial` package and observe standard output, standard error,
the exit code and the fake's recorded port operations.

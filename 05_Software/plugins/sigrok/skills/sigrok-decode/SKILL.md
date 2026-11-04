---
name: sigrok-decode
description: Decode saved srzip captures with sigrok UART, I2C, SPI, CAN, 1-Wire or the DDP Ethernet decoder stack.
---

Use `sigrok-cli -i <workbench-file.sr> --show` to inspect the file. Use
`-P <decoder> --show` to discover the decoder's channels, options and
annotation classes. Select the actual channels and protocol settings from
the capture and the target configuration. These example channel names and
UART baud rate must be replaced as appropriate:

```text
sigrok-cli -i captures/logic.sr -P uart:rx=D0:baudrate=115200 -A uart=rx-data
sigrok-cli -i captures/logic.sr -P i2c:scl=D1:sda=D2 -A i2c=address-write:data-write
```

Use a comma-separated decoder chain for stacked protocols. Inspect `-L`
for the installed decoders before relying on the DDP networking chain
(`ethernet`, `arp`, `ipv4`, `udp` and related decoders). An upstream
installation can have fewer decoders. If the list is truncated, use
`-P <decoder> --show` or check the full log in Runs. For long traces narrow the annotation
classes or inspect the saved run log. Summarize decoded frames and errors,
state uncertain channel mappings or timing, and cite the source capture.
Keep offline runs to file input and decoder options.

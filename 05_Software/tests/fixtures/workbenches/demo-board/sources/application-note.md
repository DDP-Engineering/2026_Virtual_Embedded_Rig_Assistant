# VERA-DEMO-01 Application Note: First Power-Up

Revision A. This bring-up procedure describes the fictional VERA-DEMO-01 board.

## Power sequence

1. Disconnect external loads. Check resistance between 3V3 and GND before applying power.
2. Set the lab supply to 3.3 V with a 150 mA current limit.
3. Hold RESET low for 10 ms after the supply is stable, then release it.
4. Verify the UART boot line reports VERA-DEMO-01 rev=A clk=16000000.

## Sensor check

Check that PB6 and PB7 idle near 3.3 V with their 4.7 kohm pull-ups. Configure I2C1_TIMINGR before setting I2C1_CR1 PE. Read sensor ID at address 0x48 register 0x00. Expected value is 0xA1.

<!-- page -->

## Troubleshooting

If the sensor NACKs, check the shifted SADD value 0x90, external pull-ups and wiring. If BUSY stays set, inspect SDA for a low level and remove the external sensor before retrying. Capture UART output in logs/boot-0412.log and record the measured supply voltage in docs/notes/bringup.md.

## Acceptance

Acceptance requires a 3.30 V measured supply, the revision A boot line, sensor ID 0xA1 and a status LED toggle on PA5 every 500 ms. Enable the watchdog only after these checks pass. Demo facts are intended for retrieval tests, not for controlling physical hardware.

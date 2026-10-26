# VERA-DEMO-01 Datasheet

Revision A. This is a fictional board and all specifications are demo data for VERA.

## Supply and reset

The board operates from a regulated 3.3 V supply (3.15 V to 3.45 V). Typical idle current is 18 mA. Maximum demo load current is 120 mA. Keep RESET low for at least 10 ms after the supply stabilizes.

## Pin assignment

PB6 is I2C1 SCL and PB7 is I2C1 SDA. Both require external 4.7 kohm pull-ups to 3.3 V. PA5 drives the status LED through a 330 ohm resistor. UART debug uses PA9 TX and PA10 RX at 115200 baud, 8 data bits, no parity, 1 stop bit.

<!-- page -->

## I2C electrical timing

Standard mode runs at 100 kHz and fast mode at 400 kHz. The demo bus capacitance must stay below 100 pF. The external sensor uses seven-bit address 0x48. Its ID register at 0x00 returns 0xA1 on revision A.

## Clock and temperature

The internal oscillator starts at 16 MHz. The default peripheral clock is 16 MHz. The fictional operating temperature range is 0 to 70 degrees C. Clock accuracy and temperature limits are illustrative, not hardware guarantees.

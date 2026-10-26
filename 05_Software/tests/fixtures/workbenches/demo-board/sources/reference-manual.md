# VERA-DEMO-01 Reference Manual Excerpt

Revision A. Fictional register names and values are used for deterministic VERA document exercises.

## I2C1 registers

I2C1 base address is 0x40005400. I2C1_CR1 at offset 0x00 contains PE in bit 0, TXIE in bit 1, RXIE in bit 2 and ERRIE in bit 7. Set PE only after programming I2C1_TIMINGR. Clear PE before changing the timing register.

I2C1_TIMINGR at offset 0x10 configures the bus clock. At a 16 MHz peripheral clock use the fictional value 0x00303D5B for 100 kHz or 0x0010061A for 400 kHz. These values are demo facts and do not configure a real MCU.

<!-- page -->

## Transfer and error handling

I2C1_CR2 at offset 0x04 carries the seven-bit slave address in SADD bits 1 through 7, RD_WRN in bit 10 and START in bit 13. The sensor at 0x48 is addressed with SADD 0x90. A one-byte read of ID register 0x00 should return 0xA1.

I2C1_ISR at offset 0x18 reports TXIS bit 1, RXNE bit 2, NACKF bit 4 and BUSY bit 15. A NACKF indicates an absent sensor, incorrect address or missing pull-ups. Clear the NACK condition before retrying. Investigate stuck BUSY by checking the SDA and SCL levels.

## Watchdog

WDG_KR at 0x40003000 accepts 0xAAAA to refresh the watchdog. The demo timeout is 1000 ms. Keep the watchdog disabled during initial electrical checks, then enable it and refresh at least every 500 ms.

/* Fixture firmware for gdb-debug (LAB-04): a counter, a sensor struct and a division by a zero divisor that traps
 * (CCR.DIV_0_TRP) on ARMv7-M. VARIANT changes the code so a rebuilt ELF no longer matches. */
#include <stdint.h>

#ifndef VARIANT
#define VARIANT 1
#endif

volatile uint32_t counter;
volatile int32_t divisor;
struct sensor {
    uint16_t raw;
    int16_t celsius;
} sensor_state;
uint8_t buffer[16];
uint32_t big_table[160];

static void delay(volatile uint32_t ticks) {
    while (ticks--) {
    }
}

__attribute__((noinline)) int32_t compute_ratio(int32_t value) { return value / divisor + VARIANT; }

__attribute__((noinline)) void sample(void) {
    sensor_state.raw = (uint16_t)counter;
    sensor_state.celsius = (int16_t)compute_ratio((int32_t)counter);
}

int main(void) {
    *(volatile uint32_t *)0xE000ED14 |= (1u << 4); /* SCB->CCR.DIV_0_TRP */
    for (;;) {
        counter++;
        buffer[counter & 15u] = (uint8_t)counter;
        big_table[counter % 160u] = counter;
        sample();
        delay(1000u * VARIANT);
    }
}

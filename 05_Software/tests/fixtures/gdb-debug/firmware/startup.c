/* Minimal Cortex-M startup for the gdb-debug fixture firmware (LAB-04). Not run on a board by the tests. */
#include <stdint.h>

extern uint32_t _sidata, _sdata, _edata, _sbss, _ebss, _estack;
extern int main(void);

void Reset_Handler(void) {
    uint32_t *source = &_sidata;
    for (uint32_t *target = &_sdata; target < &_edata;) *target++ = *source++;
    for (uint32_t *target = &_sbss; target < &_ebss;) *target++ = 0;
    main();
    for (;;) {
    }
}

void Default_Handler(void) {
    for (;;) {
    }
}

void HardFault_Handler(void) {
    for (;;) {
    }
}

__attribute__((section(".isr_vector"), used)) void (*const vectors[16])(void) = {
    (void (*)(void))&_estack, Reset_Handler,   Default_Handler, HardFault_Handler,
    Default_Handler,          Default_Handler, Default_Handler, 0,
    0,                        0,               0,               Default_Handler,
    Default_Handler,          0,               Default_Handler, Default_Handler,
};

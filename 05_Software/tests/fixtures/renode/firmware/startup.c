/* Minimal Cortex-M4 startup of the renode fixture firmware (LAB-06): vector table with TIM2 (IRQ 28). */
#include <stdint.h>

extern uint32_t _sidata, _sdata, _edata, _sbss, _ebss, _estack;
extern int main(void);
extern void TIM2_IRQHandler(void);

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

#define D Default_Handler
__attribute__((section(".isr_vector"), used)) void (*const vectors[16 + 29])(void) = {
    (void (*)(void))&_estack, Reset_Handler, D, D, D, D, D, 0, 0, 0, 0, D, D, 0, D, D,
    D, D, D, D, D, D, D, D, D, D, D, D, D, D, D, D, D, D, D, D, D, D, D, D, D, D, D, D,
    TIM2_IRQHandler,
};

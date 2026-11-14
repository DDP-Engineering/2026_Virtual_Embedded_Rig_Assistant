/* Fixture firmware for gdb-debug on ARMv6-M (LAB-04): a call through an invalid function pointer hard-faults. */
#include <stdint.h>

volatile uint32_t counter;

__attribute__((noinline)) void jump_to_nowhere(void) {
    void (*target)(void) = (void (*)(void))0xFFFFFFF0u;
    target();
}

int main(void) {
    for (;;) {
        if (++counter == 10u) jump_to_nowhere();
    }
}

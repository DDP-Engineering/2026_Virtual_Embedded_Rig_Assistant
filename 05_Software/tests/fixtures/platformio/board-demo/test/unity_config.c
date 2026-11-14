/* Unity output of the platformio fixture (LAB-08): USART2 on the STM32F4 (the Renode model's console), stdout on the host. */
#include "unity_config.h"

#if defined(__arm__)
#include <stdint.h>
#define REG(address) (*(volatile uint32_t *)(address))
#define RCC_APB1ENR REG(0x40023840u)
#define USART2_SR REG(0x40004400u)
#define USART2_DR REG(0x40004404u)
#define USART2_BRR REG(0x40004408u)
#define USART2_CR1 REG(0x4000440Cu)

void unityOutputStart(unsigned long baudrate) {
    (void)baudrate;
    RCC_APB1ENR |= 1u << 17;
    USART2_BRR = 0x8Bu;
    USART2_CR1 = (1u << 13) | (1u << 3);
}
void unityOutputChar(unsigned int c) {
    while (!(USART2_SR & (1u << 7))) {
    }
    USART2_DR = (uint32_t)(c & 0xFFu);
}
void unityOutputFlush(void) {}
void unityOutputComplete(void) {}
#else
#include <stdio.h>
void unityOutputStart(unsigned long baudrate) { (void)baudrate; }
void unityOutputChar(unsigned int c) { putchar((int)c); }
void unityOutputFlush(void) { fflush(stdout); }
void unityOutputComplete(void) {}
#endif

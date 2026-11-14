/*
 * Fixture firmware of the renode plugin tests (LAB-06), for the STM32F4 Discovery model of Renode 1.17.0
 * (platforms/boards/stm32f4_discovery.repl). Never meant for a real board.
 *
 * Default build: prints a banner and its version on USART2, enables TIM2 (the model counts at a fixed 10 MHz, so
 * PSC 999 and ARR 999 give an update every 100 ms of virtual time) and prints "TICK <n>" for every update, mirrors
 * the user button (PA0) on the user LED (PD12) with a "BUTTON <0|1>" line, and answers each received line with
 * "ECHO <line>".
 * VARIANT 2: prints version 9.9.9 (an assertion failure for a test that expects 1.2.3).
 * VARIANT 3: prints nothing at all (a timeout).
 * VARIANT 4: also writes the DAC control register (0x40007400), which the stm32f4 model does not implement.
 */
#include <stdint.h>

#define REG(address) (*(volatile uint32_t *)(address))
#define RCC_AHB1ENR REG(0x40023830u)
#define RCC_APB1ENR REG(0x40023840u)
#define USART2_SR REG(0x40004400u)
#define USART2_DR REG(0x40004404u)
#define USART2_BRR REG(0x40004408u)
#define USART2_CR1 REG(0x4000440Cu)
#define GPIOA_IDR REG(0x40020010u)
#define GPIOD_MODER REG(0x40020C00u)
#define GPIOD_ODR REG(0x40020C14u)
#define TIM2_CR1 REG(0x40000000u)
#define TIM2_DIER REG(0x4000000Cu)
#define TIM2_SR REG(0x40000010u)
#define TIM2_EGR REG(0x40000014u)
#define TIM2_PSC REG(0x40000028u)
#define TIM2_ARR REG(0x4000002Cu)
#define NVIC_ISER0 REG(0xE000E100u)
#define DAC_CR REG(0x40007400u)

#ifndef VARIANT
#define VARIANT 1
#endif

static volatile uint32_t ticks;

void TIM2_IRQHandler(void) {
    if (TIM2_SR & 1u) {
        TIM2_SR = ~1u;
        ticks++;
    }
}

static void put_char(char c) {
    while (!(USART2_SR & (1u << 7))) {
    }
    USART2_DR = (uint32_t)(uint8_t)c;
}

static void put_text(const char *text) {
    while (*text) put_char(*text++);
}

static void put_line(const char *text) {
    put_text(text);
    put_char('\r');
    put_char('\n');
}

static void put_number(uint32_t value) {
    char digits[11];
    int count = 0;
    do {
        digits[count++] = (char)('0' + value % 10u);
        value /= 10u;
    } while (value && count < 10);
    while (count) put_char(digits[--count]);
}

int main(void) {
    RCC_AHB1ENR |= (1u << 0) | (1u << 3);
    RCC_APB1ENR |= (1u << 0) | (1u << 17) | (1u << 29);
    USART2_BRR = 0x8Bu;
    USART2_CR1 = (1u << 13) | (1u << 3) | (1u << 2);
    GPIOD_MODER = (GPIOD_MODER & ~(3u << 24)) | (1u << 24);
#if VARIANT == 3
    for (;;) {
    }
#else
    put_line("VERA-FW renode-demo");
#if VARIANT == 2
    put_line("version 9.9.9");
#else
    put_line("version 1.2.3");
#endif
#if VARIANT == 4
    DAC_CR = 1u;
    put_line("dac on");
#endif
    TIM2_PSC = 999u;
    TIM2_ARR = 999u;
    TIM2_EGR = 1u;
    TIM2_SR = 0u;
    TIM2_DIER = 1u;
    NVIC_ISER0 = 1u << 28;
    TIM2_CR1 = 1u;
    uint32_t shown = 0;
    uint32_t button = 0;
    char line[33];
    uint32_t length = 0;
    for (;;) {
        uint32_t now = ticks;
        if (now != shown) {
            shown = now;
            put_text("TICK ");
            put_number(now);
            put_char('\r');
            put_char('\n');
        }
        uint32_t pressed = GPIOA_IDR & 1u;
        if (pressed != button) {
            button = pressed;
            if (pressed) GPIOD_ODR |= 1u << 12;
            else GPIOD_ODR &= ~(1u << 12);
            put_line(pressed ? "BUTTON 1" : "BUTTON 0");
        }
        if (USART2_SR & (1u << 5)) {
            char c = (char)(USART2_DR & 0xFFu);
            if (c == '\r' || c == '\n') {
                if (length) {
                    line[length] = 0;
                    put_text("ECHO ");
                    put_line(line);
                    length = 0;
                }
            } else if (length < sizeof line - 1) {
                line[length++] = c;
            }
        }
    }
#endif
}

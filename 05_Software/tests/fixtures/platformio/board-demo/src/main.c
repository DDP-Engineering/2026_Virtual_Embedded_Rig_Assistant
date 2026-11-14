/*
 * Fixture firmware of the platformio plugin tests (LAB-08) for the STM32F4DISCOVERY (CMSIS framework), following the
 * LAB-06 board-basics protocol so the ELF also runs on the renode plugin's stm32f4-discovery profile: a banner and its
 * version on USART2, "TICK <n>" every 100 ms from TIM2 (the Renode model counts at 10 MHz: PSC 999, ARR 999; with
 * FAST_TICKS every 50 ms), the user button (PA0) mirrored on the user LED (PD12) with "BUTTON <0|1>", and "ECHO <line>"
 * for each received line. Never meant for a real board: it does not configure the clock tree.
 */
#include <stdint.h>

#include "lines.h"

#ifndef FW_VERSION
#define FW_VERSION "0.0.0"
#endif

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
    put_text("\r\n");
}

int main(void) {
    RCC_AHB1ENR |= (1u << 0) | (1u << 3);
    RCC_APB1ENR |= (1u << 0) | (1u << 17);
    USART2_BRR = 0x8Bu;
    USART2_CR1 = (1u << 13) | (1u << 3) | (1u << 2);
    GPIOD_MODER = (GPIOD_MODER & ~(3u << 24)) | (1u << 24);
    put_line("VERA-FW platformio-demo");
    put_line("version " FW_VERSION);
    TIM2_PSC = 999u;
#ifdef FAST_TICKS
    TIM2_ARR = 499u;
#else
    TIM2_ARR = 999u;
#endif
    TIM2_EGR = 1u;
    TIM2_SR = 0u;
    TIM2_DIER = 1u;
    NVIC_ISER0 = 1u << 28;
    TIM2_CR1 = 1u;
    uint32_t shown = 0;
    uint32_t button = 0;
    lines_t received;
    lines_init(&received);
    char number[11];
    for (;;) {
        uint32_t now = ticks;
        if (now != shown) {
            shown = now;
            lines_number(now, number);
            put_text("TICK ");
            put_line(number);
        }
        uint32_t pressed = GPIOA_IDR & 1u;
        if (pressed != button) {
            button = pressed;
            if (pressed) GPIOD_ODR |= 1u << 12;
            else GPIOD_ODR &= ~(1u << 12);
            put_line(pressed ? "BUTTON 1" : "BUTTON 0");
        }
        if ((USART2_SR & (1u << 5)) && lines_feed(&received, (char)(USART2_DR & 0xFFu))) {
            put_text("ECHO ");
            put_line(received.text);
        }
    }
}

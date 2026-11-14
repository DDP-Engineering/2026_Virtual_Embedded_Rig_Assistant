/*
 * VERA zephyr plugin fixture: the board-basics protocol of the LAB-06 renode test set on a real Zephyr build.
 * Boot banner and version, a UART echo of each received line, 10 timer ticks per second, and the user button (PA0)
 * mirrored on the green LED (PD12) with a console line per edge.
 */
#include <zephyr/kernel.h>
#include <zephyr/device.h>
#include <zephyr/drivers/gpio.h>
#include <zephyr/drivers/uart.h>
#include <zephyr/sys/printk.h>

static const struct gpio_dt_spec led = GPIO_DT_SPEC_GET(DT_ALIAS(led0), gpios);
static const struct gpio_dt_spec button = GPIO_DT_SPEC_GET(DT_ALIAS(sw0), gpios);
static const struct device *const console = DEVICE_DT_GET(DT_CHOSEN(zephyr_console));
static struct gpio_callback button_cb;
static unsigned int ticks;

static void tick(struct k_timer *timer)
{
	ARG_UNUSED(timer);
	printk("TICK %u\n", ++ticks);
}

K_TIMER_DEFINE(tick_timer, tick, NULL);

static void pressed(const struct device *port, struct gpio_callback *cb, uint32_t pins)
{
	ARG_UNUSED(port);
	ARG_UNUSED(cb);
	ARG_UNUSED(pins);
	int level = gpio_pin_get_dt(&button);

	gpio_pin_set_dt(&led, level);
	printk("BUTTON %d\n", level);
}

int main(void)
{
	char line[32];
	size_t used = 0;
	unsigned char c;

	printk("VERA-FW zephyr-demo\n");
	printk("version 1.2.3\n");
	gpio_pin_configure_dt(&led, GPIO_OUTPUT_INACTIVE);
	gpio_pin_configure_dt(&button, GPIO_INPUT);
	gpio_pin_interrupt_configure_dt(&button, GPIO_INT_EDGE_BOTH);
	gpio_init_callback(&button_cb, pressed, BIT(button.pin));
	gpio_add_callback(button.port, &button_cb);
	k_timer_start(&tick_timer, K_MSEC(100), K_MSEC(100));

	while (1) {
		if (uart_poll_in(console, &c) != 0) {
			k_msleep(1);
			continue;
		}
		if (c == '\r' || c == '\n') {
			if (used > 0) {
				line[used] = '\0';
				printk("ECHO %s\n", line);
				used = 0;
			}
		} else if (used < sizeof(line) - 1) {
			line[used++] = (char)c;
		}
	}
	return 0;
}

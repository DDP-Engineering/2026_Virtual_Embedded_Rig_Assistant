/* Unity suite of the platformio fixture (LAB-08): every case passes. */
#include <string.h>
#include <unity.h>

#include "lines.h"

void setUp(void) {}
void tearDown(void) {}

static void test_assembles_a_line(void) {
    lines_t lines;
    lines_init(&lines);
    const char *input = "hello\r";
    int done = 0;
    while (*input) done = lines_feed(&lines, *input++);
    TEST_ASSERT_EQUAL_INT(1, done);
    TEST_ASSERT_EQUAL_STRING("hello", lines.text);
}

static void test_ignores_empty_lines(void) {
    lines_t lines;
    lines_init(&lines);
    TEST_ASSERT_EQUAL_INT(0, lines_feed(&lines, '\n'));
}

static void test_truncates_long_lines(void) {
    lines_t lines;
    lines_init(&lines);
    for (int i = 0; i < 40; i++) lines_feed(&lines, 'x');
    TEST_ASSERT_EQUAL_INT(1, lines_feed(&lines, '\n'));
    TEST_ASSERT_EQUAL_size_t(LINES_CAPACITY, strlen(lines.text));
}

static void test_formats_numbers(void) {
    char out[11];
    TEST_ASSERT_EQUAL_size_t(5, lines_number(40210u, out));
    TEST_ASSERT_EQUAL_STRING("40210", out);
    lines_number(0u, out);
    TEST_ASSERT_EQUAL_STRING("0", out);
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_assembles_a_line);
    RUN_TEST(test_ignores_empty_lines);
    RUN_TEST(test_truncates_long_lines);
    RUN_TEST(test_formats_numbers);
    int result = UNITY_END();
#if defined(__arm__)
    for (;;) {
    }
#endif
    return result;
}

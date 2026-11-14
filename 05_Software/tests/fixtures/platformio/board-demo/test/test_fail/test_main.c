/* Unity suite of the platformio fixture (LAB-08): one case passes, one fails on purpose. */
#include <unity.h>

#include "lines.h"

void setUp(void) {}
void tearDown(void) {}

static void test_formats_seven(void) {
    char out[11];
    lines_number(7u, out);
    TEST_ASSERT_EQUAL_STRING("7", out);
}

static void test_expects_the_wrong_text(void) {
    char out[11];
    lines_number(12u, out);
    TEST_ASSERT_EQUAL_STRING("21", out);
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_formats_seven);
    RUN_TEST(test_expects_the_wrong_text);
    int result = UNITY_END();
#if defined(__arm__)
    for (;;) {
    }
#endif
    return result;
}

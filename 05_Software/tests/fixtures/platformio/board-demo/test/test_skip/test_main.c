/* Unity suite of the platformio fixture (LAB-08): one case passes, one is ignored (a skip, never a pass). */
#include <unity.h>

#include "lines.h"

void setUp(void) {}
void tearDown(void) {}

static void test_formats_zero(void) {
    char out[11];
    lines_number(0u, out);
    TEST_ASSERT_EQUAL_STRING("0", out);
}

static void test_needs_a_board(void) { TEST_IGNORE_MESSAGE("needs the real board"); }

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_formats_zero);
    RUN_TEST(test_needs_a_board);
    int result = UNITY_END();
#if defined(__arm__)
    for (;;) {
    }
#endif
    return result;
}

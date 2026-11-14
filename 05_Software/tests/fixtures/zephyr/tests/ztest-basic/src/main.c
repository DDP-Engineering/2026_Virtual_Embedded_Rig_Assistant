/* VERA zephyr plugin fixture: three cases whose outcome a Kconfig option of the scenario selects. */
#include <zephyr/ztest.h>

ZTEST(vera_basic, test_arithmetic)
{
	zassert_equal(2 + 2, 4, "arithmetic");
}

ZTEST(vera_basic, test_optional)
{
	if (IS_ENABLED(CONFIG_VERA_SKIP_DEMO)) {
		ztest_test_skip();
	}
	zassert_true(true, "optional");
}

ZTEST(vera_basic, test_expected)
{
	zassert_false(IS_ENABLED(CONFIG_VERA_FAIL_DEMO), "the fail scenario fails here");
}

ZTEST_SUITE(vera_basic, NULL, NULL, NULL, NULL, NULL);

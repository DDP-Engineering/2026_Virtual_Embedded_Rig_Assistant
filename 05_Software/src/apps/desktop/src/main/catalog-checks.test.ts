import { afterEach, expect, it, vi } from "vitest";
import { CATALOG_CHECK_MS, CatalogChecks } from "./catalog-checks.js";

afterEach(() => {
  vi.useRealTimers();
});
function setup(enabled = true) {
  vi.useFakeTimers();
  const state = { enabled };
  const check = vi.fn(async () => {});
  const checks = new CatalogChecks({ check, enabled: () => state.enabled });
  return { state, check, checks };
}

// REQ-FUNC-ce542246
it("checks the catalog at start and every 24 hours while enabled, and stops on close", async () => {
  const { check, checks, state } = setup();
  checks.start();
  await vi.advanceTimersByTimeAsync(0);
  expect(check).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(CATALOG_CHECK_MS - 1);
  expect(check).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(check).toHaveBeenCalledTimes(2);
  expect(CATALOG_CHECK_MS).toBe(24 * 60 * 60 * 1000);

  state.enabled = false;
  await vi.advanceTimersByTimeAsync(CATALOG_CHECK_MS);
  expect(check).toHaveBeenCalledTimes(2);
  state.enabled = true;
  checks.close();
  await vi.advanceTimersByTimeAsync(CATALOG_CHECK_MS * 2);
  expect(check).toHaveBeenCalledTimes(2);
});

// REQ-FUNC-ce542246
it("skips the start check while disabled and survives a failed check", async () => {
  const { check, checks, state } = setup(false);
  checks.start();
  await vi.advanceTimersByTimeAsync(0);
  expect(check).not.toHaveBeenCalled();
  state.enabled = true;
  check.mockRejectedValueOnce(new Error("offline"));
  await vi.advanceTimersByTimeAsync(CATALOG_CHECK_MS);
  expect(check).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(CATALOG_CHECK_MS);
  expect(check).toHaveBeenCalledTimes(2);
  checks.close();
});

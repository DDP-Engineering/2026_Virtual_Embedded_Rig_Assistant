import { afterEach, expect } from "vitest";
import { installTestNetworkGuard, takeNetworkAttempts } from "./network-guard.js";

installTestNetworkGuard();
afterEach(() => {
  expect(takeNetworkAttempts(), "automated test attempted outbound network").toEqual([]);
});

import { expect, it, vi } from "vitest";
import { browserLaunchOptions, classifyLaunchFailure, launchBrowser } from "./launcher.js";

it("forces a visible launch with sandboxing and a finite startup timeout", () => {
  expect(browserLaunchOptions("/verified/chrome", "http://127.0.0.1:1")).toMatchObject({
    executablePath: "/verified/chrome",
    headless: false,
    chromiumSandbox: true,
    timeout: expect.any(Number),
  });
  expect(browserLaunchOptions("/verified/chrome", "http://127.0.0.1:1").timeout).toBeLessThan(30_001);
});

it.each([
  ["No usable sandbox!", "sandbox-unavailable"],
  ["Failed to move to new namespace: Operation not permitted", "sandbox-unavailable"],
  ["Missing X server or $DISPLAY", "prerequisite"],
  ["error while loading shared libraries: libnss3.so", "prerequisite"],
  ["browser closed unexpectedly", "launch"],
])("reports actionable startup failures: %s", (output, code) => {
  expect(classifyLaunchFailure(new Error(output))).toMatchObject({ code, recovery: expect.any(String) });
});

it("caps the Chromium launch by the remaining host startup time", () => {
  expect(browserLaunchOptions("/verified/chrome", "http://127.0.0.1:1", 750).timeout).toBe(750);
});

it("refuses an ambient Selenium remote before Playwright can use it", async () => {
  vi.stubEnv("SELENIUM_REMOTE_URL", "http://127.0.0.1:1");
  try {
    await expect(
      launchBrowser("/verified/chrome", new AbortController().signal, "http://127.0.0.1:1", 750),
    ).rejects.toMatchObject({
      code: "remote-launch-configured",
      recovery: expect.stringContaining("SELENIUM_REMOTE_URL"),
    });
  } finally {
    vi.unstubAllEnvs();
  }
});

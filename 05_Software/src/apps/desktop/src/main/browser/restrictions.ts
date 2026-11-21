import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Page } from "playwright-core";
import { BrowserError } from "./failure.js";

// Chrome for Testing reads these mandatory policies from its owned Local State at startup.
const policies = {
  URLBlocklist: ["*", "chrome://*", "chrome-extension://*", "devtools://*", "file://*"],
  URLAllowlist: ["http://*", "https://*", "about:*", "chrome://sandbox"],
  AllowFileSelectionDialogs: false,
  DownloadRestrictions: 3,
  AudioCaptureAllowed: false,
  VideoCaptureAllowed: false,
  ScreenCaptureAllowed: false,
  DefaultGeolocationSetting: 2,
  DefaultNotificationsSetting: 2,
  DefaultClipboardSetting: 2,
  DefaultSensorsSetting: 2,
  DefaultFileSystemReadGuardSetting: 2,
  DefaultFileSystemWriteGuardSetting: 2,
  DefaultWebBluetoothGuardSetting: 2,
  DefaultWebUsbGuardSetting: 2,
  DefaultSerialGuardSetting: 2,
  DefaultWebHidGuardSetting: 2,
  DefaultWindowManagementSetting: 2,
  BrowserGuestModeEnabled: false,
  BrowserAddPersonEnabled: false,
  BrowserSignin: 0,
  PasswordManagerEnabled: false,
  PrintingEnabled: false,
  PolicyTestPageEnabled: false,
  WebRtcIPHandling: "disable_non_proxied_udp",
};

export async function prepareBrowserProfile(profile: string, proxyServer: string): Promise<string> {
  // Chrome's policy test loader expects this tuple for a mandatory machine/platform policy.
  const effective = {
    ...policies,
    ProxySettings: { ProxyMode: "fixed_servers", ProxyServer: proxyServer, ProxyBypassList: "<-loopback>" },
    DnsOverHttpsMode: "off",
    NetworkPredictionOptions: 2,
    QuicAllowed: false,
  };
  const entries = Object.entries(effective).map(([name, value]) => ({
    name,
    value,
    level: 1,
    scope: 1,
    source: 4,
  }));
  const fixture = join(profile, "policy-check.html");
  const configuration = join(profile, "vera-browser.json");
  await Promise.all([
    writeFile(
      join(profile, "Local State"),
      JSON.stringify({ local_test_policies_for_next_startup: JSON.stringify(entries) }),
    ),
    writeFile(configuration, JSON.stringify({ enableVirtualClipboard: true })),
    writeFile(fixture, "<title>VERA local restriction check</title>"),
  ]);
  return configuration;
}

/** A pinned browser ignoring its managed local-file rule must never expose a page. */
export async function checkBrowserProfile(page: Page, profile: string, timeout: number): Promise<void> {
  try {
    await page.goto(pathToFileURL(join(profile, "policy-check.html")).href, { timeout });
  } catch (error) {
    if (error instanceof Error && error.message.includes("ERR_BLOCKED_BY_ADMINISTRATOR")) return;
    throw new BrowserError("policy-unavailable", { cause: error });
  }
  throw new BrowserError("policy-unavailable");
}

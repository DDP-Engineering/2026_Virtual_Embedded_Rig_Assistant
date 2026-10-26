import { describe, expect, it } from "vitest";
import { channels } from "./ipc.js";

describe("strict ChatGPT IPC", () => {
  it("rejects secret-bearing metadata, mixed login variants and unconfirmed external URLs", () => {
    const status = channels["providers.chatgpt.status"].response;
    expect(status.safeParse({ connected: true, state: "idle", access: "fake" }).success).toBe(false);
    expect(status.safeParse({ connected: true, state: "idle", refresh: "fake" }).success).toBe(false);
    const login = channels["providers.chatgpt.login"].request;
    expect(login.safeParse({ manualCode: "fake", promptId: "1", storageConsent: true }).success).toBe(false);
    expect(login.safeParse({ manualCode: "fake" }).success).toBe(false);
    expect(login.safeParse({ storageConsent: false }).success).toBe(true);
    expect(
      channels["app.openExternal"].request.safeParse({ url: "https://example.invalid", confirmed: false })
        .success,
    ).toBe(false);
    expect(
      channels["app.openExternal"].request.safeParse({ url: "file:///tmp/a", confirmed: true }).success,
    ).toBe(false);
  });
  it("exposes four metadata-only auth channels", () => {
    for (const name of [
      "providers.chatgpt.login",
      "providers.chatgpt.cancel",
      "providers.chatgpt.status",
      "providers.chatgpt.logout",
    ]) {
      expect(Object.hasOwn(channels, name), name).toBe(true);
    }
  });
});

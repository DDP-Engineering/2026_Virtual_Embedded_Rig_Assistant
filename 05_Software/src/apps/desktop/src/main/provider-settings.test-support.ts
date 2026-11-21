import { SettingsService } from "@vera/core";
import { vi } from "vitest";
import { CredentialFile } from "./credentials.js";
import { ProviderSettings } from "./provider-settings.js";

export function providerSettingsHarness(
  secure = true,
  presets?: ConstructorParameters<typeof ProviderSettings>[2],
) {
  const disk = new Map<string, string>();
  const changed = vi.fn<() => void>();
  const files = {
    read: vi.fn(async (p: string) => disk.get(p)),
    writeAtomic: vi.fn(async (p: string, v: string) => {
      disk.set(p, v);
    }),
  };
  const settings = new SettingsService({
    files,
    paths: { userData: "/data", settings: "/data/settings.json", logs: "/data/logs" },
    uuid: () => "1b9dc50c-d87d-484b-88e6-04cb5f7c5a19",
    changed,
  });
  const credentials = new CredentialFile({
    file: "/data/credentials.json",
    files,
    platform: "win32",
    crypto: {
      isEncryptionAvailable: () => secure,
      getSelectedStorageBackend: () => "unknown",
      encryptString: (text) => Buffer.from(Buffer.from(text).map((b) => b ^ 0x5a)),
      decryptString: (bytes) => Buffer.from(bytes.map((b) => b ^ 0x5a)).toString(),
    },
    logger: { log: vi.fn(), registerSecret: vi.fn(() => () => {}), flush: vi.fn(async () => {}) },
  });
  const service = new ProviderSettings(settings, credentials, presets);
  return {
    disk,
    files,
    settings,
    credentials,
    service,
    changed,
    setSecure: (value: boolean) => {
      secure = value;
    },
  };
}

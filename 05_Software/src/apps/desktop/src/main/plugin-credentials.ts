import type { ProgramCredentials } from "@vera/core";
import {
  credentialReferenceSchema,
  mqttCredentialSaveSchema,
  PLUGIN_CREDENTIALS_MAX,
  type PluginCredentialList,
  type PluginCredentialScope,
  pluginCredentialId,
  pluginCredentialRemoveSchema,
  veraError,
  wokwiCredentialSaveSchema,
} from "@vera/shared";
import type { CredentialFile } from "./credentials.js";

/** The secret and optional username a save request of each scope carries. */
function parseSave(
  scope: PluginCredentialScope,
  request: unknown,
):
  | { ref: string; secret: string; username?: string | undefined; storageConsent?: boolean | undefined }
  | undefined {
  if (scope === "mqtt") {
    const parsed = mqttCredentialSaveSchema.safeParse(request);
    return parsed.success ? { ...parsed.data, secret: parsed.data.password } : undefined;
  }
  const parsed = wokwiCredentialSaveSchema.safeParse(request);
  return parsed.success ? { ...parsed.data, secret: parsed.data.token } : undefined;
}

/**
 * Main owns plugin credentials of one scope (spec REQ-DATA-96d18686 section 1): MQTT broker logins or Wokwi CI
 * tokens. The renderer stores and removes them and sees only references and storage; approved plugin runs read them
 * through `programCredentials`.
 */
export class PluginCredentialService {
  private readonly prefix: string;
  constructor(
    private readonly scope: PluginCredentialScope,
    private readonly host: { credentials: CredentialFile; changed?: () => void },
  ) {
    this.prefix = `${scope}:`;
  }
  async list(): Promise<PluginCredentialList> {
    const { credentials } = this.host;
    const refs = (await credentials.list())
      .map((entry) => entry.providerId)
      .filter((id) => id.startsWith(this.prefix))
      .map((id) => id.slice(this.prefix.length))
      .filter((ref) => credentialReferenceSchema.safeParse(ref).success)
      .sort()
      .slice(0, PLUGIN_CREDENTIALS_MAX);
    const list = {
      credentials: refs.map((ref) => ({ ref, storage: credentials.storage(this.prefix + ref) })),
      secureStorage: credentials.secureStorage,
    };
    if (credentials.containsSecret(list)) throw veraError("INVALID");
    return list;
  }
  async save(request: unknown): Promise<{ status: "saved" | "consent-required" }> {
    const raw = request as { username?: unknown; password?: unknown; token?: unknown } | undefined;
    // Registered before validation, so even a refused value never reaches a log unredacted.
    for (const value of [raw?.username, raw?.password, raw?.token])
      if (typeof value === "string" && value) this.host.credentials.registerSecret(value);
    const parsed = parseSave(this.scope, request);
    if (!parsed) throw veraError("INVALID");
    const { ref, secret, username, storageConsent } = parsed;
    const { credentials } = this.host;
    if (!credentials.secureStorage && storageConsent === undefined) return { status: "consent-required" };
    const id = pluginCredentialId(this.scope, ref);
    const existing = (await credentials.list()).filter((entry) => entry.providerId.startsWith(this.prefix));
    if (existing.length >= PLUGIN_CREDENTIALS_MAX && !existing.some((entry) => entry.providerId === id))
      throw veraError("INVALID");
    try {
      await credentials.modify(
        id,
        async () => ({ type: "api_key", key: secret, ...(username ? { env: { username } } : {}) }),
        storageConsent === undefined ? undefined : { storageConsent },
      );
    } catch {
      throw veraError("INTERNAL");
    }
    this.notify();
    return { status: "saved" };
  }
  async remove(request: unknown): Promise<Record<string, never>> {
    const parsed = pluginCredentialRemoveSchema.safeParse(request);
    if (!parsed.success) throw veraError("INVALID");
    try {
      await this.host.credentials.delete(pluginCredentialId(this.scope, parsed.data.ref));
    } catch {
      throw veraError("INTERNAL");
    }
    this.notify();
    return {};
  }
  private notify() {
    try {
      this.host.changed?.();
    } catch {
      /* A stored credential cannot be undone by an observer. */
    }
  }
}

/** The ProgramHost credential port over the main-process store, for every scope. */
export function programCredentials(credentials: CredentialFile): ProgramCredentials {
  return {
    // Existence only: prepare (before approval) never asks the store for the secret.
    has: async (scope, ref, signal) =>
      (await credentials.list(signal ? { signal } : undefined)).some(
        (entry) => entry.providerId === pluginCredentialId(scope, ref) && entry.type === "api_key",
      ),
    read: async (scope, ref, signal) => {
      const value = await credentials.read(pluginCredentialId(scope, ref), signal ? { signal } : undefined);
      if (value?.type !== "api_key" || !value.key) return undefined;
      return { password: value.key, ...(value.env?.username ? { username: value.env.username } : {}) };
    },
  };
}

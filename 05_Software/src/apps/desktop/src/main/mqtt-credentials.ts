import type { ProgramCredentials } from "@vera/core";
import {
  credentialReferenceSchema,
  MQTT_CREDENTIALS_MAX,
  type MqttCredentialList,
  mqttCredentialRemoveSchema,
  mqttCredentialSaveSchema,
  pluginCredentialId,
  veraError,
} from "@vera/shared";
import type { CredentialFile } from "./credentials.js";

const PREFIX = "mqtt:";
/**
 * Main owns MQTT broker credentials (spec REQ-DATA-96d18686 section 1): the renderer stores and removes them and
 * sees only references and storage; approved plugin runs read them through `programCredentials`.
 */
export class MqttCredentialService {
  constructor(private readonly host: { credentials: CredentialFile; changed?: () => void }) {}
  async list(): Promise<MqttCredentialList> {
    const { credentials } = this.host;
    const refs = (await credentials.list())
      .map((entry) => entry.providerId)
      .filter((id) => id.startsWith(PREFIX))
      .map((id) => id.slice(PREFIX.length))
      .filter((ref) => credentialReferenceSchema.safeParse(ref).success)
      .sort()
      .slice(0, MQTT_CREDENTIALS_MAX);
    const list = {
      credentials: refs.map((ref) => ({ ref, storage: credentials.storage(PREFIX + ref) })),
      secureStorage: credentials.secureStorage,
    };
    if (credentials.containsSecret(list)) throw veraError("INVALID");
    return list;
  }
  async save(request: unknown): Promise<{ status: "saved" | "consent-required" }> {
    const raw = request as { username?: unknown; password?: unknown } | undefined;
    // Registered before validation, so even a refused value never reaches a log unredacted.
    for (const value of [raw?.username, raw?.password])
      if (typeof value === "string" && value) this.host.credentials.registerSecret(value);
    const parsed = mqttCredentialSaveSchema.safeParse(request);
    if (!parsed.success) throw veraError("INVALID");
    const { ref, username, password, storageConsent } = parsed.data;
    const { credentials } = this.host;
    if (!credentials.secureStorage && storageConsent === undefined) return { status: "consent-required" };
    const id = pluginCredentialId("mqtt", ref);
    const existing = (await credentials.list()).filter((entry) => entry.providerId.startsWith(PREFIX));
    if (existing.length >= MQTT_CREDENTIALS_MAX && !existing.some((entry) => entry.providerId === id))
      throw veraError("INVALID");
    try {
      await credentials.modify(
        id,
        async () => ({ type: "api_key", key: password, ...(username ? { env: { username } } : {}) }),
        storageConsent === undefined ? undefined : { storageConsent },
      );
    } catch {
      throw veraError("INTERNAL");
    }
    this.notify();
    return { status: "saved" };
  }
  async remove(request: unknown): Promise<Record<string, never>> {
    const parsed = mqttCredentialRemoveSchema.safeParse(request);
    if (!parsed.success) throw veraError("INVALID");
    try {
      await this.host.credentials.delete(pluginCredentialId("mqtt", parsed.data.ref));
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

/** The ProgramHost credential port over the main-process store. */
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

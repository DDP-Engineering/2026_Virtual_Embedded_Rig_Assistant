import type { CredentialStore, ProgramCredentials } from "@vera/core";
import {
  credentialReferenceSchema,
  type PluginCredentialScope,
  pluginCredentialId,
  veraError,
} from "@vera/shared";

const MQTT_PASSWORD = /^VERA_MQTT_PASSWORD_([A-Z0-9_]{1,64})$/;
const WOKWI_TOKEN = /^VERA_WOKWI_TOKEN_([A-Z0-9_]{1,64})$/;
/**
 * Puts plugin credentials from the environment into memory-only entries (spec REQ-DATA-96d18686 §1):
 * `VERA_MQTT_PASSWORD_<REF>` (with `VERA_MQTT_USERNAME_<REF>`) as `mqtt:<ref>` and `VERA_WOKWI_TOKEN_<REF>` as
 * `wokwi:<ref>`, where `<REF>` is the reference upper-cased with `-` as `_`. Returns the stored ids, sorted.
 */
export async function pluginCredentialsFromEnvironment(
  env: Record<string, string | undefined>,
  store: CredentialStore,
  register: (secret: string) => unknown,
): Promise<string[]> {
  const ids: string[] = [];
  const put = async (scope: PluginCredentialScope, name: string, secret: string, username?: string) => {
    const ref = name.toLowerCase().replaceAll("_", "-");
    register(secret);
    if (username) register(username);
    if (!credentialReferenceSchema.safeParse(ref).success || /\p{Cc}/u.test(secret + (username ?? "")))
      throw veraError("INVALID");
    await store.modify(pluginCredentialId(scope, ref), async () => ({
      type: "api_key",
      key: secret,
      ...(username ? { env: { username } } : {}),
    }));
    ids.push(pluginCredentialId(scope, ref));
  };
  for (const [name, value] of Object.entries(env)) {
    if (!value) continue;
    const mqtt = MQTT_PASSWORD.exec(name);
    if (mqtt?.[1]) await put("mqtt", mqtt[1], value, env[`VERA_MQTT_USERNAME_${mqtt[1]}`]);
    const wokwi = WOKWI_TOKEN.exec(name);
    if (wokwi?.[1]) await put("wokwi", wokwi[1], value);
  }
  return ids.sort();
}

/** The ProgramHost credential port over the CLI's memory store. */
export function cliProgramCredentials(store: CredentialStore): ProgramCredentials {
  const read = async (scope: PluginCredentialScope, ref: string, signal?: AbortSignal) => {
    const value = await store.read(pluginCredentialId(scope, ref), signal ? { signal } : undefined);
    if (value?.type !== "api_key" || !value.key) return undefined;
    return { password: value.key, ...(value.env?.username ? { username: value.env.username } : {}) };
  };
  return {
    // Existence only, as on the desktop: prepare never reads the secret.
    has: async (scope, ref, signal) =>
      (await store.list(signal ? { signal } : undefined)).some(
        (entry) => entry.providerId === pluginCredentialId(scope, ref) && entry.type === "api_key",
      ),
    read,
  };
}

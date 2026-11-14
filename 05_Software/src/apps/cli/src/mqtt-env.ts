import type { CredentialStore, ProgramCredentials } from "@vera/core";
import { credentialReferenceSchema, pluginCredentialId, veraError } from "@vera/shared";

const PASSWORD = /^VERA_MQTT_PASSWORD_([A-Z0-9_]{1,64})$/;
/**
 * Puts MQTT broker credentials from `VERA_MQTT_PASSWORD_<REF>` (and `VERA_MQTT_USERNAME_<REF>`) into memory-only
 * entries `mqtt:<ref>`, where `<REF>` is the reference upper-cased with `-` as `_` (spec REQ-DATA-96d18686 §1).
 */
export async function mqttFromEnvironment(
  env: Record<string, string | undefined>,
  store: CredentialStore,
  register: (secret: string) => unknown,
): Promise<string[]> {
  const refs: string[] = [];
  for (const [name, password] of Object.entries(env)) {
    const match = PASSWORD.exec(name);
    if (!match?.[1] || !password) continue;
    const ref = match[1].toLowerCase().replaceAll("_", "-");
    const username = env[`VERA_MQTT_USERNAME_${match[1]}`];
    register(password);
    if (username) register(username);
    if (!credentialReferenceSchema.safeParse(ref).success || /\p{Cc}/u.test(password + (username ?? "")))
      throw veraError("INVALID");
    await store.modify(pluginCredentialId("mqtt", ref), async () => ({
      type: "api_key",
      key: password,
      ...(username ? { env: { username } } : {}),
    }));
    refs.push(ref);
  }
  return refs.sort();
}

/** The ProgramHost credential port over the CLI's memory store. */
export function cliProgramCredentials(store: CredentialStore): ProgramCredentials {
  const read = async (scope: "mqtt", ref: string, signal?: AbortSignal) => {
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

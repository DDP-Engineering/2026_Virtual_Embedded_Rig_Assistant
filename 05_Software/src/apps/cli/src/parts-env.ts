import { ConfiguredPartsProvider, type CredentialStore } from "@vera/core";
import { type PartsSearchSettings, type PartsSupplierId, partsSecretSchema, veraError } from "@vera/shared";

/** Environment variables per supplier: the secret, and the public part of a two-part credential. */
export const partsEnvironment: readonly [PartsSupplierId, string, string?][] = [
  ["mouser", "MOUSER_API_KEY"],
  ["digikey", "DIGIKEY_CLIENT_SECRET", "DIGIKEY_CLIENT_ID"],
  ["tme", "TME_API_SECRET", "TME_API_TOKEN"],
  ["farnell", "FARNELL_API_KEY"],
  ["rutronik", "RUTRONIK_API_KEY"],
];

/**
 * Puts supplier credentials from the environment into memory-only slots and returns the run's parts settings:
 * a supplier is enabled exactly when all of its variables are present.
 */
export async function partsFromEnvironment(
  env: Record<string, string | undefined>,
  base: PartsSearchSettings,
  store: CredentialStore,
  register: (secret: string) => unknown,
): Promise<PartsSearchSettings> {
  const settings = structuredClone(base);
  for (const [supplier, secretName, idName] of partsEnvironment) {
    const secret = env[secretName],
      id = idName ? env[idName] : undefined;
    const complete = !!secret && (!idName || !!id);
    settings.suppliers[supplier].enabled = complete;
    if (!complete) continue;
    for (const value of [secret, id]) if (value) register(value);
    if (
      !partsSecretSchema.safeParse(secret).success ||
      (id !== undefined && !partsSecretSchema.safeParse(id).success)
    )
      throw veraError("INVALID");
    await store.modify(`parts:${supplier}`, async () => ({
      type: "api_key",
      key: secret,
      ...(id ? { env: { id } } : {}),
    }));
  }
  return settings;
}

export function cliPartsProvider(
  store: CredentialStore,
  parts: PartsSearchSettings,
  webEnabled: () => boolean,
) {
  return new ConfiguredPartsProvider({
    config: () => ({ parts, webEnabled: webEnabled() }),
    getCredential: async (supplier, signal) => {
      const value = await store.read(`parts:${supplier}`, { signal });
      if (value?.type !== "api_key" || !value.key) return undefined;
      return value.env?.id ? { secret: value.key, id: value.env.id } : { secret: value.key };
    },
  });
}

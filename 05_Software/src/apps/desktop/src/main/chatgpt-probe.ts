import { createModels } from "@earendil-works/pi-ai/models";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import type { CredentialStore } from "@vera/core";

/** Instrumented native acceptance only; startup import is compiled out of production. */
export function scriptedSubscription(store: CredentialStore) {
  const models = createModels({ credentials: store });
  const provider = openaiProvider();
  const oauth = provider.auth.oauth;
  if (!oauth) throw new Error("Missing OAuth");
  models.setProvider({
    ...provider,
    auth: {
      oauth: {
        ...oauth,
        async login(interaction, options) {
          if (options?.agentName !== "VERA" || !options.getDeviceId?.())
            throw new Error("Missing login identity");
          interaction.notify({
            type: "auth_url",
            url: "https://auth.openai.com/api/accounts/authorize?state=scripted",
          });
          await interaction.prompt({
            type: "manual_code",
            message: "Scripted redirect",
            signal: interaction.signal,
          });
          return {
            type: "oauth",
            access: "fictional-native-access-WP21",
            refresh: "fictional-native-refresh-WP21",
            expires: 2000000000000,
            clientId: "fictional-native-client-WP21",
          };
        },
      },
    },
  });
  return models;
}

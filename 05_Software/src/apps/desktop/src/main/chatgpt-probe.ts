import { createModels } from "@earendil-works/pi-ai/models";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { type CredentialStore, createPiAiGateway } from "@vera/core";

/** The scripted login has an isolated, fictional catalog too; never attempt live account egress. */
export const scriptedCatalogFetch: typeof fetch = async (input, init) => {
  if (
    String(input) !== "https://api.openai.com/v1/models" ||
    (init?.method ?? "GET") !== "GET" ||
    new Headers(init?.headers).get("authorization") !== "Bearer fictional-native-access-WP21"
  )
    throw new Error("Unexpected scripted catalog request");
  return Response.json({
    models: [
      {
        slug: "fictional-native-model",
        display_name: "Fictional native model",
        visibility: "list",
        context_window: 131072,
        input_modalities: ["text"],
      },
    ],
  });
};

export function scriptedGateway(host: Parameters<typeof createPiAiGateway>[0]) {
  return createPiAiGateway({ ...host, fetch: scriptedCatalogFetch });
}

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

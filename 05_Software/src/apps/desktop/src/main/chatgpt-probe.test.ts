import { expect, it } from "vitest";
import { scriptedCatalogFetch } from "./chatgpt-probe.js";

it("limits the fictional subscription catalog to its exact endpoint and fictional credential", async () => {
  const response = await scriptedCatalogFetch("https://api.openai.com/v1/models", {
    headers: { Authorization: "Bearer fictional-native-access-WP21" },
  });
  expect(await response.json()).toMatchObject({ models: [{ slug: "fictional-native-model" }] });
  await expect(
    scriptedCatalogFetch("https://api.openai.com/v1/models", { headers: { Authorization: "Bearer other" } }),
  ).rejects.toThrow("Unexpected scripted");
  await expect(
    scriptedCatalogFetch("https://other.example.test/models", {
      headers: { Authorization: "Bearer fictional-native-access-WP21" },
    }),
  ).rejects.toThrow("Unexpected scripted");
  await expect(
    scriptedCatalogFetch("https://api.openai.com/v1/models", {
      method: "POST",
      headers: { Authorization: "Bearer fictional-native-access-WP21" },
    }),
  ).rejects.toThrow("Unexpected scripted");
});

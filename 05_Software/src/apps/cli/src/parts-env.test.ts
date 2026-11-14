import { partsSearchDefaults } from "@vera/shared";
import { expect, it } from "vitest";
import { MemoryCredentials } from "./host-ports.js";
import { cliPartsProvider, partsFromEnvironment } from "./parts-env.js";

it("holds supplier credentials from the environment in memory and enables only complete suppliers", async () => {
  const registered: string[] = [];
  const store = new MemoryCredentials((secret) => registered.push(secret));
  const settings = await partsFromEnvironment(
    {
      MOUSER_API_KEY: "mouser-env-key-1",
      DIGIKEY_CLIENT_ID: "dk-id-without-secret",
      TME_API_TOKEN: "tme-token-1",
      TME_API_SECRET: "tme-secret-1",
    },
    partsSearchDefaults,
    store,
    (secret) => registered.push(secret),
  );
  expect(
    Object.entries(settings.suppliers)
      .filter(([, value]) => value.enabled)
      .map(([id]) => id),
  ).toEqual(["mouser", "tme"]);
  expect(registered).toEqual(expect.arrayContaining(["mouser-env-key-1", "tme-token-1", "tme-secret-1"]));
  expect(await store.read("parts:mouser")).toEqual({ type: "api_key", key: "mouser-env-key-1" });
  expect(await store.read("parts:tme")).toEqual({
    type: "api_key",
    key: "tme-secret-1",
    env: { id: "tme-token-1" },
  });
  expect(await store.read("parts:digikey")).toBeUndefined();
  expect(partsSearchDefaults.suppliers.mouser.enabled).toBe(false);
  await expect(
    partsFromEnvironment({ MOUSER_API_KEY: "has space" }, partsSearchDefaults, store, () => {}),
  ).rejects.toMatchObject({ code: "INVALID" });
  const provider = cliPartsProvider(store, settings, () => false);
  await expect(provider.search({ query: "mosfet" }, new AbortController().signal)).rejects.toMatchObject({
    reason: "disabled",
  });
  await provider.close();
});

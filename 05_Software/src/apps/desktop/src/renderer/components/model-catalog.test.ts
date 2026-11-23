// @vitest-environment jsdom
import { expect, it } from "vitest";
import i18n from "../i18n.js";
import { type CatalogModel, chatModelGroups, offeredModels } from "./model-catalog.js";

const model = (id: string): CatalogModel =>
  ({ id, name: id, reference: `custom:bench/${id}` }) as CatalogModel;

// REQ-FUNC-701b5178
it("offers a provider's ticked models, or its whole catalog when it has no list", () => {
  const catalog = [model("alpha"), model("beta"), model("gamma")];
  expect(offeredModels(catalog, ["beta", "gamma"]).map((m) => m.id)).toEqual(["beta", "gamma"]);
  expect(offeredModels(catalog, undefined).map((m) => m.id)).toEqual(["alpha", "beta", "gamma"]);
  expect(offeredModels(catalog, [])).toEqual([]);
  // A ticked model the provider no longer lists is not invented.
  expect(offeredModels(catalog, ["delta"])).toEqual([]);
});

it("uses compact names under the connection and disambiguates duplicate display names", () => {
  const models = [
    { ...model("lab/alpha"), name: "Fast model" },
    { ...model("lab/beta"), name: "Fast model" },
    { ...model("vendor/gamma"), name: "Careful model" },
  ];
  expect(chatModelGroups(models, [{ id: "custom:bench", name: "Local lab" }], i18n.t)).toEqual([
    {
      id: "custom:bench",
      label: "Local lab",
      options: [
        { reference: "custom:bench/lab/alpha", label: "Fast model (lab/alpha)" },
        { reference: "custom:bench/lab/beta", label: "Fast model (lab/beta)" },
        { reference: "custom:bench/vendor/gamma", label: "Careful model" },
      ],
    },
  ]);
});

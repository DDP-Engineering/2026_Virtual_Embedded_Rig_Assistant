// @vitest-environment jsdom
import { expect, it } from "vitest";
import { type CatalogModel, offeredModels } from "./model-catalog.js";

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

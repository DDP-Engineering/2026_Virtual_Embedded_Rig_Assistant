import type { PartsSupplierId } from "@vera/shared";
import { PartsHttpError, partsJson } from "./http.js";
import {
  type AccessToken,
  count,
  currency,
  errorCodes,
  link,
  type PartsItem,
  type PriceBreak,
  parameters,
  priceBreak,
  type SupplierAdapter,
  type SupplierAnswer,
  text,
} from "./provider.js";

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
/** An answer that is not the supplier's documented shape: the supplier is reported `failed`, never "nothing found". */
const unexpected = (): SupplierAnswer => ({ items: [], partial: false, errors: ["unexpected-answer"] });
const breaks = (values: unknown[], read: (entry: Record<string, unknown>) => PriceBreak | null) =>
  values.map((entry) => read(object(entry))).filter((entry): entry is PriceBreak => entry !== null);
/** Collects readable items; an item without a part number or supplier part number makes the answer partial. */
function collect(
  values: unknown[],
  read: (entry: Record<string, unknown>) => PartsItem | null,
  limit: number,
) {
  const items: PartsItem[] = [];
  let skipped = false;
  for (const value of values.slice(0, limit)) {
    const item = read(object(value));
    if (item?.mpn && item.offer.sku) items.push(item);
    else skipped = true;
  }
  return { items, skipped };
}
const tokenFrom = (value: unknown): AccessToken => {
  const body = object(value);
  const token =
    typeof body.access_token === "string" && /^[!-~]{1,8192}$/.test(body.access_token)
      ? body.access_token
      : "";
  if (!token) throw new PartsHttpError("invalid");
  const seconds = typeof body.expires_in === "number" && body.expires_in > 0 ? body.expires_in : 300;
  return { value: token, expiresIn: seconds };
};

const mouser: SupplierAdapter = {
  async search(request, { credential }, signal, http) {
    const keyword = request.by === "keyword";
    const url = new URL(
      `https://api.mouser.com/api/v2/search/${keyword ? "keywordandmanufacturer" : "partnumberandmanufacturer"}`,
    );
    url.searchParams.set("apiKey", credential.secret);
    const body = keyword
      ? {
          SearchByKeywordMfrNameRequest: {
            keyword: request.text,
            records: request.limit,
            pageNumber: 1,
            searchOptions: "None",
          },
        }
      : { SearchByPartMfrNameRequest: { mouserPartNumber: request.text, partSearchOptions: "None" } };
    const answer = object(
      await partsJson(
        url,
        {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        signal,
        http,
      ),
    );
    const reported = list(answer.Errors);
    const results = answer.SearchResults;
    if (
      !reported.length &&
      (!results ||
        typeof results !== "object" ||
        (!Array.isArray(object(results).Parts) && Number(object(results).NumberOfResult) !== 0))
    )
      return unexpected();
    const codes = errorCodes(reported.map((entry) => object(entry).Code));
    const errors = reported.length && !codes.length ? ["supplier-error"] : codes;
    const { items, skipped } = collect(
      list(object(answer.SearchResults).Parts),
      (part) => {
        const attributes = list(part.ProductAttributes).map((entry) => object(entry));
        const attribute = (name: string) =>
          text(attributes.find((entry) => entry.AttributeName === name)?.AttributeValue, 120);
        return {
          manufacturer: text(part.Manufacturer, 120),
          mpn: text(part.ManufacturerPartNumber, 64) ?? "",
          package: attribute("Package / Case"),
          description: text(part.Description),
          lifecycle: text(part.LifecycleStatus, 80),
          datasheetUrl: link(part.DataSheetUrl),
          parameters: parameters(
            attributes
              .filter((entry) => !["Packaging", "Package / Case"].includes(String(entry.AttributeName)))
              .map((entry) => [entry.AttributeName, entry.AttributeValue] as [unknown, unknown]),
          ),
          offer: {
            sku: text(part.MouserPartNumber, 64) ?? "",
            packaging: attribute("Packaging"),
            stock: count(part.AvailabilityInStock),
            moq: count(part.Min),
            multiple: count(part.Mult),
            leadTime: text(part.LeadTime, 80),
            currency: currency(
              list(part.PriceBreaks)
                .map((entry) => object(entry).Currency)
                .find(Boolean),
            ),
            region: null,
            productUrl: link(part.ProductDetailUrl),
            priceBreaks: breaks(list(part.PriceBreaks), (entry) => priceBreak(entry.Quantity, entry.Price)),
          },
        };
      },
      request.limit,
    );
    return { items, partial: skipped || (errors.length > 0 && items.length > 0), errors };
  },
};

const digikey: SupplierAdapter = {
  async token(credential, signal, http) {
    const form = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: credential.id ?? "",
      client_secret: credential.secret,
    });
    return tokenFrom(
      await partsJson(
        new URL("https://api.digikey.com/v1/oauth2/token"),
        {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
          body: form.toString(),
        },
        signal,
        http,
      ),
    );
  },
  async search(request, { credential, token }, signal, http) {
    const answer = object(
      await partsJson(
        new URL("https://api.digikey.com/products/v4/search/keyword"),
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            Authorization: `Bearer ${token ?? ""}`,
            "X-DIGIKEY-Client-Id": credential.id ?? "",
            "X-DIGIKEY-Locale-Site": request.country,
            "X-DIGIKEY-Locale-Language": request.language,
            "X-DIGIKEY-Locale-Currency": request.currency,
          },
          body: JSON.stringify({ Keywords: request.text, Limit: request.limit, Offset: 0 }),
        },
        signal,
        http,
      ),
    );
    if (!Array.isArray(answer.Products)) return unexpected();
    const locale = object(answer.SearchLocaleUsed);
    const products = [...list(answer.ExactMatches), ...list(answer.Products)];
    const seen = new Set<string>();
    const items: PartsItem[] = [];
    let skipped = false;
    for (const value of products) {
      const product = object(value);
      const mpn = text(product.ManufacturerProductNumber, 64);
      const params = list(product.Parameters).map((entry) => object(entry));
      const param = (name: string) =>
        text(params.find((entry) => entry.ParameterText === name)?.ValueText, 120);
      const variations = list(product.ProductVariations).map((entry) => object(entry));
      if (!mpn || variations.length === 0) {
        skipped = true;
        continue;
      }
      for (const variation of variations) {
        const sku = text(variation.DigiKeyProductNumber, 64);
        if (!sku) {
          skipped = true;
          continue;
        }
        if (seen.has(sku)) continue;
        seen.add(sku);
        if (items.length >= request.limit) break;
        items.push({
          manufacturer: text(object(product.Manufacturer).Name, 120),
          mpn,
          package: param("Package / Case"),
          description: text(object(product.Description).ProductDescription),
          lifecycle: text(object(product.ProductStatus).Status, 80),
          datasheetUrl: link(product.DatasheetUrl),
          parameters: parameters(
            params
              .filter((entry) => entry.ParameterText !== "Package / Case")
              .map((entry) => [entry.ParameterText, entry.ValueText] as [unknown, unknown]),
          ),
          offer: {
            sku,
            packaging: text(object(variation.PackageType).Name, 80),
            stock: count(variation.QuantityAvailableforPackageType),
            moq: count(variation.MinimumOrderQuantity),
            multiple: null,
            leadTime: null,
            currency: currency(locale.Currency),
            region: text(locale.Site, 8),
            productUrl: link(product.ProductUrl),
            priceBreaks: breaks(list(variation.StandardPricing), (entry) =>
              priceBreak(entry.BreakQuantity, entry.UnitPrice),
            ),
          },
        });
      }
    }
    return { items, partial: skipped, errors: [] };
  },
};

const tmeNotice =
  "powered by TME.eu Data; no guarantee of data accuracy; all intellectual property rights to this content are vested in TME, its subsidiaries, the manufacturers of the goods and/or their other owners.";
const tme: SupplierAdapter = {
  notice: tmeNotice,
  async token(credential, signal, http) {
    const basic = Buffer.from(`${credential.id ?? ""}:${credential.secret}`).toString("base64");
    return tokenFrom(
      await partsJson(
        new URL("https://api.tme.eu/auth/token"),
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            Authorization: `Basic ${basic}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: "grant_type=client_credentials",
        },
        signal,
        http,
      ),
    );
  },
  async search(request, { token }, signal, http) {
    // TME's phrase is 2..40 characters (OpenAPI v2); a longer query is not sent rather than silently cut.
    if (request.text.length > 40) return { items: [], partial: false, errors: ["phrase-over-40-characters"] };
    const headers = {
      Accept: "application/json",
      Authorization: `Bearer ${token ?? ""}`,
      "Accept-Language": request.language,
    };
    const search = new URL("https://api.tme.eu/products/search");
    search.searchParams.append("scope[]", "products");
    search.searchParams.set("phrase", request.text);
    search.searchParams.set("country", request.country);
    search.searchParams.set("limit", String(request.limit));
    const found = object(await partsJson(search, { headers }, signal, http));
    if (found.status !== "OK" || !Array.isArray(object(object(found.data).products).elements))
      return unexpected();
    const products = list(object(object(found.data).products).elements)
      .map((entry) => object(entry))
      .slice(0, request.limit);
    const symbols = products
      .map((product) => text(product.symbol, 64))
      .filter((symbol): symbol is string => !!symbol);
    const offers = new Map<string, Record<string, unknown>>();
    let pricesCurrency: string | null = null;
    if (symbols.length) {
      const data = new URL("https://api.tme.eu/products/data");
      for (const scope of ["prices", "stock"]) data.searchParams.append("scope[]", scope);
      for (const symbol of symbols) data.searchParams.append("symbols[]", symbol);
      data.searchParams.set("country", request.country);
      data.searchParams.set("currency", request.currency);
      const answer = object(await partsJson(data, { headers }, signal, http));
      for (const element of list(object(answer.data).elements).map((entry) => object(entry))) {
        const symbol = text(element.symbol, 64);
        if (symbol) offers.set(symbol, element);
      }
    }
    const { items, skipped } = collect(
      products,
      (product) => {
        const symbol = text(product.symbol, 64) ?? "";
        const data = offers.get(symbol) ?? {};
        const prices = object(data.prices);
        pricesCurrency = currency(prices.currency);
        return {
          manufacturer: text(object(product.manufacturer).name, 120),
          mpn: text(list(product.manufacturer_symbols)[0], 64) ?? "",
          package: null,
          description: text(product.description),
          lifecycle: text(list(product.product_status).join(", "), 80),
          datasheetUrl: null,
          parameters: [],
          offer: {
            sku: symbol,
            packaging: text(
              list(object(product.packing).elements)
                .map((entry) => text(object(entry).translation, 40))
                .filter(Boolean)
                .join(", "),
              80,
            ),
            stock: count(data.stock_quantity),
            moq: count(product.minimal_amount),
            multiple: count(product.multiples),
            leadTime: null,
            currency: pricesCurrency,
            region: request.country,
            productUrl: null,
            priceBreaks: breaks(list(prices.elements), (entry) => priceBreak(entry.amount, entry.price)),
          },
        };
      },
      request.limit,
    );
    return { items, partial: skipped || symbols.some((symbol) => !offers.has(symbol)), errors: [] };
  },
};

const farnell: SupplierAdapter = {
  async search(request, { credential }, signal, http) {
    const url = new URL("https://api.element14.com/catalog/products");
    url.searchParams.set("callInfo.responseDataFormat", "JSON");
    url.searchParams.set("callInfo.apiKey", credential.secret);
    url.searchParams.set("term", `${request.by === "keyword" ? "any" : "manuPartNum"}:${request.text}`);
    url.searchParams.set("storeInfo.id", request.farnellStore);
    url.searchParams.set("resultsSettings.offset", "0");
    url.searchParams.set("resultsSettings.numberOfResults", String(request.limit));
    url.searchParams.set("resultsSettings.responseGroup", "large");
    const answer = object(await partsJson(url, { headers: { Accept: "application/json" } }, signal, http));
    const root = object(Object.entries(answer).find(([key]) => key.endsWith("Return"))?.[1]);
    // No `*Return` root, or one with results but no product list, is not the documented answer.
    if (!Object.keys(root).length || (!Array.isArray(root.products) && Number(root.numberOfResults) !== 0))
      return unexpected();
    const { items, skipped } = collect(
      list(object(root).products),
      (product) => ({
        manufacturer: text(product.brandName, 120),
        mpn: text(product.translatedManufacturerPartNumber, 64) ?? "",
        package: null,
        description: text(product.displayName),
        lifecycle: text(product.productStatus, 80),
        datasheetUrl: link(object(list(product.datasheets)[0]).url),
        parameters: parameters(
          list(product.attributes).map((entry) => {
            const attribute = object(entry);
            return [
              attribute.attributeLabel,
              [attribute.attributeValue, attribute.attributeUnit]
                .filter((part) => typeof part === "string" && part)
                .join(" "),
            ] as [unknown, unknown];
          }),
        ),
        offer: {
          sku: text(product.sku, 64) ?? "",
          packaging: text(
            [product.packSize, product.unitOfMeasure]
              .filter((part) => part !== undefined && part !== null)
              .join(" "),
            80,
          ),
          stock: count(object(product.stock).level),
          moq: count(product.translatedMinimumOrderQuality),
          multiple: null,
          leadTime: null,
          currency: null,
          region: request.farnellStore,
          productUrl: null,
          priceBreaks: breaks(list(product.prices), (entry) => priceBreak(entry.from, entry.cost)),
        },
      }),
      request.limit,
    );
    return { items, partial: skipped, errors: [] };
  },
};

const rutronik: SupplierAdapter = {
  async search(request, { credential }, signal, http) {
    const url = new URL("https://www.rutronik24.com/api/search/");
    url.searchParams.set("apikey", credential.secret);
    url.searchParams.set("searchterm", request.text);
    const answer = await partsJson(url, { headers: { Accept: "application/json" } }, signal, http);
    if (!Array.isArray(answer)) return unexpected();
    const { items, skipped } = collect(
      answer,
      (part) => ({
        manufacturer: text(part.manufacturer, 120),
        mpn: text(part.mpn, 64) ?? "",
        package: text(part.package, 80),
        description: text(part.description),
        lifecycle: null,
        datasheetUrl: null,
        parameters: [],
        offer: {
          sku: text(part.sku, 64) ?? "",
          packaging: text(part.packaging, 80),
          stock: count(part.stock),
          moq: count(part.moq),
          multiple: count(part.pu),
          leadTime: count(part.leadtime) === null ? null : `${count(part.leadtime)} weeks`,
          currency: currency(part.currency),
          region: null,
          productUrl: link(part.url),
          priceBreaks: breaks(list(part.pricebreaks), (entry) => priceBreak(entry.quantity, entry.price)),
        },
      }),
      request.limit,
    );
    return { items, partial: skipped, errors: [] };
  },
};

export const partsAdapters: Record<PartsSupplierId, SupplierAdapter> = {
  mouser,
  digikey,
  tme,
  farnell,
  rutronik,
};
export type { SupplierAnswer };

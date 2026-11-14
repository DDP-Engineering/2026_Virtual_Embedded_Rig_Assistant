import { type PartsSearchSettings, partsSearchDefaults } from "@vera/shared";
import { describe, expect, it, vi } from "vitest";
import { createToolContext } from "../tools/context.js";
import { partsSearchTool } from "../tools/parts.js";
import {
  ConfiguredPartsProvider,
  officialPartsPlugin,
  PartsAccessBlocked,
  unavailablePartsTools,
} from "./configured.js";
import { PartsHttpError, partsJson, retryDelay } from "./http.js";
import { fitResult, groupDevices, type PartsSearchResult, price } from "./provider.js";

const KEY = "mouser-key-0123456789";
const DK = { id: "dk-client-id-abc", secret: "dk-client-secret-xyz" };
const TME = { id: "tme-token-0123456789abcdef", secret: "tme-secret-0123" };
const FARNELL = "farnell-key-abcdef012345";
const RUTRONIK = "rutronik-key-9876";
const now = () => new Date("2026-11-13T10:00:00.000Z");

type Route = (url: URL, init: RequestInit) => Response | Promise<Response>;
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
/** A fake supplier network: every request is recorded, unknown endpoints fail the test. */
function network(routes: Record<string, Route | Route[]>) {
  const calls: { url: URL; init: RequestInit }[] = [];
  const used = new Map<string, number>();
  const fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    const key = url.origin + url.pathname;
    const route = routes[key];
    if (!route) throw new Error(`unexpected request ${key}`);
    const index = used.get(key) ?? 0;
    used.set(key, index + 1);
    return (Array.isArray(route) ? route[Math.min(index, route.length - 1)]! : route)(url, init);
  }) as typeof globalThis.fetch;
  return {
    fetch,
    calls,
    count: (key: string) => calls.filter((call) => call.url.origin + call.url.pathname === key).length,
  };
}

const mouserParts = {
  Errors: [],
  SearchResults: {
    NumberOfResult: 2,
    Parts: [
      {
        Manufacturer: "Infineon Technologies",
        ManufacturerPartNumber: "BSS806NE H6327",
        Description: "MOSFET N-Ch 20V 2.3A SOT-23",
        DataSheetUrl: "https://www.mouser.com/datasheet/2/196/bss806ne.pdf",
        ProductDetailUrl: "https://www.mouser.ro/ProductDetail/726-BSS806NEH6327",
        MouserPartNumber: "726-BSS806NEH6327",
        AvailabilityInStock: "12000",
        Min: 1,
        Mult: 1,
        LeadTime: "12 Weeks",
        LifecycleStatus: null,
        ProductAttributes: [
          { AttributeName: "Packaging", AttributeValue: "Cut Tape" },
          { AttributeName: "Package / Case", AttributeValue: "SOT-23-3" },
          { AttributeName: "Vds - Drain-Source Breakdown Voltage", AttributeValue: "20 V" },
        ],
        PriceBreaks: [
          { Quantity: 1, Price: "0,42 €", Currency: "EUR" },
          { Quantity: 100, Price: "0,21 €", Currency: "EUR" },
        ],
      },
      { Manufacturer: "Nexperia", ManufacturerPartNumber: "", MouserPartNumber: "771-X" },
    ],
  },
};

function settings(
  enabled: Partial<Record<keyof PartsSearchSettings["suppliers"], boolean>>,
): PartsSearchSettings {
  const parts = structuredClone(partsSearchDefaults);
  for (const [id, on] of Object.entries(enabled))
    parts.suppliers[id as keyof typeof parts.suppliers].enabled = !!on;
  return { ...parts, country: "RO", language: "en", currency: "EUR", farnellStore: "ro.farnell.com" };
}
function provider(
  routes: Record<string, Route | Route[]>,
  options: {
    parts?: PartsSearchSettings;
    web?: boolean;
    credentials?: Record<string, { secret: string; id?: string }>;
    now?: () => Date;
    adapters?: ConstructorParameters<typeof ConfiguredPartsProvider>[0]["adapters"];
  } = {},
) {
  const net = network(routes);
  const state = { parts: options.parts ?? settings({ mouser: true }), webEnabled: options.web ?? true };
  const credentials = options.credentials ?? { mouser: { secret: KEY } };
  const instance = new ConfiguredPartsProvider({
    config: () => state,
    getCredential: async (supplier) => credentials[supplier],
    http: { fetch: net.fetch, sleep: async () => {} },
    now: options.now ?? now,
    ...(options.adapters ? { adapters: options.adapters } : {}),
  });
  return { provider: instance, net, state };
}
const MOUSER_KEYWORD = "https://api.mouser.com/api/v2/search/keywordandmanufacturer";
const DK_TOKEN = "https://api.digikey.com/v1/oauth2/token";
const DK_SEARCH = "https://api.digikey.com/products/v4/search/keyword";
const signal = () => new AbortController().signal;

describe("parts search transport", () => {
  it("contacts only the fixed supplier endpoints and maps HTTP failures to fixed messages", async () => {
    const net = network({});
    await expect(
      partsJson(new URL("https://api.mouser.com/api/v1/search"), {}, signal(), { fetch: net.fetch }),
    ).rejects.toMatchObject({ kind: "unavailable" });
    await expect(
      partsJson(new URL("https://user:pw@api.tme.eu/products/search"), {}, signal(), { fetch: net.fetch }),
    ).rejects.toMatchObject({ kind: "unavailable" });
    expect(net.calls).toHaveLength(0);
    const statuses: [number, string][] = [
      [401, "auth"],
      [403, "auth"],
      [500, "unavailable"],
      [302, "unavailable"],
    ];
    for (const [status, kind] of statuses) {
      const { fetch } = network({
        [MOUSER_KEYWORD]: () => json({ secret: KEY, url: `${MOUSER_KEYWORD}?apiKey=${KEY}` }, status),
      });
      const error = (await partsJson(new URL(`${MOUSER_KEYWORD}?apiKey=${KEY}`), {}, signal(), {
        fetch,
      }).catch((e: unknown) => e)) as PartsHttpError;
      expect(error).toBeInstanceOf(PartsHttpError);
      expect(error.kind).toBe(kind);
      expect(String(error.message)).not.toContain(KEY);
    }
    const redirect = network({
      [MOUSER_KEYWORD]: (_url, init) => {
        expect(init.redirect).toBe("error");
        throw new TypeError("fetch failed: redirect mode is set to error");
      },
    });
    await expect(
      partsJson(new URL(MOUSER_KEYWORD), {}, signal(), { fetch: redirect.fetch }),
    ).rejects.toMatchObject({ kind: "unavailable" });
  });
  it("refuses declared and streamed bodies over 4 MiB and answers that stall past the deadline", async () => {
    const big = network({
      [MOUSER_KEYWORD]: () => new Response("{}", { headers: { "content-length": String(5 * 1024 * 1024) } }),
    });
    await expect(
      partsJson(new URL(MOUSER_KEYWORD), {}, signal(), { fetch: big.fetch }),
    ).rejects.toMatchObject({ kind: "unavailable" });
    const chunk = new Uint8Array(1024 * 1024);
    const streamed = network({
      [MOUSER_KEYWORD]: () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              controller.enqueue(chunk);
            },
          }),
        ),
    });
    await expect(
      partsJson(new URL(MOUSER_KEYWORD), {}, signal(), { fetch: streamed.fetch }),
    ).rejects.toMatchObject({ kind: "unavailable" });
    const stall = network({
      [MOUSER_KEYWORD]: () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("{"));
            },
          }),
        ),
    });
    await expect(
      partsJson(new URL(MOUSER_KEYWORD), {}, signal(), { fetch: stall.fetch, timeoutMs: 50 }),
    ).rejects.toMatchObject({ kind: "timeout" });
  });
  it("retries a 429 once after a wait bounded to 5 s, then reports the rate limit", async () => {
    expect([
      retryDelay("120"),
      retryDelay("2"),
      retryDelay(null),
      retryDelay("Wed, 21 Oct 2026 07:28:00 GMT"),
    ]).toEqual([5000, 2000, 1000, 1000]);
    const waits: number[] = [];
    const sleep = async (ms: number) => void waits.push(ms);
    const once = network({
      [MOUSER_KEYWORD]: [() => json({}, 429, { "retry-after": "120" }), () => json({ ok: true })],
    });
    expect(await partsJson(new URL(MOUSER_KEYWORD), {}, signal(), { fetch: once.fetch, sleep })).toEqual({
      ok: true,
    });
    expect(waits).toEqual([5000]);
    const twice = network({ [MOUSER_KEYWORD]: () => json({}, 429) });
    await expect(
      partsJson(new URL(MOUSER_KEYWORD), {}, signal(), { fetch: twice.fetch, sleep }),
    ).rejects.toMatchObject({ kind: "rate-limited" });
    expect(twice.calls).toHaveLength(2);
  });
  it("reads supplier price texts only when their decimal separator is unambiguous", () => {
    expect([
      price("$0.10"),
      price("0,42 €"),
      price("1.234,56"),
      price("1,234.56"),
      price("1.234.567"),
      price("n/a"),
      price(0.5),
      price(-1),
    ]).toEqual([0.1, 0.42, 1234.56, 1234.56, null, null, 0.5, null]);
  });
});

describe("parts search suppliers", () => {
  it("maps a Mouser answer, leaves unstated values null, sends the key only in the query and marks skipped items partial", async () => {
    const { provider: parts, net } = provider({ [MOUSER_KEYWORD]: () => json(mouserParts) });
    const result = await parts.search({ query: "N-channel MOSFET SOT-23", limit: 5 }, signal());
    expect(result.suppliers).toEqual([
      expect.objectContaining({
        supplier: "mouser",
        status: "partial",
        items: 1,
        retrievedAt: "2026-11-13T10:00:00.000Z",
      }),
    ]);
    expect(result.devices).toEqual([
      {
        manufacturer: "Infineon Technologies",
        mpn: "BSS806NE H6327",
        package: "SOT-23-3",
        description: "MOSFET N-Ch 20V 2.3A SOT-23",
        lifecycle: null,
        datasheetUrl: "https://www.mouser.com/datasheet/2/196/bss806ne.pdf",
        parameters: [{ supplier: "mouser", name: "Vds - Drain-Source Breakdown Voltage", value: "20 V" }],
        offers: [
          {
            supplier: "mouser",
            sku: "726-BSS806NEH6327",
            packaging: "Cut Tape",
            stock: 12000,
            moq: 1,
            multiple: 1,
            leadTime: "12 Weeks",
            currency: "EUR",
            region: null,
            productUrl: "https://www.mouser.ro/ProductDetail/726-BSS806NEH6327",
            priceBreaks: [
              { quantity: 1, unitPrice: 0.42, text: "0,42 €" },
              { quantity: 100, unitPrice: 0.21, text: "0,21 €" },
            ],
            retrievedAt: "2026-11-13T10:00:00.000Z",
          },
        ],
      },
    ]);
    expect(result.notes.join(" ")).toMatch(/taxes, shipping/);
    expect(net.calls[0]!.url.searchParams.get("apiKey")).toBe(KEY);
    expect(String(net.calls[0]!.init.body)).not.toContain(KEY);
    expect(JSON.parse(String(net.calls[0]!.init.body))).toEqual({
      SearchByKeywordMfrNameRequest: {
        keyword: "N-channel MOSFET SOT-23",
        records: 5,
        pageNumber: 1,
        searchOptions: "None",
      },
    });
    expect(JSON.stringify(result)).not.toContain(KEY);
  });
  it("reports Mouser errors next to parts as partial and errors alone as failed with safe codes", async () => {
    const withParts = provider({
      [MOUSER_KEYWORD]: () => json({ ...mouserParts, Errors: [{ Code: "TooMany", Message: `bad ${KEY}` }] }),
    });
    expect((await withParts.provider.search({ query: "mosfet" }, signal())).suppliers[0]).toMatchObject({
      status: "partial",
    });
    const alone = provider({
      [MOUSER_KEYWORD]: () =>
        json({ Errors: [{ Code: `Invalid ${KEY}!`, Message: KEY }], SearchResults: null }),
    });
    const result = await alone.provider.search({ query: "mosfet" }, signal());
    expect(result.suppliers[0]).toMatchObject({ status: "failed", items: 0 });
    expect(JSON.stringify(result)).not.toContain(KEY);
  });
  it("maps DigiKey variations to offers in the locale's currency with a token from the client credentials", async () => {
    const { provider: parts, net } = provider(
      {
        [DK_TOKEN]: () => json({ access_token: "dk-access-token-1", expires_in: 600 }),
        [DK_SEARCH]: () =>
          json({
            SearchLocaleUsed: { Site: "RO", Language: "en", Currency: "EUR" },
            ExactMatches: [],
            Products: [
              {
                ManufacturerProductNumber: "BSS806NEH6327XTSA1",
                Manufacturer: { Name: "Infineon Technologies" },
                Description: { ProductDescription: "MOSFET N-CH 20V 2.3A SOT23-3" },
                ProductStatus: { Status: "Active" },
                DatasheetUrl: "//www.infineon.com/dgdl/bss806ne.pdf",
                ProductUrl: "https://www.digikey.ro/en/products/detail/x",
                Parameters: [
                  { ParameterText: "Package / Case", ValueText: "TO-236-3, SC-59, SOT-23-3" },
                  { ParameterText: "Rds On (Max) @ Id, Vgs", ValueText: "57mOhm @ 2.3A, 4.5V" },
                ],
                ProductVariations: [
                  {
                    DigiKeyProductNumber: "BSS806NEH6327XTSA1CT-ND",
                    PackageType: { Name: "Cut Tape (CT)" },
                    QuantityAvailableforPackageType: 5000,
                    MinimumOrderQuantity: 1,
                    StandardPricing: [
                      { BreakQuantity: 1, UnitPrice: 0.39 },
                      { BreakQuantity: 10, UnitPrice: 0.28 },
                    ],
                  },
                  {
                    DigiKeyProductNumber: "BSS806NEH6327XTSA1TR-ND",
                    PackageType: { Name: "Tape & Reel (TR)" },
                    QuantityAvailableforPackageType: 3000,
                    MinimumOrderQuantity: 3000,
                    StandardPricing: [{ BreakQuantity: 3000, UnitPrice: 0.071 }],
                  },
                ],
              },
            ],
          }),
      },
      { parts: settings({ digikey: true }), credentials: { digikey: DK } },
    );
    const result = await parts.search({ mpn: "BSS806NE" }, signal());
    expect(result.suppliers[0]).toMatchObject({ supplier: "digikey", status: "ok", items: 2 });
    expect(result.devices).toHaveLength(1);
    expect(result.devices[0]).toMatchObject({
      package: "TO-236-3, SC-59, SOT-23-3",
      lifecycle: "Active",
      datasheetUrl: "https://www.infineon.com/dgdl/bss806ne.pdf",
    });
    expect(
      result.devices[0]!.offers.map((offer) => [
        offer.sku,
        offer.packaging,
        offer.currency,
        offer.region,
        offer.priceBreaks.length,
      ]),
    ).toEqual([
      ["BSS806NEH6327XTSA1CT-ND", "Cut Tape (CT)", "EUR", "RO", 2],
      ["BSS806NEH6327XTSA1TR-ND", "Tape & Reel (TR)", "EUR", "RO", 1],
    ]);
    const token = new URLSearchParams(String(net.calls[0]!.init.body));
    expect([token.get("grant_type"), token.get("client_id"), token.get("client_secret")]).toEqual([
      "client_credentials",
      DK.id,
      DK.secret,
    ]);
    const headers = net.calls[1]!.init.headers as Record<string, string>;
    expect([
      headers.Authorization,
      headers["X-DIGIKEY-Client-Id"],
      headers["X-DIGIKEY-Locale-Currency"],
    ]).toEqual(["Bearer dk-access-token-1", DK.id, "EUR"]);
    expect(net.calls[1]!.url.search).toBe("");
    for (const secret of [DK.secret, DK.id, "dk-access-token-1"])
      expect(JSON.stringify(result)).not.toContain(secret);
  });
  it("joins TME search and data answers, carries TME's notice and does not send a phrase over 40 characters", async () => {
    const { provider: parts, net } = provider(
      {
        "https://api.tme.eu/auth/token": () =>
          json({ access_token: "tme-access-1", token_type: "Bearer", expires_in: 300 }),
        "https://api.tme.eu/products/search": () =>
          json({
            status: "OK",
            data: {
              products: {
                elements: [
                  {
                    symbol: "BSS806NE",
                    manufacturer_symbols: ["BSS806NEH6327XTSA1"],
                    manufacturer: { name: "INFINEON TECHNOLOGIES" },
                    description: "Transistor: N-MOSFET",
                    minimal_amount: 5,
                    multiples: 5,
                    packing: { elements: [{ translation: "reel" }] },
                    product_status: [],
                  },
                ],
              },
            },
          }),
        "https://api.tme.eu/products/data": () =>
          json({
            status: "OK",
            data: {
              elements: [
                {
                  symbol: "BSS806NE",
                  stock_quantity: 2500,
                  prices: {
                    currency: "EUR",
                    type: "NET",
                    elements: [
                      { amount: 5, price: 0.25 },
                      { amount: 100, price: 0.11 },
                    ],
                  },
                },
              ],
            },
          }),
      },
      { parts: settings({ tme: true }), credentials: { tme: TME } },
    );
    const result = await parts.search({ query: "BSS806" }, signal());
    expect(result.suppliers[0]).toMatchObject({
      supplier: "tme",
      status: "ok",
      items: 1,
      notice: expect.stringContaining("powered by TME.eu Data"),
    });
    expect(result.devices[0]).toMatchObject({
      mpn: "BSS806NEH6327XTSA1",
      manufacturer: "INFINEON TECHNOLOGIES",
    });
    expect(result.devices[0]!.offers[0]).toMatchObject({
      sku: "BSS806NE",
      stock: 2500,
      moq: 5,
      multiple: 5,
      currency: "EUR",
      region: "RO",
      packaging: "reel",
    });
    expect(net.calls[0]!.init.headers).toMatchObject({
      Authorization: `Basic ${Buffer.from(`${TME.id}:${TME.secret}`).toString("base64")}`,
    });
    expect(net.calls[2]!.url.searchParams.getAll("symbols[]")).toEqual(["BSS806NE"]);
    const long = await parts.search(
      { query: "N-channel logic level MOSFET 30 V 5 A SOT-23 package" },
      signal(),
    );
    expect(long.suppliers[0]).toMatchObject({
      status: "failed",
      message: expect.stringContaining("phrase-over-40-characters"),
    });
    expect(net.count("https://api.tme.eu/products/search")).toBe(1);
  });
  it("maps Farnell (no stated currency) and Rutronik (numeric strings) answers", async () => {
    const { provider: parts, net } = provider(
      {
        "https://api.element14.com/catalog/products": () =>
          json({
            manufacturerPartNumberSearchReturn: {
              numberOfResults: 1,
              products: [
                {
                  sku: "2432707",
                  displayName: "MOSFET, N-CH, 20V",
                  brandName: "INFINEON",
                  translatedManufacturerPartNumber: "BSS806NEH6327XTSA1",
                  packSize: 1,
                  unitOfMeasure: "EACH",
                  translatedMinimumOrderQuality: 5,
                  stock: { level: 900 },
                  prices: [{ from: 5, to: 99, cost: 0.31 }],
                  datasheets: [{ url: "https://www.farnell.com/datasheets/1.pdf" }],
                  attributes: [
                    { attributeLabel: "Drain Source Voltage Vds", attributeValue: "20", attributeUnit: "V" },
                  ],
                },
              ],
            },
          }),
        "https://www.rutronik24.com/api/search/": () =>
          json([
            {
              sku: "TRMOS1",
              manufacturer: "INFINEON",
              mpn: "BSS806NEH6327XTSA1",
              package: "SOT23",
              packaging: "REEL",
              url: "https://www.rutronik24.com/product/x.html",
              pu: "3000",
              moq: "3000",
              stock: "185865",
              leadtime: 18,
              currency: "EUR",
              pricebreaks: [{ quantity: "3000", price: "0.0719" }],
            },
          ]),
      },
      {
        parts: settings({ farnell: true, rutronik: true }),
        credentials: { farnell: { secret: FARNELL }, rutronik: { secret: RUTRONIK } },
      },
    );
    const result = await parts.search({ mpn: "BSS806NEH6327XTSA1" }, signal());
    expect(result.suppliers.map((s) => [s.supplier, s.status])).toEqual([
      ["farnell", "ok"],
      ["rutronik", "ok"],
    ]);
    expect(result.devices).toHaveLength(1);
    const [farnell, rutronik] = result.devices[0]!.offers;
    expect(farnell).toMatchObject({
      sku: "2432707",
      currency: null,
      region: "ro.farnell.com",
      stock: 900,
      moq: 5,
      packaging: "1 EACH",
    });
    expect(rutronik).toMatchObject({
      sku: "TRMOS1",
      currency: "EUR",
      stock: 185865,
      multiple: 3000,
      leadTime: "18 weeks",
      priceBreaks: [{ quantity: 3000, unitPrice: 0.0719 }],
    });
    const farnellUrl = net.calls.find((call) => call.url.hostname === "api.element14.com")!.url;
    expect([farnellUrl.searchParams.get("term"), farnellUrl.searchParams.get("storeInfo.id")]).toEqual([
      "manuPartNum:BSS806NEH6327XTSA1",
      "ro.farnell.com",
    ]);
    for (const secret of [FARNELL, RUTRONIK]) expect(JSON.stringify(result)).not.toContain(secret);
  });
});

describe("parts search access", () => {
  it("refuses while Web access, the plugin or every supplier is off and never sends a request", async () => {
    for (const [options, allowed] of [
      [{ web: false }, true],
      [{ parts: settings({}) }, true],
      [{}, false],
    ] as const) {
      const { provider: parts, net } = provider({ [MOUSER_KEYWORD]: () => json(mouserParts) }, options);
      await expect(parts.search({ query: "mosfet" }, signal(), async () => allowed)).rejects.toBeInstanceOf(
        PartsAccessBlocked,
      );
      expect(net.calls).toHaveLength(0);
    }
    const late = provider({ [MOUSER_KEYWORD]: () => json(mouserParts) });
    let checks = 0;
    await expect(
      late.provider.search({ query: "mosfet" }, signal(), async () => ++checks === 1),
    ).rejects.toMatchObject({ reason: "cancelled" });
    expect([checks, late.net.calls.length]).toEqual([2, 0]);
    expect(unavailablePartsTools(true, settings({ mouser: true }), true)).toEqual([]);
    const plugin = (id: string, tier: "official" | "local" | "trial") =>
      ({ manifest: { id }, record: { tier } }) as unknown as Parameters<typeof officialPartsPlugin>[0];
    expect(
      [
        plugin("parts-search", "official"),
        plugin("parts-search", "local"),
        plugin("parts-search", "trial"),
        plugin("kicad", "official"),
      ].map(officialPartsPlugin),
    ).toEqual([true, false, false, false]);
    expect(unavailablePartsTools(false, settings({ mouser: true }), true)).toEqual(["parts_search"]);
    expect(unavailablePartsTools(true, settings({}), true)).toEqual(["parts_search"]);
    expect(unavailablePartsTools(true, settings({ mouser: true }), false)).toEqual(["parts_search"]);
  });
  it("reports an enabled supplier without a credential as key-required without contacting it", async () => {
    const { provider: parts, net } = provider(
      { [MOUSER_KEYWORD]: () => json(mouserParts) },
      { parts: settings({ mouser: true, digikey: true }) },
    );
    const result = await parts.search({ query: "mosfet" }, signal());
    expect(result.suppliers.map((s) => [s.supplier, s.status])).toEqual([
      ["mouser", "partial"],
      ["digikey", "key-required"],
    ]);
    expect(net.calls.every((call) => call.url.hostname === "api.mouser.com")).toBe(true);
  });
  it("shares one token request between concurrent searches, reuses it, refreshes it once on 401 and reports a second 401 as auth", async () => {
    let tokens = 0;
    const answer = { SearchLocaleUsed: { Currency: "EUR" }, Products: [] };
    const searches: Route[] = [
      () => json(answer),
      () => json(answer),
      () => json(answer),
      () => json({}, 401),
      () => json(answer),
      () => json({}, 401),
    ];
    const { provider: parts, net } = provider(
      {
        [DK_TOKEN]: async () => {
          tokens++;
          await new Promise((resolve) => setTimeout(resolve, 10));
          return json({ access_token: `token-${tokens}`, expires_in: 600 });
        },
        [DK_SEARCH]: searches,
      },
      { parts: settings({ digikey: true }), credentials: { digikey: DK } },
    );
    await Promise.all([parts.search({ query: "a b" }, signal()), parts.search({ query: "c d" }, signal())]);
    expect(tokens).toBe(1);
    await parts.search({ query: "e f" }, signal());
    expect(tokens).toBe(1);
    expect((await parts.search({ query: "g h" }, signal())).suppliers[0]).toMatchObject({ status: "ok" });
    expect(tokens).toBe(2);
    const auth = net.calls.at(-1)!.init.headers as Record<string, string>;
    expect(auth.Authorization).toBe("Bearer token-2");
    const refused = provider(
      { [DK_TOKEN]: () => json({ access_token: "t", expires_in: 600 }), [DK_SEARCH]: () => json({}, 401) },
      { parts: settings({ digikey: true }), credentials: { digikey: DK } },
    );
    expect((await refused.provider.search({ query: "a b" }, signal())).suppliers[0]).toMatchObject({
      status: "auth",
    });
    expect(refused.net.count(DK_TOKEN)).toBe(2);
    expect(refused.net.count(DK_SEARCH)).toBe(2);
  });
  it("aborts requests in flight on revocation, cancellation and close, and drops cached tokens", async () => {
    let release: (() => void) | undefined;
    const held: Route = (_url, init) =>
      new Promise((_resolve, reject) => {
        release = () => reject(new Error("never"));
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      });
    const { provider: parts, net } = provider(
      {
        [DK_TOKEN]: () => json({ access_token: "t1", expires_in: 600 }),
        [DK_SEARCH]: [() => json({ Products: [] }), held, held, held],
      },
      { parts: settings({ digikey: true }), credentials: { digikey: DK } },
    );
    await parts.search({ query: "first" }, signal());
    const revoked = parts.search({ query: "held" }, signal());
    await vi.waitFor(() => expect(net.count(DK_SEARCH)).toBe(2));
    parts.revoke();
    await expect(revoked).rejects.toMatchObject({ reason: "cancelled" });
    const controller = new AbortController();
    const cancelled = parts.search({ query: "held" }, controller.signal);
    await vi.waitFor(() => expect(net.count(DK_SEARCH)).toBe(3));
    expect(net.count(DK_TOKEN)).toBe(2);
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ reason: "cancelled" });
    const closing = parts.search({ query: "held" }, signal());
    await vi.waitFor(() => expect(net.count(DK_SEARCH)).toBe(4));
    await parts.close();
    await expect(closing).rejects.toMatchObject({ reason: "cancelled" });
    release?.();
    await expect(parts.search({ query: "after" }, signal())).rejects.toMatchObject({ reason: "disabled" });
  });
  it("redacts a credential a supplier echoes inside a result", async () => {
    const echoed = structuredClone(mouserParts);
    echoed.SearchResults.Parts[0]!.Description = `MOSFET ${KEY}`;
    const { provider: parts } = provider({ [MOUSER_KEYWORD]: () => json(echoed) });
    const result = await parts.search({ query: "mosfet" }, signal());
    expect(JSON.stringify(result)).not.toContain(KEY);
    expect(result.devices[0]!.description).toBe("MOSFET [redacted]");
  });
  it("groups offers of one MPN whose manufacturers share their first word, and nothing else", () => {
    const item = (manufacturer: string, mpn: string, sku: string) => ({
      manufacturer,
      mpn,
      package: null,
      description: null,
      lifecycle: null,
      datasheetUrl: null,
      parameters: [],
      offer: {
        sku,
        packaging: null,
        stock: null,
        moq: null,
        multiple: null,
        leadTime: null,
        currency: null,
        region: null,
        productUrl: null,
        priceBreaks: [],
      },
    });
    const devices = groupDevices([
      {
        supplier: "mouser",
        retrievedAt: "t",
        items: [
          item("Infineon Technologies", "BSS806NE H6327", "726-CT"),
          item("Texas Instruments", "TPS7A02", "595-A"),
        ],
      },
      {
        supplier: "rutronik",
        retrievedAt: "t",
        items: [
          item("INFINEON", "bss806ne h6327", "TR-1"),
          item("Infineon", "BSS806NE H6327-P", "TR-2"),
          item("TI", "TPS7A02", "TR-3"),
        ],
      },
    ]);
    expect(devices.map((device) => [device.mpn, device.offers.map((offer) => offer.sku)])).toEqual([
      ["BSS806NE H6327", ["726-CT", "TR-1"]],
      ["TPS7A02", ["595-A"]],
      ["BSS806NE H6327-P", ["TR-2"]],
      ["TPS7A02", ["TR-3"]],
    ]);
  });
  it("tests one supplier with its stored credential and needs only Web access", async () => {
    const ok = provider({ [MOUSER_KEYWORD]: () => json(mouserParts) }, { parts: settings({}) });
    expect(await ok.provider.test("mouser", signal())).toMatchObject({
      supplier: "mouser",
      status: "ok",
      items: 1,
    });
    const missing = provider({}, { credentials: {} });
    expect(await missing.provider.test("mouser", signal())).toMatchObject({ status: "key-required" });
    const off = provider({}, { web: false });
    await expect(off.provider.test("mouser", signal())).rejects.toMatchObject({ reason: "disabled" });
  });
});

const FARNELL_URL = "https://api.element14.com/catalog/products";
const RUTRONIK_URL = "https://www.rutronik24.com/api/search/";
const TME_SEARCH = "https://api.tme.eu/products/search";
const TME_TOKEN = "https://api.tme.eu/auth/token";
const part = (mpn: string, sku: string, extra: Record<string, unknown> = {}) => ({
  Manufacturer: "Fictional Semi",
  ManufacturerPartNumber: mpn,
  MouserPartNumber: sku,
  ...extra,
});
const held: Route = (_url, init) =>
  new Promise((_resolve, reject) =>
    init.signal?.addEventListener("abort", () => reject(init.signal?.reason)),
  );

describe("parts search review cases", () => {
  it("refuses arguments outside the contract before any request", async () => {
    const { provider: parts, net } = provider({ [MOUSER_KEYWORD]: () => json(mouserParts) });
    for (const args of [
      { query: "mosfet", mpn: "BSS806" },
      {},
      { query: "mosfet", limit: 21 },
      { mpn: "BSS|806" },
      { mpn: "B" },
      { query: "x" },
      { mpn: " BSS" },
    ])
      await expect(parts.search(args, signal()), JSON.stringify(args)).rejects.toThrow();
    expect(net.calls).toHaveLength(0);
    expect((await parts.search({ mpn: "BS" }, signal())).search).toEqual({ by: "mpn", text: "BS", limit: 5 });
  });
  it("leaves values a supplier did not state null and keeps two currencies apart", async () => {
    const { provider: parts } = provider(
      {
        [MOUSER_KEYWORD]: () =>
          json({
            Errors: [],
            SearchResults: {
              Parts: [
                part("FS1", "M-1", { PriceBreaks: [{ Quantity: 1, Price: "0,10 €", Currency: "EUR" }] }),
              ],
            },
          }),
        [RUTRONIK_URL]: () =>
          json([
            {
              sku: "R-1",
              manufacturer: "FICTIONAL",
              mpn: "FS2",
              currency: "USD",
              pricebreaks: [{ quantity: 1, price: 0.2 }],
            },
          ]),
      },
      {
        parts: settings({ mouser: true, rutronik: true }),
        credentials: { mouser: { secret: KEY }, rutronik: { secret: RUTRONIK } },
      },
    );
    const result = await parts.search({ query: "fs" }, signal());
    expect(
      result.devices.map((device) => [
        device.mpn,
        device.package,
        device.datasheetUrl,
        device.offers[0]?.stock,
        device.offers[0]?.moq,
        device.offers[0]?.currency,
      ]),
    ).toEqual([
      ["FS1", null, null, null, null, "EUR"],
      ["FS2", null, null, null, null, "USD"],
    ]);
    expect(result.suppliers.find((s) => s.supplier === "mouser")).not.toHaveProperty("notice");
  });
  it("reports errors next to readable parts as partial with every readable part", async () => {
    const { provider: parts } = provider({
      [MOUSER_KEYWORD]: () =>
        json({
          Errors: [{ Code: "Warning" }],
          SearchResults: { Parts: [part("FS1", "M-1"), part("FS2", "M-2")] },
        }),
    });
    const result = await parts.search({ query: "fs" }, signal());
    expect(result.suppliers[0]).toMatchObject({
      status: "partial",
      items: 2,
      message: expect.stringContaining("Warning"),
    });
  });
  it("reports an answer that is not the supplier's documented shape as failed, never as nothing found", async () => {
    const cases: [string, Record<string, Route>, Record<string, { secret: string; id?: string }>][] = [
      ["mouser", { [MOUSER_KEYWORD]: () => json({}) }, { mouser: { secret: KEY } }],
      [
        "mouser",
        {
          [MOUSER_KEYWORD]: () =>
            json({ Errors: [{ Message: "Invalid unique identifier." }], SearchResults: null }),
        },
        { mouser: { secret: KEY } },
      ],
      [
        "digikey",
        {
          [DK_TOKEN]: () => json({ access_token: "t", expires_in: 600 }),
          [DK_SEARCH]: () => json({ detail: "x" }),
        },
        { digikey: DK },
      ],
      [
        "tme",
        {
          [TME_TOKEN]: () => json({ access_token: "t", expires_in: 300 }),
          [TME_SEARCH]: () => json({ status: "E_INPUT_PARAMS_VALIDATION_ERROR" }),
        },
        { tme: TME },
      ],
      ["farnell", { [FARNELL_URL]: () => json({ Fault: {} }) }, { farnell: { secret: FARNELL } }],
      ["rutronik", { [RUTRONIK_URL]: () => json({ error: "x" }) }, { rutronik: { secret: RUTRONIK } }],
    ];
    for (const [supplier, routes, credentials] of cases) {
      const { provider: parts } = provider(routes, { parts: settings({ [supplier]: true }), credentials });
      const result = await parts.search({ query: "fs" }, signal());
      expect(result.suppliers[0], supplier).toMatchObject({ supplier, status: "failed", items: 0 });
    }
  });
  it("reports refused Farnell and Rutronik keys as auth after one request, and refreshes a TME token once", async () => {
    for (const [supplier, url, credentials] of [
      ["farnell", FARNELL_URL, { farnell: { secret: FARNELL } }],
      ["rutronik", RUTRONIK_URL, { rutronik: { secret: RUTRONIK } }],
    ] as const) {
      const { provider: parts, net } = provider(
        { [url]: () => json({}, 403) },
        { parts: settings({ [supplier]: true }), credentials },
      );
      expect((await parts.search({ query: "fs" }, signal())).suppliers[0]).toMatchObject({ status: "auth" });
      expect(net.calls).toHaveLength(1);
    }
    const ok = { status: "OK", data: { products: { elements: [] } } };
    const { provider: parts, net } = provider(
      {
        [TME_TOKEN]: () => json({ access_token: `tme-${net.count(TME_TOKEN)}`, expires_in: 300 }),
        [TME_SEARCH]: [() => json({}, 401), () => json(ok)],
      },
      { parts: settings({ tme: true }), credentials: { tme: TME } },
    );
    expect((await parts.search({ query: "fs" }, signal())).suppliers[0]).toMatchObject({ status: "ok" });
    expect([net.count(TME_TOKEN), net.count(TME_SEARCH)]).toEqual([2, 2]);
  });
  it("requests a new token only inside the last 60 s before expiry", async () => {
    let clock = Date.parse("2026-11-13T10:00:00Z");
    const { provider: parts, net } = provider(
      {
        [DK_TOKEN]: () => json({ access_token: `dk-${net.count(DK_TOKEN)}`, expires_in: 600 }),
        [DK_SEARCH]: () => json({ Products: [] }),
      },
      { parts: settings({ digikey: true }), credentials: { digikey: DK }, now: () => new Date(clock) },
    );
    await parts.search({ query: "fs" }, signal());
    clock += 539_000;
    await parts.search({ query: "fs" }, signal());
    expect(net.count(DK_TOKEN)).toBe(1);
    clock += 2_000;
    await parts.search({ query: "fs" }, signal());
    expect(net.count(DK_TOKEN)).toBe(2);
  });
  it("cancels every supplier request of a call, and a failing supplier ends its siblings", async () => {
    const both = provider(
      { [MOUSER_KEYWORD]: held, [RUTRONIK_URL]: held },
      {
        parts: settings({ mouser: true, rutronik: true }),
        credentials: { mouser: { secret: KEY }, rutronik: { secret: RUTRONIK } },
      },
    );
    const controller = new AbortController();
    const pending = both.provider.search({ query: "fs" }, controller.signal);
    await vi.waitFor(() => expect(both.net.calls).toHaveLength(2));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ reason: "cancelled" });
    expect(both.net.calls.every((call) => call.init.signal?.aborted)).toBe(true);
    let sibling: AbortSignal | undefined;
    const failing = provider(
      {
        [MOUSER_KEYWORD]: (url, init) => {
          sibling = init.signal ?? undefined;
          return held(url, init);
        },
      },
      {
        parts: settings({ mouser: true, rutronik: true }),
        credentials: { mouser: { secret: KEY }, rutronik: { secret: RUTRONIK } },
        adapters: {
          rutronik: {
            async search() {
              await vi.waitFor(() => expect(sibling).toBeDefined());
              throw new Error("adapter defect");
            },
          },
        },
      },
    );
    await expect(failing.provider.search({ query: "fs" }, signal())).rejects.toThrow("adapter defect");
    expect(sibling?.aborted).toBe(true);
  });
  it("fits a large result under the tool cap and keeps devices of every supplier", () => {
    const offer = (supplier: "mouser" | "rutronik", index: number) => ({
      supplier,
      sku: `${supplier}-${index}`,
      packaging: "Cut Tape",
      stock: 1,
      moq: 1,
      multiple: 1,
      leadTime: null,
      currency: "EUR",
      region: null,
      productUrl: `https://example.com/${"p".repeat(200)}`,
      priceBreaks: Array.from({ length: 10 }, (_, n) => ({ quantity: n + 1, unitPrice: 1, text: "1,00 €" })),
      retrievedAt: "t",
    });
    const device = (supplier: "mouser" | "rutronik", index: number) => ({
      manufacturer: "Fictional",
      mpn: `${supplier}-${index}`,
      package: null,
      description: "d".repeat(300),
      lifecycle: null,
      datasheetUrl: null,
      parameters: Array.from({ length: 30 }, (_, n) => ({
        supplier,
        name: `Parameter ${n}`,
        value: "v".repeat(100),
      })),
      offers: [offer(supplier, index)],
    });
    const devices = Array.from({ length: 20 }, (_, n) => [device("mouser", n), device("rutronik", n)]).flat();
    const result = fitResult({
      kind: "parts-search-result",
      search: { by: "keyword", text: "x", limit: 20 },
      retrievedAt: "t",
      suppliers: [],
      devices,
      truncated: false,
      notes: [],
    } as PartsSearchResult);
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(30000);
    expect(result.truncated).toBe(true);
    expect(result.notes.at(-1)).toMatch(/left out to fit/);
    expect(new Set(result.devices.map((entry) => entry.offers[0]?.supplier))).toEqual(
      new Set(["mouser", "rutronik"]),
    );
  });
  it("refuses a call through a tool bound before Web access was turned off", async () => {
    const { provider: parts, net, state } = provider({ [MOUSER_KEYWORD]: () => json(mouserParts) });
    const ctx = createToolContext("unused");
    ctx.parts = { search: (args, abort) => parts.search(args, abort, async () => true) };
    expect(await partsSearchTool.execute(ctx, { query: "mosfet" }, signal())).toMatchObject({
      kind: "parts-search-result",
    });
    state.webEnabled = false;
    await expect(partsSearchTool.execute(ctx, { query: "mosfet" }, signal())).rejects.toMatchObject({
      reason: "disabled",
    });
    expect(net.calls).toHaveLength(1);
  });
  it("accepts documented zero-result answers as ok", async () => {
    for (const [supplier, routes, credentials] of [
      [
        "mouser",
        { [MOUSER_KEYWORD]: () => json({ Errors: [], SearchResults: { NumberOfResult: 0, Parts: null } }) },
        { mouser: { secret: KEY } },
      ],
      [
        "mouser",
        { [MOUSER_KEYWORD]: () => json({ Errors: [], SearchResults: { NumberOfResult: 0, Parts: [] } }) },
        { mouser: { secret: KEY } },
      ],
      [
        "farnell",
        { [FARNELL_URL]: () => json({ keywordSearchReturn: { numberOfResults: "0" } }) },
        { farnell: { secret: FARNELL } },
      ],
      [
        "farnell",
        { [FARNELL_URL]: () => json({ keywordSearchReturn: { numberOfResults: 0, products: [] } }) },
        { farnell: { secret: FARNELL } },
      ],
    ] as const) {
      const { provider: parts } = provider(routes, { parts: settings({ [supplier]: true }), credentials });
      expect((await parts.search({ query: "nothing" }, signal())).suppliers[0], supplier).toMatchObject({
        supplier,
        status: "ok",
        items: 0,
      });
    }
  });
  it("reports a second TME 401 after the refresh as auth", async () => {
    const { provider: parts, net } = provider(
      {
        [TME_TOKEN]: () => json({ access_token: "tme-1", expires_in: 300 }),
        [TME_SEARCH]: () => json({}, 401),
      },
      { parts: settings({ tme: true }), credentials: { tme: TME } },
    );
    expect((await parts.search({ query: "fs" }, signal())).suppliers[0]).toMatchObject({ status: "auth" });
    expect([net.count(TME_TOKEN), net.count(TME_SEARCH)]).toEqual([2, 2]);
  });
  it("takes each supplier's items in turn when listing devices", () => {
    const item = (mpn: string) => ({
      manufacturer: "Fictional",
      mpn,
      package: null,
      description: null,
      lifecycle: null,
      datasheetUrl: null,
      parameters: [],
      offer: {
        sku: mpn,
        packaging: null,
        stock: null,
        moq: null,
        multiple: null,
        leadTime: null,
        currency: null,
        region: null,
        productUrl: null,
        priceBreaks: [],
      },
    });
    const devices = groupDevices([
      { supplier: "mouser", retrievedAt: "t", items: [item("M1"), item("M2"), item("M3")] },
      { supplier: "digikey", retrievedAt: "t", items: [item("D1")] },
      { supplier: "rutronik", retrievedAt: "t", items: [item("R1"), item("R2")] },
    ]);
    expect(devices.map((device) => device.mpn)).toEqual(["M1", "D1", "R1", "M2", "R2", "M3"]);
  });
});

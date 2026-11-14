# REQ-DATA-9fd50acb — Parts search: tool contract, supplier mapping, access gate and errors

VERA's first-party catalog capability for the official plugin `parts-search`. The host owns the supplier
credentials and the HTTP calls; the agent reaches them only through the read tool `parts_search`, and plugin
programs never receive a credential or a network endpoint. API contracts were read from the suppliers' public
documentation on 2026-11-12/13 (Mouser Search API v2, DigiKey Product Information v4, TME API v2, element14
Product Search API, Rutronik Shop API manual v1.3 of 21.11.2023); behaviour the documents do not state is marked
"not confirmed" and is settled by the live probes.

## 1 Suppliers and credentials

| Id | Name | Credential (credential store id `parts:<id>`) | Region inputs |
|---|---|---|---|
| `mouser` | Mouser | API key | none (the account decides) |
| `digikey` | DigiKey | client id + client secret | country, language, currency |
| `tme` | TME | API token + application secret | country, language, currency |
| `farnell` | Farnell / element14 | API key | store id (`storeInfo.id`, such as `uk.farnell.com`) |
| `rutronik` | Rutronik | API key | none |

- Stored as `{type: "api_key", key: <secret>}`; a two-part credential adds `env: {id: <client id or token>}`.
- A key, secret, client id or token is 1..4096 printable ASCII characters without spaces (`[!-~]`).
- Settings `partsSearch` (format of the settings file unchanged): `suppliers.<id>.enabled` (default false for
  every supplier), `country` (2 letters, default `US`), `language` (2 letters, default `en`), `currency`
  (3 letters, default `USD`), `farnellStore` (3..64 characters of `[a-z0-9.-]`, starting and ending with a letter or digit, default
  `uk.farnell.com`).
- The command-line interface reads `MOUSER_API_KEY`, `DIGIKEY_CLIENT_ID` + `DIGIKEY_CLIENT_SECRET`,
  `TME_API_TOKEN` + `TME_API_SECRET`, `FARNELL_API_KEY`, `RUTRONIK_API_KEY` into memory-only credential slots; a
  supplier whose variables are all present is enabled for that run, others are not. Region inputs come from the
  CLI's settings.

## 2 Access gate

`parts_search` is offered to the model only while all hold, and every call checks them again before and after
it resolves a credential:

1. global Web access is enabled (`settings.webAccess.enabled`);
2. the open workbench has the plugin `parts-search` enabled, installed from the official catalog tier, valid and
   unchanged since review (the workbench's loaded plugins);
3. at least one supplier is enabled in `partsSearch`.

A call refused by the gate fails with "Parts search is unavailable. Enable Web access and the official
parts-search plugin for this workbench, and enable a supplier in Settings > Parts search." Saving the parts
settings, removing a credential, changing Web access or closing the host aborts the calls in flight; they fail
with "Parts search request cancelled or its authorization changed." Settings > Parts search "Test" runs one
keyword search (`resistor`, limit 1) for one supplier with its stored credential and needs only gate rule 1.

## 3 Tool `parts_search` (class `read`)

Arguments (strict): exactly one of `query` (keyword text, 2..200 characters on one line) and `mpn` (a manufacturer
or supplier part number, 2..64 printable ASCII characters, no `|`, not starting or ending with a space);
`supplier`: a supplier id or `all` (default `all`: every enabled supplier); `limit`: 1..20 results per supplier
(default 5). Only the query text or part number, the limit and the region inputs leave VERA.

Result (JSON, returned to the model):

```json
{
  "kind": "parts-search-result",
  "search": {"by": "keyword", "text": "N-channel MOSFET 30 V SOT-23", "limit": 5},
  "retrievedAt": "2026-11-13T10:00:00.000Z",
  "suppliers": [
    {"supplier": "mouser", "status": "ok", "retrievedAt": "...", "items": 5},
    {"supplier": "tme", "status": "partial", "retrievedAt": "...", "items": 3,
     "message": "...", "notice": "powered by TME.eu Data; no guarantee of data accuracy; ..."},
    {"supplier": "digikey", "status": "key-required", "items": 0, "message": "..."}
  ],
  "devices": [
    {"manufacturer": "...", "mpn": "...", "package": "SOT-23" , "description": "...", "lifecycle": null,
     "datasheetUrl": "https://...", "parameters": [{"supplier": "mouser", "name": "Vds", "value": "30 V"}],
     "offers": [
       {"supplier": "mouser", "sku": "...", "packaging": "Cut Tape", "stock": 1200, "moq": 1, "multiple": 1,
        "leadTime": null, "currency": "EUR", "region": null, "productUrl": "https://...",
        "priceBreaks": [{"quantity": 1, "unitPrice": 0.42, "text": "0,42 €"}], "retrievedAt": "..."}
     ]}
  ],
  "truncated": false,
  "notes": ["..."]
}
```

- Supplier `status`: `ok`; `partial` (the supplier answered with errors next to results, or some of its items
  could not be read and were left out); `failed` (it answered with errors only - Mouser errors without a code count as `supplier-error` - or with a
  body that is not its documented shape, code `unexpected-answer`); `key-required` (no stored credential); `auth` (401 or 403, after one token refresh for
  DigiKey and TME); `rate-limited` (429 after the one retry); `timeout` (no complete answer within 30 s);
  `unavailable` (any other HTTP status, a connection failure or an answer over 4 MiB). `message` is a fixed text
  per status (never a response body, URL or credential); `failed` may name supplier error codes reduced to
  `[A-Za-z0-9_.-]{1,40}`, at most 5.
- The call fails as a whole only when the gate refuses it, the caller cancels it, a revocation ends it, or an
  internal error occurs (a credential that cannot be read, a defect) - then every supplier request of the call is
  aborted; every supplier failure is that supplier's status, and the other suppliers' results are still returned.
- A supplier's documented zero-result answer (Mouser `NumberOfResult: 0`, Farnell `numberOfResults: 0`, as a number or
  a numeric text) is `ok` with no item.
- A field the supplier did not send, or sent in a form that cannot be read, is `null` (a list is empty) - never
  0, never guessed. `stock` is the supplier's declared quantity; `leadTime` is its text (Rutronik: `<n> weeks`).
- `priceBreaks` keep the supplier's text in `text` and its number in `unitPrice` (`null` when the text cannot be
  read: a number is read when it has one decimal separator - a comma or point - or when both appear and the last
  one is the decimal separator). `currency` is the ISO code the supplier stated (Farnell states none: `null`).
- Devices: offers of one MPN (compared without letter case and surrounding space) whose manufacturers share their
  first alphanumeric word (lowercase) form one device; anything else stays a separate device. `package`,
  `description`, `lifecycle` and `datasheetUrl` come from the first offer that states them.
- URLs (`datasheetUrl`, `productUrl`) are kept only when they are absolute `https:` (or `http:`) URLs without
  credentials (a protocol-relative `//host/...` is read as `https:`); others are `null`. Text fields are cut to 300 characters, parameter values to 120; a device keeps at
  most 30 parameters and an offer 10 price breaks.
- Devices are listed taking each supplier's items in turn. The result stays within 30 000 JSON characters (the
  registry caps a tool result at 32 000): over that, supplier parameters are cut to 10 per device and then to none,
  price breaks to 3 per offer, and devices are dropped from the end; `truncated` is then true and a note says so.
- `notes` always says that offers are the suppliers' declared values at `retrievedAt`, that taxes, shipping and
  future availability are not included, and that supplier parameters are unconfirmed until checked in the
  manufacturer's datasheet. TME results carry TME's notice (TME API terms 2026-07-01, s.8.7-8.8).
- No result is cached or stored by VERA (supplier terms: Farnell s.4(A), TME s.8.6, DigiKey s.5.1); every call
  is live.

## 4 HTTP rules

- Destinations, exact origin and path (no others, no redirects, no user name, password or fragment):
  `https://api.mouser.com/api/v2/search/keywordandmanufacturer`,
  `https://api.mouser.com/api/v2/search/partnumberandmanufacturer`,
  `https://api.digikey.com/v1/oauth2/token`, `https://api.digikey.com/products/v4/search/keyword`,
  `https://api.tme.eu/auth/token`, `https://api.tme.eu/products/search`, `https://api.tme.eu/products/data`,
  `https://api.element14.com/catalog/products`, `https://www.rutronik24.com/api/search/`.
- 30 s per request including the body; at most 4 MiB per body (declared or streamed); JSON only.
- 429: one retry after `Retry-After` seconds (integer form only) bounded to 5 s, or 1 s without the header.
- Tokens (DigiKey `client_credentials` with client id and secret in the form; TME `client_credentials` with HTTP
  Basic `token:secret`) are kept in memory per supplier and credential, reused until 60 s before `expires_in`
  (default 300 s when absent), requested once at a time per supplier, dropped on a credential change or
  revocation, and refreshed once when a search answers 401 or 403.
- Keys sent in a query string (Mouser `apiKey`, Farnell `callInfo.apiKey`, Rutronik `apikey`) make the request URL
  secret: it is never logged, returned or put into an error.

## 5 Supplier mapping

- Mouser: keyword `{"SearchByKeywordMfrNameRequest": {"keyword", "records": limit, "pageNumber": 1,
  "searchOptions": "None"}}`; MPN `{"SearchByPartMfrNameRequest": {"mouserPartNumber": mpn,
  "partSearchOptions": "None"}}`. `SearchResults.Parts[]`: `Manufacturer`, `ManufacturerPartNumber`,
  `Description`, `LifecycleStatus`, `DataSheetUrl`; offer `MouserPartNumber`, `ProductDetailUrl`,
  `AvailabilityInStock` (digits only, else null), `Min`, `Mult`, `LeadTime`, attribute `Packaging`, `PriceBreaks`
  (`Quantity`, `Price` text, `Currency`); `package` from the attribute `Package / Case`; other `ProductAttributes`
  become parameters. A non-empty `Errors` list makes the answer `partial` (with parts) or `failed` (without).
- DigiKey: headers `X-DIGIKEY-Client-Id`, `Authorization: Bearer`, `X-DIGIKEY-Locale-Site` (country),
  `-Language`, `-Currency`; body `{"Keywords": text, "Limit": limit, "Offset": 0}` for both kinds. `Products[]`
  (exact matches first for an MPN): `Manufacturer.Name`, `ManufacturerProductNumber`,
  `Description.ProductDescription`, `ProductStatus.Status`, `DatasheetUrl`, `Parameters` (`ParameterText`:
  `ValueText`, `package` from `Package / Case`); one offer per `ProductVariations[]`: `DigiKeyProductNumber`,
  `PackageType.Name`, `QuantityAvailableforPackageType`, `MinimumOrderQuantity`, `StandardPricing`
  (`BreakQuantity`, `UnitPrice`), `ProductUrl`; `currency` and `region` from `SearchLocaleUsed`.
- TME: header `Accept-Language` (language); `GET /products/search` (`scope[]=products`, `phrase`, `country`,
  `limit`) gives the product symbols - a phrase over 40 characters (TME's limit) is not sent and TME is `failed`
  with code `phrase-over-40-characters`; an envelope whose `status` is not `OK` is `unexpected-answer`; `GET /products/data` (`symbols[]`, `country`, `currency`) gives stock and prices. Offer `sku` is the
  TME symbol; `mpn` from `manufacturer_symbols` / the product's manufacturer symbol; MPN search uses the same
  search with the part number as the phrase. Field names beyond the published OpenAPI are not confirmed.
- Farnell: `GET` with `callInfo.responseDataFormat=JSON`, `callInfo.apiKey`, `term` (`any:<text>` or
  `manuPartNum:<mpn>`), `storeInfo.id`, `resultsSettings.offset=0`, `resultsSettings.numberOfResults=limit`,
  `resultsSettings.responseGroup=large`. `products[]` under the first `*Return` object: `brandName`,
  `translatedManufacturerPartNumber`, `displayName`, `datasheets[0].url`, `productStatus`, `attributes`
  (`attributeLabel`: `attributeValue attributeUnit`); offer `sku`, `packSize`/`unitOfMeasure` as packaging,
  `stock.level`, `translatedMinimumOrderQuality`, `prices[]` (`from`, `cost`); `region` is the store id.
- Rutronik: `GET /api/search/?apikey&searchterm` for both kinds; the answer is a list of at most 10:
  `manufacturer`, `mpn`, `description`, `package`; offer `sku`, `packaging`, `url`, `pu` (multiple), `moq`,
  `stock`, `leadtime` (weeks), `currency`, `pricebreaks` (`quantity`, `price`, each a number or a numeric
  string).

## Acceptance

E03-A (fixtures per supplier: good answer, missing fields, two currencies and several price breaks, 401, 403,
429, cancel), E03-B (no credential in settings, snapshot, request body, result, error or log; URL with a key never
logged), E03-G (plugin or Web access off hides and refuses the tool, concurrent calls share one token request,
revocation aborts calls and drops tokens, a 401 refreshes the token once), E03-F (live probe per supplier the user
grants, redacted; others recorded as unverified).

import type { PartsCredential, PartsSupplierId, PartsSupplierStatus } from "@vera/shared";
import type { PartsHttpOptions } from "./http.js";

export interface PriceBreak {
  quantity: number;
  unitPrice: number | null;
  text: string | null;
}
export interface PartsOffer {
  supplier: PartsSupplierId;
  sku: string;
  packaging: string | null;
  stock: number | null;
  moq: number | null;
  multiple: number | null;
  leadTime: string | null;
  currency: string | null;
  region: string | null;
  productUrl: string | null;
  priceBreaks: PriceBreak[];
  retrievedAt: string;
}
/** One supplier part as an adapter reads it; values the supplier did not state are null. */
export interface PartsItem {
  manufacturer: string | null;
  mpn: string;
  package: string | null;
  description: string | null;
  lifecycle: string | null;
  datasheetUrl: string | null;
  parameters: { name: string; value: string }[];
  offer: Omit<PartsOffer, "supplier" | "retrievedAt">;
}
export interface PartsDevice {
  manufacturer: string | null;
  mpn: string;
  package: string | null;
  description: string | null;
  lifecycle: string | null;
  datasheetUrl: string | null;
  parameters: { supplier: PartsSupplierId; name: string; value: string }[];
  offers: PartsOffer[];
}
export interface SupplierRequest {
  by: "keyword" | "mpn";
  text: string;
  limit: number;
  country: string;
  language: string;
  currency: string;
  farnellStore: string;
}
/** `errors`: supplier error codes; with no item the supplier is `failed`, otherwise `partial`. */
export interface SupplierAnswer {
  items: PartsItem[];
  partial: boolean;
  errors: string[];
}
/** `expiresIn` in seconds, as the supplier stated it (300 when it did not). */
export interface AccessToken {
  value: string;
  expiresIn: number;
}
export interface SupplierAdapter {
  /** Present for suppliers that exchange the credential for a short-lived access token. */
  token?(credential: PartsCredential, signal: AbortSignal, http: PartsHttpOptions): Promise<AccessToken>;
  search(
    request: SupplierRequest,
    auth: { credential: PartsCredential; token?: string },
    signal: AbortSignal,
    http: PartsHttpOptions,
  ): Promise<SupplierAnswer>;
  notice?: string;
}
export interface SupplierReport {
  supplier: PartsSupplierId;
  status: PartsSupplierStatus;
  retrievedAt?: string;
  items: number;
  message?: string;
  notice?: string;
}
export interface PartsSearchResult {
  kind: "parts-search-result";
  search: { by: "keyword" | "mpn"; text: string; limit: number };
  retrievedAt: string;
  suppliers: SupplierReport[];
  devices: PartsDevice[];
  /** True when supplier parameters, price breaks or devices were left out to fit the tool output. */
  truncated: boolean;
  notes: string[];
}
export const partsResultNotes = [
  "Offers are each supplier's declared values at its retrievedAt time and are not live stock afterwards; taxes, shipping, duties and future availability are not included.",
  "Supplier parameters are unconfirmed until checked in the manufacturer's datasheet (page or table and conditions).",
  "Nothing is ordered and nothing is stored; search again for current values.",
];

// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what this removes.
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
/** Trimmed one-line text cut to `max` characters, or null when absent or empty. */
export function text(value: unknown, max = 300): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const cleaned = String(value).replace(CONTROL, " ").replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, max) : null;
}
/** A non-negative whole number from a number or a digit-only string, else null. */
export function count(value: unknown): number | null {
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0 ? value : null;
  if (typeof value === "string" && /^\s*\d{1,15}\s*$/.test(value)) return Number(value.trim());
  return null;
}
/** An absolute http(s) URL without credentials; a protocol-relative URL is read as https. */
export function link(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim() || value.length > 2048) return null;
  try {
    const url = new URL(value.trim().startsWith("//") ? `https:${value.trim()}` : value.trim());
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}
export function currency(value: unknown): string | null {
  return typeof value === "string" && /^[A-Z]{3}$/.test(value.trim()) ? value.trim() : null;
}
/**
 * A unit price from a number or a supplier's price text ("$0.10", "0,42 €", "1.234,56"): one decimal separator,
 * or both kinds with the last one as the decimal separator; anything else is null.
 */
export function price(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value !== "string") return null;
  const digits = value.replace(/[^\d.,]/g, "");
  if (!/\d/.test(digits) || /[^\d.,]/.test(digits)) return null;
  const commas = (digits.match(/,/g) ?? []).length;
  const points = (digits.match(/\./g) ?? []).length;
  let normal: string;
  if (commas && points) {
    const decimal = digits.lastIndexOf(",") > digits.lastIndexOf(".") ? "," : ".";
    const other = decimal === "," ? "." : ",";
    if ((decimal === "," ? commas : points) !== 1) return null;
    normal = digits.split(other).join("").replace(",", ".");
  } else if (commas + points > 1) return null;
  else normal = digits.replace(",", ".");
  const number = Number(normal);
  return /^\d+(\.\d+)?$/.test(normal) && Number.isFinite(number) ? number : null;
}
export function priceBreak(quantity: unknown, unit: unknown, shown?: unknown): PriceBreak | null {
  const amount =
    count(quantity) ?? (typeof quantity === "string" ? count(quantity.replace(/[.,\s]/g, "")) : null);
  if (amount === null || amount < 1) return null;
  return { quantity: amount, unitPrice: price(unit), text: text(shown ?? unit, 40) };
}
/** Readable parameters, at most 30, values cut to 120 characters. */
export function parameters(entries: Iterable<[unknown, unknown]>): { name: string; value: string }[] {
  const list: { name: string; value: string }[] = [];
  for (const [name, value] of entries) {
    const n = text(name, 80),
      v = text(value, 120);
    if (n && v && list.length < 30) list.push({ name: n, value: v });
  }
  return list;
}

const firstWord = (value: string | null) => value?.toLowerCase().match(/[\p{L}\p{N}]+/u)?.[0] ?? "";
/**
 * Offers of one MPN whose manufacturers share their first word form one device; nothing else is merged. Items are
 * taken in turn from each supplier, so trimming the end of the list to fit the output keeps every supplier's best.
 */
export function groupDevices(
  found: { supplier: PartsSupplierId; retrievedAt: string; items: PartsItem[] }[],
) {
  const devices: PartsDevice[] = [];
  const index = new Map<string, PartsDevice>();
  const turns: { supplier: PartsSupplierId; retrievedAt: string; item: PartsItem }[] = [];
  for (let position = 0; found.some(({ items }) => position < items.length); position++)
    for (const { supplier, retrievedAt, items } of found) {
      const item = items[position];
      if (item) turns.push({ supplier, retrievedAt, item });
    }
  for (const { supplier, retrievedAt, item } of turns) {
    const key = `${item.mpn.trim().toLowerCase()}\u0000${firstWord(item.manufacturer)}`;
    let device = index.get(key);
    if (!device) {
      device = {
        manufacturer: item.manufacturer,
        mpn: item.mpn,
        package: item.package,
        description: item.description,
        lifecycle: item.lifecycle,
        datasheetUrl: item.datasheetUrl,
        parameters: [],
        offers: [],
      };
      index.set(key, device);
      devices.push(device);
    }
    device.package ??= item.package;
    device.description ??= item.description;
    device.lifecycle ??= item.lifecycle;
    device.datasheetUrl ??= item.datasheetUrl;
    for (const parameter of item.parameters)
      if (device.parameters.length < 30) device.parameters.push({ supplier, ...parameter });
    device.offers.push({
      supplier,
      ...item.offer,
      priceBreaks: item.offer.priceBreaks.slice(0, 10),
      retrievedAt,
    });
  }
  return devices;
}
/** The registry caps a tool result at 32 000 characters; the parts result is fitted below that by itself. */
export const PARTS_RESULT_LIMIT = 30000;
/**
 * Fits a result into `limit` JSON characters: first supplier parameters (10 per device, then none), then price
 * breaks (3 per offer), then devices from the end. Sets `truncated` and says so in the notes.
 */
export function fitResult(result: PartsSearchResult, limit = PARTS_RESULT_LIMIT): PartsSearchResult {
  const size = () => JSON.stringify(result).length;
  if (size() <= limit) return result;
  result.truncated = true;
  result.notes.push(
    "Supplier parameters, price breaks or devices were left out to fit the tool output; search one supplier or a narrower query for the rest.",
  );
  for (const keep of [10, 0]) {
    for (const device of result.devices) device.parameters = device.parameters.slice(0, keep);
    if (size() <= limit) return result;
  }
  for (const device of result.devices)
    for (const offer of device.offers) offer.priceBreaks = offer.priceBreaks.slice(0, 3);
  while (size() > limit && result.devices.length > 0) result.devices.pop();
  return result;
}
/** Error codes a supplier sent, reduced to safe tokens (at most 5). */
export function errorCodes(values: unknown[]): string[] {
  const codes: string[] = [];
  for (const value of values) {
    const code = typeof value === "string" || typeof value === "number" ? String(value) : "";
    const safe = code.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 40);
    if (safe && !codes.includes(safe) && codes.length < 5) codes.push(safe);
  }
  return codes;
}

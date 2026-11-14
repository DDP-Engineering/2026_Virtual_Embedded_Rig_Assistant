import { partsSearchArgsSchema } from "@vera/shared";
import type { ToolDefinition } from "./context.js";

export const partsSearchTool: ToolDefinition = {
  name: "parts_search",
  class: "read",
  description:
    "Search the enabled supplier catalogs (Mouser, DigiKey, TME, Farnell, Rutronik) by keyword (query) or by a manufacturer or supplier part number (mpn). Only the query or part number leaves VERA. Returns devices (manufacturer, MPN, package, supplier parameters) with each supplier's offers (SKU, packaging, declared stock, MOQ, price breaks, currency, query time) and a status per supplier. Values a supplier did not state are null. Offers are a snapshot, not live stock, without taxes or shipping; supplier parameters are unconfirmed until checked in the datasheet. Never orders anything.",
  params: partsSearchArgsSchema,
  execute: async (ctx, args, signal) => {
    if (!ctx.parts) throw Error("Parts search is unavailable in this host.");
    return { ...(await ctx.parts.search(partsSearchArgsSchema.parse(args), signal)) };
  },
};

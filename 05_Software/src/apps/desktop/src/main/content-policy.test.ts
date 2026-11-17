import { expect, it } from "vitest";
import { productionCsp } from "./content-policy.js";

it("admits only local and Blob images while preserving all execution and connection restrictions", () => {
  expect(productionCsp.split("; ")).toEqual([
    "default-src 'self'",
    "img-src 'self' blob:",
    "script-src 'self'",
    "style-src 'self'",
    "connect-src 'self'",
    "worker-src 'self'",
    "font-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-src 'none'",
    "form-action 'none'",
  ]);
});

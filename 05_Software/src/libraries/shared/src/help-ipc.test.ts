import { expect, it } from "vitest";
import { channels } from "./ipc.js";

it("accepts help page names and languages only in their strict form (REQ-SEC-8e27b5ca)", () => {
  expect(channels["help.read"].request.parse({ page: "getting-started", language: "fr" })).toBeTruthy();
  expect(channels["help.list"].request.parse({ language: "ro" })).toBeTruthy();
  for (const request of [
    { page: "../index", language: "en" },
    { page: "index.md", language: "en" },
    { page: "Index", language: "en" },
    { page: "a/b", language: "en" },
    { page: "index", language: "it" },
    { page: "index", language: "en", path: "C:/secret.md" },
  ])
    expect(channels["help.read"].request.safeParse(request).success).toBe(false);
  expect(channels["help.list"].request.safeParse({ language: "en", root: "/" }).success).toBe(false);
});

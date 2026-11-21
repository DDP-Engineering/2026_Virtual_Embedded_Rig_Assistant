// REQ-SEC-aacbd514 REQ-SEC-0634fcfa
import { expect, it } from "vitest";
import { GIT_DIFF_LINE_LIMIT, GIT_DIFF_PATCH_LIMIT } from "./git-diff.js";
import { channels } from "./ipc.js";

const request = {
  workbenchId: "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C",
  indexLease: 5,
  path: "notes.txt",
  comparison: "staged",
};
const response = {
  ...request,
  displayPath: "notes.txt",
  result: { state: "patch", base: "head", patch: "@@ -1 +1 @@\n-old\n+new\n" },
};

it("admits only literal path requests and scoped, bounded comparison responses", () => {
  const channel = channels["git.diff"];
  expect(channel.request.parse(request)).toEqual(request);
  for (const extra of [{ args: ["log"] }, { indexLease: 0 }, { comparison: "--no-index" }])
    expect(channel.request.safeParse({ ...request, ...extra }).success).toBe(false);

  expect(channel.response.parse(response)).toEqual(response);
  expect(
    channel.response.safeParse({
      ...response,
      result: { state: "unavailable", base: "unknown" },
    }).success,
  ).toBe(true);
  for (const result of [
    { ...response.result, base: "index" },
    { ...response.result, base: "unknown" },
    { ...response.result, state: "binary" },
    { ...response.result, patch: "x".repeat(GIT_DIFF_PATCH_LIMIT + 1) },
    { ...response.result, patch: "+line\n".repeat(GIT_DIFF_LINE_LIMIT + 1) },
    { ...response.result, patch: "+binary\0" },
  ])
    expect(channel.response.safeParse({ ...response, result }).success).toBe(false);
});

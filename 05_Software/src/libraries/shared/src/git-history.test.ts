import { expect, it } from "vitest";
import { GIT_HISTORY_PAGE_SIZE } from "./git-history.js";
import { channels } from "./ipc.js";

const request = {
  workbenchId: "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C",
  indexLease: 1,
  path: "[file].txt",
};

it("accepts only the workbench lease and Files path identity for either Git history operation", () => {
  for (const channel of ["git.history", "git.historyEligibility"] as const) {
    const schema = channels[channel].request;
    expect(schema.parse(request)).toEqual(request);
    expect(schema.safeParse({ ...request, revision: "another-branch" }).success).toBe(false);
    expect(schema.safeParse({ ...request, indexLease: -1 }).success).toBe(false);
  }
});

it("caps the typed page and rejects extra metadata or date formats", () => {
  const schema = channels["git.history"].response;
  const commit = {
    hash: "123456789abc",
    author: "Author",
    date: "2026-11-21T08:00:00.000Z",
    subject: "Subject",
  };
  const response = (commits: unknown[]) => ({
    ...request,
    displayPath: "[file].txt",
    result: { state: "ready", commits, capped: true, scopeBoundary: false },
  });
  expect(schema.safeParse(response([commit])).success).toBe(true);
  expect(schema.safeParse(response(Array(GIT_HISTORY_PAGE_SIZE + 1).fill(commit))).success).toBe(false);
  expect(schema.safeParse(response([{ ...commit, path: "outside" }])).success).toBe(false);
  expect(schema.safeParse(response([{ ...commit, date: "yesterday" }])).success).toBe(false);
});

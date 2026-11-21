import { type GitDiffResult, type Request, veraError } from "@vera/shared";
import { expect, it, vi } from "vitest";
import { GitDiffService } from "./diff-service.js";

const request: Request<"git.diff"> = {
  workbenchId: "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C",
  indexLease: 1,
  path: "opaque.txt",
  comparison: "staged",
};
function fixture() {
  let active = { ...request, folder: "/first", enabled: true };
  const read = vi.fn(
    async (
      _folder: string,
      _path: string,
      _comparison: string,
      _signal: AbortSignal,
    ): Promise<GitDiffResult> => ({
      base: "head",
      state: "patch",
      patch: "first content",
    }),
  );
  const resolve = vi.fn((_id: string, _path: string) => "literal.txt");
  const project = vi.fn((_id: string, _path: string, result: GitDiffResult) => ({
    displayPath: "masked.txt",
    result,
  }));
  const service = new GitDiffService({ scope: () => active, read, resolve, project });
  return {
    read,
    resolve,
    project,
    service,
    set: (change: Partial<typeof active>) => {
      active = { ...active, ...change };
    },
  };
}

it("resolves the path only in the current enabled activation and projects the result", async () => {
  const f = fixture();
  await expect(f.service.request({ ...request, indexLease: 2 })).rejects.toEqual(veraError("CONFLICT"));
  expect(f.resolve).not.toHaveBeenCalled();
  f.set({ enabled: false });
  await expect(f.service.request(request)).rejects.toEqual(veraError("DENIED"));
  expect(f.read).not.toHaveBeenCalled();
  f.set({ enabled: true });
  await expect(f.service.request(request)).resolves.toEqual({
    ...request,
    displayPath: "masked.txt",
    result: { state: "patch", base: "head", patch: "first content" },
  });
  expect(f.resolve).toHaveBeenCalledExactlyOnceWith(request.workbenchId, "opaque.txt");
  expect(f.read).toHaveBeenCalledExactlyOnceWith("/first", "literal.txt", "staged", expect.any(AbortSignal));
  expect(f.project).toHaveBeenCalledExactlyOnceWith(
    request.workbenchId,
    "literal.txt",
    expect.objectContaining({ state: "patch" }),
  );
});

it("cancels a pending diff and discards its result after activation of a copied workbench ID", async () => {
  const f = fixture();
  let finish!: (result: GitDiffResult) => void;
  f.read.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = f.service.request(request);
  const rejected = expect(pending).rejects.toEqual(veraError("CONFLICT"));
  const signal = f.read.mock.calls[0]?.[3];
  f.set({ indexLease: 2, folder: "/copy" });
  f.service.reconcile();
  expect(signal?.aborted).toBe(true);
  finish({ state: "patch", base: "head", patch: "stale content" });
  await rejected;
  expect(f.project).not.toHaveBeenCalled();
  await expect(f.service.request({ ...request, indexLease: 2 })).resolves.toMatchObject({ indexLease: 2 });
  expect(f.read.mock.lastCall?.[0]).toBe("/copy");
});

it("turns a failed local comparison into a content-free unavailable response", async () => {
  const f = fixture();
  f.read.mockRejectedValueOnce(Error("private diagnostic"));
  await expect(f.service.request(request)).resolves.toEqual({
    ...request,
    displayPath: "masked.txt",
    result: { state: "unavailable", base: "unknown" },
  });
});

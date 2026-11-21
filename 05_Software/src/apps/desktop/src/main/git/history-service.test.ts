import { type GitHistoryEligibility, type GitHistoryResult, type Request, veraError } from "@vera/shared";
import { expect, it, vi } from "vitest";
import { GitHistoryService } from "./history-service.js";

const request: Request<"git.history"> = {
  workbenchId: "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C",
  indexLease: 1,
  path: "__vera_display_fixture.",
};
const result: GitHistoryResult = { state: "empty", scopeBoundary: false };

function fixture() {
  let active = { ...request, folder: "/bench", enabled: true };
  const resolve = vi.fn(() => "literal[1].txt");
  const eligible = vi.fn(
    async (_folder: string, _path: string, _signal: AbortSignal): Promise<GitHistoryEligibility> => "tracked",
  );
  const read = vi.fn(
    async (_folder: string, _path: string, _signal: AbortSignal): Promise<GitHistoryResult> => result,
  );
  const project = vi.fn((_id: string, _path: string, value: GitHistoryResult) => ({
    displayPath: "masked.txt",
    result: value,
  }));
  const service = new GitHistoryService({ scope: () => active, read, eligible, resolve, project });
  return {
    service,
    resolve,
    read,
    eligible,
    project,
    change: (change: Partial<typeof active>) => {
      active = { ...active, ...change };
    },
  };
}

it("checks opt-in and lease before resolving the literal identity for either request", async () => {
  const f = fixture();
  await expect(f.service.history({ ...request, indexLease: 2 })).rejects.toEqual(veraError("CONFLICT"));
  f.change({ enabled: false });
  await expect(f.service.eligibility(request)).rejects.toEqual(veraError("DENIED"));
  expect(f.resolve).not.toHaveBeenCalled();
  f.change({ enabled: true });
  await expect(f.service.eligibility(request)).resolves.toEqual({ ...request, eligibility: "tracked" });
  expect(f.eligible).toHaveBeenCalledWith("/bench", "literal[1].txt", expect.any(AbortSignal));
  await expect(f.service.history(request)).resolves.toEqual({
    ...request,
    displayPath: "masked.txt",
    result,
  });
  expect(f.read).toHaveBeenCalledWith("/bench", "literal[1].txt", expect.any(AbortSignal));
  expect(f.project).toHaveBeenCalledWith(request.workbenchId, "literal[1].txt", result);
});

it("cancels history and eligibility reads on a workbench lease change and ignores their returns", async () => {
  const f = fixture();
  let answerRead!: (value: GitHistoryResult) => void;
  let answerTrack!: (value: GitHistoryEligibility) => void;
  f.read.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        answerRead = resolve;
      }),
  );
  f.eligible.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        answerTrack = resolve;
      }),
  );
  const read = expect(f.service.history(request)).rejects.toEqual(veraError("CONFLICT"));
  const eligibility = expect(f.service.eligibility(request)).rejects.toEqual(veraError("CONFLICT"));
  f.change({ indexLease: 2, folder: "/copy" });
  f.service.reconcile();
  expect(f.read.mock.calls[0]?.[2].aborted).toBe(true);
  expect(f.eligible.mock.calls[0]?.[2].aborted).toBe(true);
  answerRead(result);
  answerTrack("tracked");
  await read;
  await eligibility;
  expect(f.project).not.toHaveBeenCalled();
});

it("does not expose subprocess diagnostics", async () => {
  const f = fixture();
  f.read.mockRejectedValueOnce(new Error("private diagnostic"));
  await expect(f.service.history(request)).resolves.toEqual({
    ...request,
    displayPath: "masked.txt",
    result: { state: "unavailable" },
  });
});

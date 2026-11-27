// REQ-FUNC-bf809842
import { expect, it, vi } from "vitest";

const rename = vi.hoisted(() => vi.fn());
vi.mock("node:fs/promises", async (original) => ({
  ...(await original<typeof import("node:fs/promises")>()),
  rename,
}));

import { replaceFile } from "./store.js";

const refused = (code: string) =>
  Object.assign(
    Error(`${code}: operation not permitted, rename 'C:\\private\\a.tmp' -> 'C:\\private\\a.md'`),
    {
      code,
    },
  );

it("renames again when another program lets go of the artifact within moments", async () => {
  rename.mockReset().mockRejectedValueOnce(refused("EPERM")).mockRejectedValueOnce(refused("EBUSY"));
  rename.mockResolvedValueOnce(undefined);
  await replaceFile("a.tmp", "a.md");
  expect(rename).toHaveBeenCalledTimes(3);
});

it("names a file that stays open as the cause, without the system's message or paths", async () => {
  rename.mockReset().mockRejectedValue(refused("EPERM"));
  const error = await replaceFile("a.tmp", "a.md").catch((caught: Error) => caught);
  expect(String(error)).toBe(
    "Error: The artifact is open in another program. Close it there and save again.",
  );
  expect(rename).toHaveBeenCalledTimes(3);
});

it("passes on a failure that waiting cannot cure", async () => {
  rename.mockReset().mockRejectedValue(refused("ENOSPC"));
  await expect(replaceFile("a.tmp", "a.md")).rejects.toMatchObject({ code: "ENOSPC" });
  expect(rename).toHaveBeenCalledOnce();
});

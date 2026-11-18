import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, inject, it } from "vitest";
import { additionalFolderPlatformProbe } from "../support/additional-folder-platform-probe.js";

it("uses real sibling file and shell access with immediate folder revocation", async () => {
  // With the bundled worker the probe also runs its worker checks, the symlink swap included.
  const worker = pathToFileURL(join(inject("cliBundle"), "grep-worker.js"));
  expect(await additionalFolderPlatformProbe(worker)).toMatchObject({
    unlistedRefused: true,
    protectedAliasesRefused: true,
    removedPendingRefused: true,
    workbenchLog: true,
    workerBindings: true,
  });
}, 30000);

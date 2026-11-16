import { expect, it } from "vitest";
import { additionalFolderPlatformProbe } from "../support/additional-folder-platform-probe.js";

it("uses real sibling file and shell access with immediate folder revocation", async () => {
  expect(await additionalFolderPlatformProbe()).toMatchObject({
    unlistedRefused: true,
    protectedAliasesRefused: true,
    removedPendingRefused: true,
    workbenchLog: true,
  });
}, 30000);

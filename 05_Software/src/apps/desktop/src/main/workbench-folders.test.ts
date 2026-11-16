import { workbenchSchema } from "@vera/shared";
import { expect, it } from "vitest";
import { publicWorkbenchFolders } from "./workbench-folders.js";

it("omits masked authority strings without changing host grants", () => {
  const config = workbenchSchema.parse({
    format: 1,
    id: "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C",
    name: "Folders",
    additional_folders: ["/private/key/repo", "/ordinary"],
  });
  const shown = publicWorkbenchFolders({ config }, (text) => text.replaceAll("key", "[REDACTED]"));
  expect(shown.config.additional_folders).toEqual(["/ordinary"]);
  expect(config.additional_folders).toEqual(["/private/key/repo", "/ordinary"]);
});

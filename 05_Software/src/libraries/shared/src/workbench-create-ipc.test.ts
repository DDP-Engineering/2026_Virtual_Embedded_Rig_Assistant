import { expect, it } from "vitest";
import { channels } from "./ipc.js";
import { documentFolderPattern, documentPatternFolder } from "./workbench.js";

// REQ-FUNC-38107da8 REQ-FUNC-81ce68df
it("validates strict workbench creation drafts and inspection results", () => {
  const create = channels["workbench.create"].request;
  expect(create.parse({ folder: "C:/bench", name: "Board" })).toEqual({ folder: "C:/bench", name: "Board" });
  expect(
    create.safeParse({
      folder: "C:/bench",
      name: "Board",
      config: { tools: { disabled: ["web_search"] }, skills: { disabled: ["probe"] } },
      instructions: "# Board\n",
    }).success,
  ).toBe(true);
  for (const request of [
    { folder: "C:/bench", name: "Board", config: { name: "Other" } },
    { folder: "C:/bench", name: "Board", config: { format: 2 } },
    { folder: "C:/bench", name: "Board", config: { tools: { disabled: [""] } } },
    { folder: "C:/bench", name: "Board", config: { embeddings: { chunkSize: 400, overlap: 400 } } },
    { folder: "C:/bench", name: " ", config: {} },
    { folder: "C:/bench", name: "Board", extra: true },
  ])
    expect(create.safeParse(request).success).toBe(false);
  const inspect = channels["workbench.inspect"];
  expect(inspect.request.safeParse({ folder: "" }).success).toBe(false);
  expect(
    inspect.response.parse({
      folder: "C:/bench",
      name: "bench",
      existing: false,
      instructions: null,
      skills: [],
    }),
  ).toBeTruthy();
  expect(
    inspect.response.safeParse({ folder: "C:/bench", name: "bench", existing: false, skills: [] }).success,
  ).toBe(false);
});

// REQ-UX-5b390823 REQ-UX-b96730c7
it("escapes literal documentation folder names into include patterns and reads them back", () => {
  for (const [folder, pattern] of [
    ["datasheets", "datasheets/**"],
    ["Reference Manuals (RM0440)", "Reference Manuals [(]RM0440[)]/**"],
    ["Datasheets [2024]", "Datasheets [[]2024[]]/**"],
    ["docs {v2}/a*b?", "docs [{]v2[}]/a[*]b[?]/**"],
    ["!archive", "@(!)archive/**"],
    ["a|b", "a[|]b/**"],
  ] as const) {
    expect(documentFolderPattern(folder)).toBe(pattern);
    expect(documentPatternFolder(pattern)).toBe(folder);
  }
  for (const glob of ["docs/*.pdf", "**/manuals/**", "!drafts/**", "a(b)/**", "docs"])
    expect(documentPatternFolder(glob)).toBeUndefined();
});

// REQ-FUNC-4ee03ca8 REQ-FUNC-ad5868a2 REQ-FUNC-03b73d56
it("validates strict documentation scan, preview and relative-folder channels", () => {
  expect(channels["workbench.scanDocs"].request.safeParse({ folder: "" }).success).toBe(false);
  expect(
    channels["workbench.scanDocs"].response.parse({
      folders: [{ path: "datasheets", bytes: 10, kinds: { pdf: 2 } }],
      truncated: false,
    }),
  ).toBeTruthy();
  expect(
    channels["workbench.scanDocs"].response.safeParse({
      folders: [{ path: "a", bytes: 1, kinds: { exe: 1 } }],
      truncated: false,
    }).success,
  ).toBe(false);
  expect(
    channels["workbench.previewDocs"].request.safeParse({ folder: "C:/b", include: ["docs/**"], exclude: [] })
      .success,
  ).toBe(true);
  expect(channels["workbench.previewDocs"].request.safeParse({ folder: "C:/b", include: [] }).success).toBe(
    false,
  );
  expect(
    channels["workbench.previewDocs"].response.safeParse({
      files: -1,
      bytes: 0,
      officePending: 0,
      truncated: false,
    }).success,
  ).toBe(false);
  expect(channels["workbench.relativeFolder"].request.safeParse({ root: "C:/b", folder: "" }).success).toBe(
    false,
  );
});

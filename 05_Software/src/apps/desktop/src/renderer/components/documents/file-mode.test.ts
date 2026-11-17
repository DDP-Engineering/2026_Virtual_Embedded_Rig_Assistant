// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { api } from "../../api/index.js";
import { readFileMode, rememberFileMode, resolveFileMode } from "./file-mode.js";

vi.mock("../../api/index.js", () => ({ api: { invoke: vi.fn() } }));
const id = "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C";
it.each([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"])(
  "offers unindexed %s as Rendered and retains explicit Hex without reading image bytes early",
  async (extension) => {
    const path = "__vera_display_image.";
    vi.mocked(api.invoke).mockResolvedValue({
      workbenchId: id,
      properties: { path, extension, type: "file", size: 8000000, modified: null, rendered: false },
    } as never);
    const result = await readFileMode(id, path, "image:1");
    expect(result.modeInfo).toEqual({ extension, modes: ["rendered", "text", "hex"], mode: "rendered" });
    expect("imageFile" in result && result.imageFile).toMatchObject({ path, size: 8000000 });
    expect(api.invoke).not.toHaveBeenCalledWith("docs.open", expect.anything());
    expect(api.invoke).not.toHaveBeenCalledWith("docs.readBytes", expect.anything());
    rememberFileMode(localStorage, extension, "hex");
    expect((await readFileMode(id, path, "image:2")).modeInfo.mode).toBe("hex");
    rememberFileMode(localStorage, extension, "rendered");
    expect((await readFileMode(id, path, "image:3")).modeInfo.mode).toBe("rendered");
  },
);
afterEach(() => {
  localStorage.clear();
  vi.resetAllMocks();
});

it("resolves rendered, recognized text and unknown defaults without persisting automatic choices", () => {
  expect(resolveFileMode(localStorage, ".md")).toEqual({
    extension: ".md",
    modes: ["rendered", "text", "hex"],
    mode: "rendered",
  });
  expect(resolveFileMode(localStorage, ".c").mode).toBe("text");
  expect(resolveFileMode(localStorage, ".unknown").mode).toBe("hex");
  expect(resolveFileMode(localStorage, "").mode).toBe("hex");
  expect(resolveFileMode(localStorage, ".txt", undefined, true).mode).toBe("hex");
  expect(localStorage.length).toBe(0);
});

it.each([
  ["unindexed.md", ".md"],
  ["ignored/notes.html", ".html"],
])("opens unavailable %s as Text without rewriting saved Rendered", async (path, extension) => {
  rememberFileMode(localStorage, extension, "rendered");
  const before = localStorage.getItem("vera.viewer.modes");
  vi.mocked(api.invoke).mockImplementation((async (channel: string) =>
    channel === "docs.open"
      ? Promise.reject({ code: "NOT_FOUND", messageKey: "errors.NOT_FOUND" })
      : channel === "docs.stat"
        ? {
            workbenchId: id,
            properties: {
              path,
              extension,
              rendered: false,
              type: "file",
              size: 4,
              modified: "2026-11-17T00:00:00.000Z",
            },
          }
        : {
            workbenchId: id,
            path,
            offset: 0,
            size: 4,
            data: btoa("# ok"),
          }) as typeof api.invoke);
  const result = await readFileMode(id, path, "unavailable");
  expect(result.modeInfo.mode).toBe("text");
  expect(result.modeInfo.modes).toEqual(["text", "hex"]);
  expect(api.invoke).not.toHaveBeenCalledWith("docs.open", expect.anything());
  expect(localStorage.getItem("vera.viewer.modes")).toBe(before);
});

it("remembers deliberate modes independently and resolves unsupported preferences without rewriting them", () => {
  rememberFileMode(localStorage, ".md", "text");
  rememberFileMode(localStorage, ".bin", "rendered");
  expect(resolveFileMode(localStorage, ".md").mode).toBe("text");
  expect(resolveFileMode(localStorage, ".bin").mode).toBe("hex");
  expect(resolveFileMode(localStorage, ".txt").mode).toBe("text");
  expect(resolveFileMode(localStorage, ".md", "hex").mode).toBe("hex");
  expect(JSON.parse(localStorage.getItem("vera.viewer.modes") ?? "null")).toEqual({
    version: 1,
    extensions: { ".md": "text", ".bin": "rendered" },
  });
});

it.each(["bad json", '{"version":2,"extensions":{}}', '{"version":1,"extensions":{".md":"bad"}}'])(
  "ignores invalid persisted records: %s",
  (record) => {
    localStorage.setItem("vera.viewer.modes", record);
    expect(resolveFileMode(localStorage, ".md").mode).toBe("rendered");
  },
);

it("keeps explicit choice usable when storage is unavailable", () => {
  const storage = {
    getItem: () => {
      throw Error("denied");
    },
    setItem: () => {
      throw Error("quota");
    },
  };
  expect(() => rememberFileMode(storage, ".md", "hex")).not.toThrow();
  expect(resolveFileMode(storage, ".md", "text").mode).toBe("text");
});

it("uses only real extension metadata for opaque identities and does not assemble large text before Hex selection", async () => {
  const path = "__vera_display_opaque.",
    size = 100 * 1024 * 1024;
  rememberFileMode(localStorage, ".md", "hex");
  vi.mocked(api.invoke).mockImplementation((async (channel: string) => {
    if (channel === "docs.stat")
      return {
        workbenchId: id,
        properties: {
          path,
          displayPath: "[REDACTED]",
          extension: ".md",
          type: "file",
          size,
          modified: "2026-11-17T00:00:00.000Z",
        },
      };
    return { workbenchId: id, path, offset: 0, size, data: btoa("# header".padEnd(4096, " ")) };
  }) as typeof api.invoke);
  const result = await readFileMode(id, path, "attempt:1");
  expect(result.modeInfo.mode).toBe("hex");
  expect("hexFile" in result && result.hexFile?.size).toBe(size);
  expect(vi.mocked(api.invoke).mock.calls.filter(([channel]) => channel === "docs.readBytes")).toEqual([
    ["docs.readBytes", { workbenchId: id, path, offset: 0, length: 4096 }],
  ]);
});

it("detects binary known text from a bounded prefix and rejects wrong-owner metadata", async () => {
  vi.mocked(api.invoke).mockImplementation((async (channel: string) =>
    channel === "docs.stat"
      ? {
          workbenchId: id,
          properties: {
            path: "x.txt",
            extension: ".txt",
            type: "file",
            size: 2,
            modified: "2026-11-17T00:00:00.000Z",
          },
        }
      : { workbenchId: id, path: "x.txt", offset: 0, size: 2, data: "AP8=" }) as typeof api.invoke);
  expect((await readFileMode(id, "x.txt", "attempt:2")).modeInfo.mode).toBe("hex");
  vi.mocked(api.invoke).mockImplementation((async (channel: string) =>
    channel === "docs.stat"
      ? {
          workbenchId: id,
          properties: {
            path: "x.txt",
            extension: ".txt",
            type: "file",
            size: 2,
            modified: "2026-11-17T00:00:00.000Z",
          },
        }
      : { workbenchId: id, path: "x.txt", offset: 0, size: 2, data: "" }) as typeof api.invoke);
  await expect(readFileMode(id, "x.txt", "attempt:short")).rejects.toMatchObject({ code: "CONFLICT" });
  vi.mocked(api.invoke).mockResolvedValue({ workbenchId: "wrong", properties: {} } as never);
  await expect(readFileMode(id, "x.txt", "attempt:3")).rejects.toMatchObject({ code: "CONFLICT" });
});

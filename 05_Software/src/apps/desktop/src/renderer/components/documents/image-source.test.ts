// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { api } from "../../api/index.js";
import { type ImageFile, readImageBlob } from "./image-source.js";

vi.mock("../../api/index.js", () => ({ api: { invoke: vi.fn() } }));
const file: ImageFile = {
  workbenchId: "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C",
  path: "opaque.",
  size: 131079,
  modified: "2026-11-17",
  mime: "image/png",
};
afterEach(() => vi.resetAllMocks());
function serve(change?: (channel: string, result: Record<string, unknown>) => void) {
  return vi.mocked(api.invoke).mockImplementation((async (
    channel: string,
    input: { offset: number; length: number },
  ) => {
    const result =
      channel === "docs.stat"
        ? { workbenchId: file.workbenchId, properties: { ...file, type: "file" } }
        : {
            workbenchId: file.workbenchId,
            path: file.path,
            size: file.size,
            offset: input.offset,
            data: btoa("x".repeat(Math.min(input.length, file.size - input.offset))),
          };
    change?.(channel, result);
    return result;
  }) as typeof api.invoke);
}
it("assembles only bounded windows into a MIME Blob after matching final metadata", async () => {
  const calls = serve();
  const blob = await readImageBlob(file, new AbortController().signal);
  expect(blob.size).toBe(file.size);
  expect(blob.type).toBe(file.mime);
  expect(
    calls.mock.calls.filter(([channel]) => channel === "docs.readBytes").map(([, input]) => input),
  ).toEqual([
    { workbenchId: file.workbenchId, path: file.path, offset: 0, length: 65536 },
    { workbenchId: file.workbenchId, path: file.path, offset: 65536, length: 65536 },
    { workbenchId: file.workbenchId, path: file.path, offset: 131072, length: 7 },
  ]);
  expect(calls.mock.calls.filter(([channel]) => channel === "docs.stat")).toHaveLength(2);
});
it.each(["workbenchId", "path", "offset", "size", "short", "base64", "modified"])(
  "rejects %s mismatch without returning a Blob",
  async (field) => {
    let stats = 0;
    serve((channel, result) => {
      if (channel === "docs.stat") {
        stats++;
        if (field === "modified" && stats === 2)
          (result.properties as { modified: string }).modified = "changed";
      } else if (field === "short") result.data = "eA==";
      else if (field === "base64") result.data = "%";
      else if (field !== "modified") result[field] = field === "offset" || field === "size" ? -1 : "wrong";
    });
    await expect(readImageBlob(file, new AbortController().signal)).rejects.toMatchObject({
      code: "CONFLICT",
    });
  },
);
it("stops during a deferred byte read and never requests the next window", async () => {
  const controller = new AbortController();
  const invoke = serve();
  let release: (() => void) | undefined;
  const base = invoke.getMockImplementation();
  invoke.mockImplementation((async (channel: string, input: never) => {
    const result = await base?.(channel as never, input);
    if (channel === "docs.readBytes")
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    return result;
  }) as typeof api.invoke);
  const pending = readImageBlob(file, controller.signal);
  await vi.waitFor(() => expect(release).toBeDefined());
  controller.abort();
  release?.();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(invoke.mock.calls.filter(([channel]) => channel === "docs.readBytes")).toHaveLength(1);
});

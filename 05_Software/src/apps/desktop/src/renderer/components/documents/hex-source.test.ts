import { afterEach, expect, it, vi } from "vitest";
import { api } from "../../api/index.js";
import { formatHexRow, HexSource, hexPattern, parseHexOffset, readHexFile } from "./hex-source.js";

vi.mock("../../api/index.js", () => ({ api: { invoke: vi.fn() } }));
function base64(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
const owner = "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C";
const file = { workbenchId: owner, path: "opaque.", size: 131091, modified: "2026-11-17" };
const signal = () => new AbortController().signal;
afterEach(() => vi.restoreAllMocks());
function host(bytes: Uint8Array) {
  return vi.mocked(api.invoke).mockImplementation((async (
    channel: string,
    input: { offset: number; length: number },
  ) => {
    if (channel === "docs.stat")
      return {
        workbenchId: owner,
        properties: { path: file.path, type: "file", size: bytes.length, modified: file.modified },
      };
    const part = bytes.subarray(input.offset, input.offset + input.length);
    return {
      workbenchId: owner,
      path: file.path,
      size: bytes.length,
      offset: input.offset,
      data: base64(part),
    };
  }) as typeof api.invoke);
}
it("formats VIEW-04-B partial rows and only printable ASCII", () => {
  expect(formatHexRow(65536, Uint8Array.of(0, 9, 31, 32, 65, 126, 127, 255))).toEqual({
    offset: "00010000",
    hex: "00 09 1F 20 41 7E 7F FF",
    ascii: "... A~..",
  });
  expect(formatHexRow(0x100000000, new Uint8Array())).toEqual({ offset: "100000000", hex: "", ascii: "" });
});
it("validates physical offsets and bounded text/hex patterns", () => {
  expect(parseHexOffset("0x10000", file.size)).toBe(65536);
  expect(parseHexOffset("131090", file.size)).toBe(131090);
  for (const value of ["-1", "1e3", "12oops", "131091", "9007199254740993", ""])
    expect(() => parseHexOffset(value, file.size)).toThrow();
  expect([...hexPattern("00 ff 41", "hex")]).toEqual([0, 255, 65]);
  expect([...hexPattern("é", "text")]).toEqual([0xc3, 0xa9]);
  for (const value of ["", "F", "0G", "AA".repeat(4097)]) expect(() => hexPattern(value, "hex")).toThrow();
});
it("finds VIEW-04-A a cross-window sequence, wraps, bounds retention and copies masked bytes", async () => {
  const bytes = new Uint8Array(file.size).fill(46);
  bytes.set([65, 66, 0, 255, 67], 65534);
  bytes.set([42, 42, 42], 131080);
  const calls = host(bytes),
    source = new HexSource(file);
  expect(await source.find(Uint8Array.of(65, 66, 0, 255, 67), 0, signal())).toBe(65534);
  expect(await source.find(Uint8Array.of(65, 66, 0, 255, 67), 65535, signal())).toBe(65534);
  expect(await source.copy(65534, 65538, "hex", signal())).toBe("41 42 00 FF 43");
  expect(await source.copy(131080, 131082, "text", signal())).toBe("***");
  for (let i = 0; i < 8; i++) await source.read(i * 16, 65536, signal(), true);
  expect(source.retainedBytes).toBeLessThanOrEqual(4 * 65536);
  expect(
    calls.mock.calls.every(
      ([channel, input]) => channel !== "docs.readBytes" || (input as { length: number }).length <= 65536,
    ),
  ).toBe(true);
  await expect(source.copy(0, 65536, "hex", signal())).rejects.toMatchObject({ code: "INVALID" });
  source.dispose();
  expect(source.retainedBytes).toBe(0);
});
it("rejects malformed replies and changed final metadata without publishing", async () => {
  const bytes = new Uint8Array(file.size);
  const calls = host(bytes);
  expect((await readHexFile(owner, file.path)).hexFile).toEqual(file);
  calls.mockResolvedValueOnce({
    workbenchId: "other",
    path: file.path,
    size: file.size,
    offset: 0,
    data: "AA==",
  } as never);
  await expect(new HexSource(file).read(0, 1, signal())).rejects.toMatchObject({ code: "CONFLICT" });
  host(bytes).mockResolvedValueOnce({
    workbenchId: owner,
    path: file.path,
    size: file.size,
    offset: 0,
    data: "AA==",
  } as never);
  await expect(new HexSource(file).read(0, 16, signal())).rejects.toMatchObject({ code: "CONFLICT" });
  host(bytes).mockResolvedValueOnce({
    workbenchId: owner,
    properties: { path: file.path, type: "file", size: file.size, modified: "changed" },
  } as never);
  await expect(new HexSource(file).verify(signal())).rejects.toMatchObject({ code: "CONFLICT" });
});
it("cancels a pending search and never scans another window", async () => {
  const controller = new AbortController();
  let release: (reply: unknown) => void = () => {};
  const calls = vi.mocked(api.invoke).mockImplementation((async (channel: string) =>
    channel === "docs.stat"
      ? {
          workbenchId: owner,
          properties: { path: file.path, type: "file", size: file.size, modified: file.modified },
        }
      : new Promise<unknown>((resolve) => {
          release = resolve;
        })) as typeof api.invoke);
  const result = new HexSource(file).find(Uint8Array.of(65), 0, controller.signal);
  await vi.waitFor(() => expect(calls).toHaveBeenCalledTimes(2));
  controller.abort();
  release({
    workbenchId: owner,
    path: file.path,
    size: file.size,
    offset: 0,
    data: base64(new Uint8Array(65536)),
  });
  await expect(result).rejects.toThrow();
  expect(calls).toHaveBeenCalledTimes(2);
});

it("rejects wrong byte identities and exact lengths, including a partial EOF window", async () => {
  const bytes = new Uint8Array(file.size);
  for (const patch of [
    { path: "other.bin" },
    { offset: 1 },
    { size: file.size + 1 },
    { data: "!!!!" },
    { data: base64(Uint8Array.of(1, 2)) },
  ]) {
    host(bytes).mockResolvedValueOnce({
      workbenchId: owner,
      path: file.path,
      size: file.size,
      offset: 0,
      data: "AA==",
      ...patch,
    } as never);
    await expect(new HexSource(file).read(0, 1, signal())).rejects.toMatchObject({ code: "CONFLICT" });
  }
  host(bytes);
  expect(await new HexSource(file).read(file.size - 3, 65536, signal())).toEqual(new Uint8Array(3));
  host(new Uint8Array());
  const empty = await readHexFile(owner, file.path);
  expect(await new HexSource(empty.hexFile).read(0, 65536, signal())).toHaveLength(0);
});
it("reads a distant safe-integer offset without allocating or scanning the file", async () => {
  const huge = { ...file, size: Number.MAX_SAFE_INTEGER },
    offset = Number.MAX_SAFE_INTEGER - 3;
  vi.mocked(api.invoke).mockResolvedValueOnce({
    workbenchId: owner,
    path: file.path,
    size: huge.size,
    offset,
    data: base64(Uint8Array.of(0, 127, 65)),
  } as never);
  const bytes = await new HexSource(huge).read(offset, 65536, signal());
  expect(formatHexRow(offset, bytes).ascii).toBe("..A");
  expect(api.invoke).toHaveBeenCalledTimes(1);
});

it("keeps the requested tab identity while adopting the host-owned opaque byte path", async () => {
  host(new Uint8Array(file.size));
  const result = await readHexFile(owner, "newly-secret.bin");
  expect(result.content.path).toBe("newly-secret.bin");
  expect(result.hexFile.path).toBe(file.path);
});

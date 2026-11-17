import { open } from "node:fs/promises";

export const LARGE_TEXT_BYTES = 200 * 1024 * 1024;
export const LARGE_TEXT_SECRET = "view03-synthetic-password";

/** Writes a genuine 200MiB variable-row log without constructing it in memory. */
export async function makeLargeTextFixture(path: string) {
  const handle = await open(path, "wx");
  let size = 0,
    line = 1;
  const lengths = [80, 128, 256, 512];
  try {
    while (size < LARGE_TEXT_BYTES) {
      let chunk = "";
      for (let i = 0; i < 4096 && size < LARGE_TEXT_BYTES; i++) {
        const length = Math.min(
          line === 12345 ? 6 * 1024 * 1024 : (lengths[(line - 1) % 4] ?? 80),
          LARGE_TEXT_BYTES - size,
        );
        const label = `Row ${String(line).padStart(8, "0")} `;
        const marker =
          size > LARGE_TEXT_BYTES - 1024 ? "VIEW03 LATE café 😀 " : line === 1 ? LARGE_TEXT_SECRET : "";
        const prefix = `${label}${marker}`;
        const ending = line === 12345 ? " LONG_COLUMN_MATCH café 😀\n" : "\n";
        chunk +=
          length > prefix.length + 8
            ? `${prefix}${"x".repeat(length - Buffer.byteLength(prefix) - Buffer.byteLength(ending))}${ending}`
            : "x".repeat(length);
        size += length;
        line++;
      }
      await handle.write(chunk);
    }
  } finally {
    await handle.close();
  }
  return { size, lines: line - 1, target: Math.floor((line - 1) * 0.83) };
}

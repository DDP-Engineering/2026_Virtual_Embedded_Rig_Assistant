export function utf16Bom(bytes: Uint8Array): "utf-16le" | "utf-16be" | undefined {
  if (bytes[0] === 0xff && bytes[1] === 0xfe && !(bytes[2] === 0 && bytes[3] === 0)) return "utf-16le";
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be";
}

export function validUtf8(bytes: Uint8Array, stream = false): boolean {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes, { stream });
    return true;
  } catch {
    return false;
  }
}

/** Classification of the first 8 KiB only; decoding uses replacement rather than throwing. */
export function isBinary(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, 8192);
  // Binary formats are full of NUL bytes; a serial capture with a few stray ones is still a text log.
  let nul = 0;
  for (const byte of sample) if (byte === 0) nul++;
  if (nul > sample.length / 100) return true;
  const text = new TextDecoder().decode(sample);
  const characters = Array.from(text);
  return characters.length > 0 && characters.filter((char) => char === "�").length / characters.length > 0.1;
}

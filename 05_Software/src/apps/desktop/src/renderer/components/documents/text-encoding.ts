export const textEncodings = [
  "utf-8",
  "windows-1252",
  "iso-8859-1",
  "iso-8859-2",
  "utf-16le",
  "utf-16be",
] as const;
export type TextEncoding = (typeof textEncodings)[number] | "latin1";

export function createTextDecoder(
  encoding: TextEncoding,
  options?: TextDecoderOptions,
): { decode(input?: Uint8Array, options?: TextDecodeOptions): string } {
  if (encoding !== "latin1") return new TextDecoder(encoding, options);
  // The platform aliases ISO-8859-1 to Windows-1252. File tools preserve the actual Latin-1 bytes.
  return {
    decode(input?: Uint8Array) {
      if (!input) return "";
      let text = "";
      for (let start = 0; start < input.length; start += 8192)
        text += String.fromCharCode(...input.subarray(start, start + 8192));
      return text;
    },
  };
}

/** BOM wins on first open; an explicit encoding subsequently owns decoding. */
export function detectTextEncoding(bytes: Uint8Array): TextEncoding {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le";
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be";
  return "utf-8";
}

/** Null requests explicit Show as text; replacement decoding is opt-in. */
export function decodeTextLines(bytes: Uint8Array, encoding: TextEncoding, replace = false): string[] | null {
  try {
    const text = createTextDecoder(encoding, { fatal: !replace }).decode(bytes);
    if (!replace && text.includes("\0")) return null;
    return text.split(/\r?\n/);
  } catch {
    return null;
  }
}

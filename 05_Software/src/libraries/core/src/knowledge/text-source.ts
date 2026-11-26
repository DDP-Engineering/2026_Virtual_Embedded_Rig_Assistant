import { isBinary, utf16Bom } from "../tools/binary.js";

export function isBinaryDocumentText(bytes: Uint8Array): boolean {
  return utf16Bom(bytes) === undefined && isBinary(bytes);
}

export function decodeDocumentText(bytes: Uint8Array): string {
  const utf16 = utf16Bom(bytes);
  if (utf16) return new TextDecoder(utf16, { fatal: true }).decode(bytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

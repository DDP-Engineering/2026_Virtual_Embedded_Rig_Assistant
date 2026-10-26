/** Classification of the first8KiB only; decoding uses replacement rather than throwing. */
export function isBinary(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, 8192);
  if (sample.includes(0)) return true;
  const text = new TextDecoder().decode(sample);
  const characters = Array.from(text);
  return characters.length > 0 && characters.filter((char) => char === "�").length / characters.length > 0.1;
}

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

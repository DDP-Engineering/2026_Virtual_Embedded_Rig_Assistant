/** Complete ANSI escapes: CSI, C1 CSI, string sequences (OSC, DCS, SOS, PM, APC) and other ESC forms. */
const COMPLETE =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escapes are control characters.
  /\x1b\[[0-?]*[ -/]*[@-~]|\u009b[0-?]*[ -/]*[@-~]|\x1b[\]PX^_][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[ -/]*[0-~]/g;
/** An escape that may still be completed by the next chunk, anchored at the end of the text. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escapes are control characters.
const PARTIAL = /(?:\x1b(?:\[[0-?]*[ -/]*|[\]PX^_][^\x07\x1b]*\x1b?|[ -/]*)|\u009b[0-?]*[ -/]*)$/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escapes are control characters.
const STRAY = /[\x1b\u009b]/g;
/** An unterminated sequence longer than this is output, not an escape still arriving. */
const HOLD_LIMIT = 4096;

/**
 * Decodes one output stream as UTF-8 (invalid bytes become U+FFFD) and removes ANSI escapes. Characters
 * and escapes split across chunks are held back until the next chunk completes them.
 */
export class OutputDecoder {
  private readonly decoder = new TextDecoder("utf-8", { fatal: false });
  private pending = "";

  write(chunk: Uint8Array): string {
    return this.strip(this.pending + this.decoder.decode(chunk, { stream: true }), false);
  }

  end(): string {
    return this.strip(this.pending + this.decoder.decode(), true);
  }

  private strip(text: string, final: boolean): string {
    const partial = final ? null : PARTIAL.exec(text);
    const held = partial && text.length - partial.index <= HOLD_LIMIT ? partial.index : text.length;
    this.pending = text.slice(held);
    return text.slice(0, held).replace(COMPLETE, "").replace(STRAY, "");
  }
}

/** The last `limit` characters of the output, never starting inside a surrogate pair, and the total. */
export class TailBuffer {
  private buffer = "";
  private count = 0;
  constructor(readonly limit: number) {}

  get total(): number {
    return this.count;
  }

  push(text: string): void {
    this.count += text.length;
    this.buffer += text;
    if (this.buffer.length > this.limit * 2) this.buffer = this.buffer.slice(-this.limit);
  }

  text(): string {
    const tail = this.buffer.slice(-this.limit);
    const first = tail.charCodeAt(0);
    return first >= 0xdc00 && first <= 0xdfff ? tail.slice(1) : tail;
  }
}

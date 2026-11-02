import { describe, expect, it } from "vitest";
import { OutputDecoder, TailBuffer } from "./run-output.js";

const bytes = (...parts: (string | number[])[]) =>
  Buffer.concat(parts.map((part) => (typeof part === "string" ? Buffer.from(part) : Buffer.from(part))));

describe("OutputDecoder", () => {
  it("keeps a multi-byte character split across chunks", () => {
    const decoder = new OutputDecoder();
    const euro = Buffer.from("€");
    expect(decoder.write(bytes("a", [euro[0] ?? 0]))).toBe("a");
    expect(decoder.write(bytes([euro[1] ?? 0, euro[2] ?? 0], "b"))).toBe("€b");
    expect(decoder.end()).toBe("");
  });

  it("replaces invalid bytes with U+FFFD", () => {
    const decoder = new OutputDecoder();
    expect(decoder.write(bytes("x", [0xff], "y")) + decoder.end()).toBe("x�y");
  });

  it("removes CSI, OSC, two-character and C1 escapes, also when split across chunks", () => {
    const decoder = new OutputDecoder();
    let text = decoder.write(bytes("red:\x1b[3"));
    text += decoder.write(bytes("1;1mERR\x1b"));
    text += decoder.write(bytes("[0m done\x1b]0;title\x07 ok\x1b]8;;http://x\x1b\\link"));
    text += decoder.write(bytes("\x1b(B\x1bM end \u009b2Kz"));
    text += decoder.end();
    expect(text).toBe("red:ERR done oklink end z");
    // biome-ignore lint/suspicious/noControlCharactersInRegex: the oracle looks for escape bytes.
    expect(text).not.toMatch(/[\x1b\u009b]/);
  });

  it("flushes an unfinished escape at the end of output without its introducer", () => {
    const decoder = new OutputDecoder();
    expect(decoder.write(bytes("tail \x1b[3")) + decoder.end()).toBe("tail 3");
  });
});

describe("TailBuffer", () => {
  it("keeps the last characters and counts everything", () => {
    const tail = new TailBuffer(5);
    tail.push("abc");
    tail.push("defgh");
    expect(tail.text()).toBe("defgh");
    expect(tail.total).toBe(8);
  });

  it("never starts with a lone low surrogate", () => {
    const tail = new TailBuffer(2);
    tail.push("a😀");
    expect(tail.text()).toBe("😀");
    tail.push("b");
    expect(tail.text()).toBe("b");
  });
});

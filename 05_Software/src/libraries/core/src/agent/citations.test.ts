import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Message } from "@earendil-works/pi-ai";
import { expect, it } from "vitest";
import { validateCitations } from "./citations.js";

it("validates control-byte UTF8 only for successful parse_log provenance", async () => {
  const root = await mkdtemp(join(tmpdir(), "vera-log-citations-"));
  try {
    await writeFile(join(root, "log.txt"), "INFO ready\n\u0000\n");
    const ref = "log.txt#L1-L1";
    const message: Message = {
      role: "toolResult",
      toolName: "parse_log",
      toolCallId: "log",
      content: [{ type: "text", text: JSON.stringify({ events: [{ ref }] }) }],
      isError: false,
      timestamp: 0,
    };
    expect(await validateCitations(root, `[[${ref}]]`, [message])).toEqual([{ ref, valid: true }]);
    expect(await validateCitations(root, `[[${ref}]]`, [{ ...message, toolName: "read" }])).toEqual([
      { ref, valid: false },
    ]);
    const grown = await open(join(root, "log.txt"), "r+");
    try {
      await grown.truncate(50 * 1024 * 1024 + 1);
    } finally {
      await grown.close();
    }
    expect(await validateCitations(root, `[[${ref}]]`, [message])).toEqual([{ ref, valid: false }]);
    await writeFile(join(root, "log.txt"), Buffer.from([0xff, 10]));
    expect(await validateCitations(root, `[[${ref}]]`, [message])).toEqual([{ ref, valid: false }]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("validates issued confined line refs and rejects fabricated, absent, binary and out-of-range sources", async () => {
  const root = await mkdtemp(join(tmpdir(), "vera-citations-"));
  try {
    await writeFile(join(root, "board.txt"), "first\nsecond\n");
    await writeFile(join(root, "binary"), Buffer.from([0, 1, 2]));
    const refs = [
      "board.txt#L1-L2",
      "board.txt#L1-L3",
      "missing#L1-L1",
      "../outside#L1-L1",
      "binary#L1-L1",
      "board.txt#L2-L2",
    ];
    const messages: Message[] = [
      {
        role: "toolResult",
        toolName: "read",
        toolCallId: "c",
        content: [
          { type: "text", text: JSON.stringify({ results: refs.slice(0, -1).map((ref) => ({ ref })) }) },
        ],
        isError: false,
        timestamp: 0,
      },
    ];
    expect(await validateCitations(root, refs.map((ref) => `[[${ref}]]`).join(" "), messages)).toEqual(
      refs.map((ref, i) => ({ ref, valid: i === 0 })),
    );
    const result = messages[0];
    if (result?.role === "toolResult") result.isError = true;
    expect(await validateCitations(root, "[[board.txt#L1-L2]]", messages)).toEqual([
      { ref: refs[0], valid: false },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("contains resolver errors and validates only parsed successful ref fields", async () => {
  const root = await mkdtemp(join(tmpdir(), "vera-citations-"));
  try {
    const issued = [
      "docs/a.pdf#p=1-2",
      "docs/a.md#h=power",
      "docs/a.html#h=reset",
      "docs/a.pdf#p=0",
      "artifact:summary.md",
    ];
    const messages: Message[] = [
      {
        role: "toolResult",
        toolName: "read_doc",
        toolCallId: "c",
        isError: false,
        timestamp: 0,
        content: [
          {
            type: "text",
            text: JSON.stringify({ results: issued.map((ref) => ({ ref })), text: "docs/a.md#h=unissued" }),
          },
        ],
      },
    ];
    const text = [...issued, "docs/a.md#h=unissued", "docs/a.md#h=invented"]
      .map((ref) => `[[${ref}]]`)
      .join(" ");
    const calls: string[] = [];
    expect(
      await validateCitations(
        root,
        text,
        messages,
        () => true,
        async (ref) => {
          calls.push(ref);
          return true;
        },
      ),
    ).toEqual([
      ...issued.map((ref, n) => ({ ref, valid: n !== 3 })),
      { ref: "docs/a.md#h=unissued", valid: false },
      { ref: "docs/a.md#h=invented", valid: false },
    ]);
    expect(calls).toEqual(issued.slice(0, 3));
    expect(
      await validateCitations(
        root,
        "[[docs/a.md#h=power]] [[docs/a.md#h=power]]",
        messages,
        undefined,
        async () => {
          throw Error("index closed");
        },
      ),
    ).toEqual([{ ref: "docs/a.md#h=power", valid: false }]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

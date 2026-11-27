import { createHash } from "node:crypto";
import { mkdir, mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Message } from "@earendil-works/pi-ai";
import { expect, it } from "vitest";
import { captureCitation } from "../wireshark/citations.js";
import { validateCitations } from "./citations.js";

it("accepts capture citations only from matching verified offline evidence", async () => {
  const capture = {
    format: 1,
    source: { kind: "workbench", path: "Prüfung ici.pcapng" },
    fileFormat: "pcapng",
    bytes: 123,
    sha256: "a".repeat(64),
  } as const;
  const analysis = {
    tool: "tshark",
    profile: "vera-offline-v1",
    version: "4.6.10",
    decodeAs: [],
    filter: null,
  } as const;
  const context = { ...analysis, decodeAs: [] };
  const frame = { captureSha256: capture.sha256, number: 7, interfaceId: 0, timestampEpoch: "1767225600.6" };
  const ref = captureCitation(capture, frame, context);
  const packet = { ref, frame, capturedBytes: 63, wireBytes: 63, fields: {}, truncated: false };
  const message = (body: unknown, toolName = "wireshark_capture", isError = false): Message => ({
    role: "toolResult",
    toolName,
    isError,
    toolCallId: "capture",
    timestamp: 0,
    content: [{ type: "text", text: JSON.stringify(body) }],
  });
  const text = `[[${ref}]]`;
  await expect(
    validateCitations(tmpdir(), text, [message({ capture, analysis: context, packets: [packet] })]),
  ).resolves.toEqual([{ ref, valid: true }]);
  const trafficAnalysis = {
    ...context,
    trafficPreferences: {
      tcpSequenceAnalysis: true,
      tcpDesegmentation: true,
      tcpReassembleOutOfOrder: false,
      httpDesegmentation: true,
      dnsDesegmentation: true,
      validateChecksums: true,
    } as const,
  };
  const trafficRef = captureCitation(capture, frame, trafficAnalysis);
  const traffic = { evidence: [{ section: 1, frame, ref: trafficRef }] };
  expect(trafficRef).not.toBe(ref);
  await expect(
    validateCitations(tmpdir(), `[[${trafficRef}]]`, [
      message({ capture, analysis: trafficAnalysis, traffic }),
    ]),
  ).resolves.toEqual([{ ref: trafficRef, valid: true }]);
  await expect(
    validateCitations(tmpdir(), `[[${trafficRef}]]`, [message({ capture, analysis: context, traffic })]),
  ).resolves.toEqual([{ ref: trafficRef, valid: false }]);
  for (const result of [
    message({ capture, analysis: context, packet }, "read"),
    message({ capture, analysis: context, packet }, "wireshark_capture", true),
    message({ capture, analysis: context, packet: { ...packet, frame: { ...frame, number: 1 } } }),
    message({ capture: { ...capture, source: { kind: "managed" } }, analysis: context, packet }),
  ]) {
    await expect(validateCitations(tmpdir(), text, [result])).resolves.toEqual([{ ref, valid: false }]);
  }
});

it("issues sourceRefs only from validated successful decode_register evidence and keeps current path bounds", async () => {
  const root = await mkdtemp(join(tmpdir(), "vera-register-citations-"));
  try {
    await writeFile(join(root, "manual.md"), "meaning\n");
    await mkdir(join(root, ".vera"));
    await writeFile(join(root, ".vera/.veraignore"), "ignored.md\n");
    await writeFile(join(root, "ignored.md"), "ignored\n");
    const refs = ["manual.md#L1-L1", "manual.md#L2-L2", "ignored.md#L1-L1", ".vera/.veraignore#L1-L1"];
    const value = {
      device: { id: "x", revision: "A" },
      register: "R",
      widthBits: 8,
      valueHex: "0x00",
      valueDec: "0",
      fields: [],
      unmappedMaskHex: "0xff",
      unmappedSetBitsHex: "0x00",
      source: { path: "definition.json", sha256: "0".repeat(64), ref: "definition.json#L1-L1" },
      sourceRefs: refs,
    };
    const message: Message = {
      role: "toolResult",
      toolName: "decode_register",
      toolCallId: "c",
      isError: false,
      timestamp: 0,
      content: [{ type: "text", text: JSON.stringify(value) }],
    };
    const text = refs.map((ref) => `[[${ref}]]`).join(" ");
    expect(await validateCitations(root, text, [message])).toEqual(
      refs.map((ref, i) => ({ ref, valid: i === 0 })),
    );
    for (const other of [
      { ...message, toolName: "read" },
      { ...message, isError: true },
      { ...message, content: [{ type: "text" as const, text: JSON.stringify({ sourceRefs: refs }) }] },
    ])
      expect(await validateCitations(root, text, [other])).toEqual(
        refs.map((ref) => ({ ref, valid: false })),
      );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("validates control-byte UTF8 only for successful parse_log provenance", async () => {
  const root = await mkdtemp(join(tmpdir(), "vera-log-citations-"));
  try {
    const text = "INFO ready\n\u0000\n";
    await writeFile(join(root, "log.txt"), text);
    const ref = "log.txt#L1-L1";
    const message: Message = {
      role: "toolResult",
      toolName: "parse_log",
      toolCallId: "log",
      content: [
        {
          type: "text",
          text: JSON.stringify({
            source: {
              path: "log.txt",
              ref: "log.txt#L1-L2",
              sha256: createHash("sha256").update(text).digest("hex"),
            },
          }),
        },
      ],
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
    // REQ-FUNC-2e1261c2: board.txt#L2-L2 was not issued itself but lies inside the issued board.txt#L1-L2.
    expect(await validateCitations(root, refs.map((ref) => `[[${ref}]]`).join(" "), messages)).toEqual(
      refs.map((ref, i) => ({ ref, valid: i === 0 || i === 5 })),
    );
    expect(
      await validateCitations(
        root,
        "[[ref]] [[board.txt#L1-L2|Board]] [[ref:board.txt#L1-L2]] [[1]](board.txt#L1-L2) [[Board setup]]",
        messages,
      ),
    ).toEqual(
      ["ref", "board.txt#L1-L2|Board", "ref:board.txt#L1-L2", "1", "Board setup"].map((ref) => ({
        ref,
        valid: false,
      })),
    );
    expect(
      await validateCitations(root, "[[ref](board.txt#L1-L2)] 【board.txt#L1-L2】 board.txt#L1-L2", messages),
    ).toEqual([]);
    const result = messages[0];
    if (result?.role === "toolResult") result.isError = true;
    expect(await validateCitations(root, "[[board.txt#L1-L2]]", messages)).toEqual([
      { ref: refs[0], valid: false },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// REQ-FUNC-2e1261c2
it("accepts a line ref inside an issued window of the same file and nothing beyond it", async () => {
  const root = await mkdtemp(join(tmpdir(), "vera-citations-"));
  try {
    const text = Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join("\n");
    await writeFile(join(root, "a.txt"), `${text}\n`);
    await writeFile(join(root, "b.txt"), `${text}\n`);
    const messages: Message[] = [
      {
        role: "toolResult",
        toolName: "read",
        toolCallId: "c",
        content: [{ type: "text", text: JSON.stringify({ text: "...", ref: "a.txt#L3-L10" }) }],
        isError: false,
        timestamp: 0,
      },
    ];
    const cited = {
      "a.txt#L3-L10": true,
      "a.txt#L5-L6": true,
      "a.txt#L10-L10": true,
      "a.txt#L2-L4": false,
      "a.txt#L9-L11": false,
      "b.txt#L5-L6": false,
    };
    expect(
      await validateCitations(
        root,
        Object.keys(cited)
          .map((ref) => `[[${ref}]]`)
          .join(" "),
        messages,
      ),
    ).toEqual(Object.entries(cited).map(([ref, valid]) => ({ ref, valid })));
    const failed = { ...messages[0], isError: true } as Message;
    expect(await validateCitations(root, "[[a.txt#L5-L6]]", [failed])).toEqual([
      { ref: "a.txt#L5-L6", valid: false },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// REQ-FUNC-2e1261c2
it("keeps parse_log provenance for a line inside an issued log window", async () => {
  const root = await mkdtemp(join(tmpdir(), "vera-log-citations-"));
  try {
    const original = "INFO ready\n\u0000\nINFO done\n";
    await writeFile(join(root, "log.txt"), original);
    const message: Message = {
      role: "toolResult",
      toolName: "parse_log",
      toolCallId: "log",
      content: [
        {
          type: "text",
          text: JSON.stringify({
            source: {
              path: "log.txt",
              ref: "log.txt#L1-L3",
              sha256: createHash("sha256").update(original).digest("hex"),
            },
          }),
        },
      ],
      isError: false,
      timestamp: 0,
    };
    expect(await validateCitations(root, "[[log.txt#L2-L2]]", [message])).toEqual([
      { ref: "log.txt#L2-L2", valid: true },
    ]);
    expect(await validateCitations(root, "[[log.txt#L2-L2]]", [{ ...message, toolName: "read" }])).toEqual([
      { ref: "log.txt#L2-L2", valid: false },
    ]);
    await writeFile(join(root, "log.txt"), original.replace("ready", "stale"));
    expect(await validateCitations(root, "[[log.txt#L2-L2]]", [message])).toEqual([
      { ref: "log.txt#L2-L2", valid: false },
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

// REQ-UX-a318156e
it("accepts a help ref only when the help tool returned it", async () => {
  const root = await mkdtemp(join(tmpdir(), "vera-help-citations-"));
  try {
    const ref = "help:permissions";
    const message: Message = {
      role: "toolResult",
      toolName: "help",
      toolCallId: "help",
      content: [{ type: "text", text: JSON.stringify({ ref, title: "Permissions", text: "# Permissions" }) }],
      isError: false,
      timestamp: 0,
    };
    expect(await validateCitations(root, `See [[${ref}]].`, [message])).toEqual([{ ref, valid: true }]);
    expect(await validateCitations(root, "See [[help:plugins]].", [message])).toEqual([
      { ref: "help:plugins", valid: false },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// REQ-UX-a318156e
it("does not accept a help ref that another tool's result carried", async () => {
  const root = await mkdtemp(join(tmpdir(), "vera-help-citations-"));
  try {
    const ref = "help:permissions";
    const message: Message = {
      role: "toolResult",
      toolName: "read",
      toolCallId: "read",
      content: [{ type: "text", text: JSON.stringify({ ref }) }],
      isError: false,
      timestamp: 0,
    };
    expect(await validateCitations(root, `[[${ref}]]`, [message])).toEqual([{ ref, valid: false }]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("keeps a log citation valid for stray bytes, UTF-16 and lines appended after the analysis", async () => {
  const root = await mkdtemp(join(tmpdir(), "vera-log-citations-"));
  const issued = (bytes: Buffer, lines: number): Message => ({
    role: "toolResult",
    toolName: "parse_log",
    toolCallId: "log",
    content: [
      {
        type: "text",
        text: JSON.stringify({
          source: {
            path: "log.txt",
            ref: `log.txt#L1-L${lines}`,
            sha256: createHash("sha256").update(bytes).digest("hex"),
          },
          scan: { complete: true, stopReason: "eof", lines, bytes: bytes.length },
        }),
      },
    ],
    isError: false,
    timestamp: 0,
  });
  const cited = async (message: Message) =>
    (await validateCitations(root, "[[log.txt#L3-L3]]", [message]))[0]?.valid;
  try {
    const noisy = Buffer.concat([
      Buffer.from("INFO boot\n"),
      Buffer.from([0xff, 0xfe, 0xc3, 0x28, 0x0a]),
      Buffer.from("ERROR fault\n"),
    ]);
    await writeFile(join(root, "log.txt"), noisy);
    expect(await cited(issued(noisy, 3))).toBe(true);
    const wide = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from("INFO boot\r\nINFO up\r\nERROR fault\r\n", "utf16le"),
    ]);
    await writeFile(join(root, "log.txt"), wide);
    expect(await cited(issued(wide, 3))).toBe(true);
    // The device kept logging after the analysis: what was analysed is unchanged.
    const first = Buffer.from("INFO boot\nINFO up\nERROR fault\n");
    await writeFile(join(root, "log.txt"), Buffer.concat([first, Buffer.from("INFO still running\n")]));
    expect(await cited(issued(first, 3))).toBe(true);
    // The analysed part itself was rewritten.
    await writeFile(join(root, "log.txt"), "INFO boot\nINFO up\nERROR other\nINFO still running\n");
    expect(await cited(issued(first, 3))).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

import { mockDocument, mockDocuments } from "./documents.js";

export const mockTextPaths = [
  "text-samples/latin1.txt",
  "text-samples/utf16.txt",
  "text-samples/wrapped.log",
  "text-samples/invalid.txt",
];

/** Deterministic browser examples exercise the same byte protocol as native files. */
export function mockTextBytes(path: string): Uint8Array {
  if (path === "text-samples/latin1.txt") return Uint8Array.of(0x63, 0x61, 0x66, 0xe9, 0x20, 0xa3);
  if (path === "text-samples/utf16.txt") return Uint8Array.of(0xff, 0xfe, 0x63, 0, 0x61, 0, 0x66, 0, 0xe9, 0);
  if (path === "text-samples/invalid.txt") return Uint8Array.of(0x6f, 0x6b, 0xff, 0x0a, 0x65, 0x6e, 0x64);
  if (path === "text-samples/wrapped.log")
    return new TextEncoder().encode(
      Array.from(
        { length: 1500 },
        (_, i) => `Source ${i + 1} ${"measured wrapped words ".repeat(((i % 5) + 1) * 8)}`,
      ).join("\n"),
    );
  if (mockDocuments.some((doc) => doc.path === path && doc.kind === "text")) {
    const content = mockDocument(path, true);
    if (content.kind === "text") return new TextEncoder().encode(content.lines.join("\n"));
  }
  if (/\.(pdf|docx|pptx|xlsx|png|odt|odp|ods)$/i.test(path)) return Uint8Array.of(0, 1, 2, 3);
  return new TextEncoder().encode(
    path === "firmware/main.c" ? "int main(void) {\n  return 0;\n}" : `// ${path}`,
  );
}

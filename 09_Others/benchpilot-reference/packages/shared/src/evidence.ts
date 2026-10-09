// Evidence references (01): `ev:<owner>/<kind>/<locator>`. The agent cites them inline as `[[ev:…]]`.
//   pcap   → ev:RUN-0042/pcap/capture-lan/1532         (capture name / frame number)
//   log    → ev:RUN-0042/log/dut-syslog/218             (source / line number)
//   metric → ev:RUN-0042/metric/mem_free_kb/1765432100  (name / epoch seconds)
//   check  → ev:RUN-0042/check/lease_time               (evaluator check id)
//   doc    → ev:TB-01/doc/docs/lab-notes.md#sw-01       (testbench doc / heading anchor)

export type EvidenceKind = "pcap" | "log" | "metric" | "check" | "doc";

export type EvidenceRef =
  | { kind: "pcap"; ref: string; testRunId: string; capture: string; frame: number }
  | { kind: "log"; ref: string; testRunId: string; source: string; line: number }
  | { kind: "metric"; ref: string; testRunId: string; name: string; ts: number }
  | { kind: "check"; ref: string; testRunId: string; checkId: string }
  | { kind: "doc"; ref: string; testbenchId: string; path: string; anchor: string | null };

const RUN_ID = /^RUN-\d{4,}$/;
const TESTBENCH_ID = /^TB-[A-Za-z0-9-]+$/;
const NAME = /^[A-Za-z0-9_.-]+$/;
const UINT = /^\d+$/;

/** Parses one ref (the `ev:` prefix is required). Returns null when malformed. */
export function parseEvidenceRef(input: string): EvidenceRef | null {
  const ref = input.trim();
  if (!ref.startsWith("ev:")) return null;
  const parts = ref.slice(3).split("/");
  const [owner, kind] = parts;
  if (!owner || !kind) return null;

  if (kind === "doc") {
    if (!TESTBENCH_ID.test(owner)) return null;
    const rest = parts.slice(2).join("/");
    if (!rest) return null;
    const hash = rest.indexOf("#");
    const path = hash === -1 ? rest : rest.slice(0, hash);
    const anchor = hash === -1 ? null : rest.slice(hash + 1);
    if (!path || path.split("/").some((seg) => seg === "" || seg === "." || seg === ".." || !NAME.test(seg))) return null;
    if (anchor !== null && !/^[A-Za-z0-9_.-]+$/.test(anchor)) return null;
    return { kind: "doc", ref, testbenchId: owner, path, anchor };
  }

  if (!RUN_ID.test(owner)) return null;
  const [, , a, b, ...extra] = parts;
  if (extra.length) return null;

  switch (kind) {
    case "pcap":
      if (!a || !NAME.test(a) || !b || !UINT.test(b)) return null;
      return { kind, ref, testRunId: owner, capture: a, frame: Number(b) };
    case "log":
      if (!a || !NAME.test(a) || !b || !UINT.test(b)) return null;
      return { kind, ref, testRunId: owner, source: a, line: Number(b) };
    case "metric":
      if (!a || !NAME.test(a) || !b || !/^\d+(\.\d+)?$/.test(b)) return null;
      return { kind, ref, testRunId: owner, name: a, ts: Number(b) };
    case "check":
      if (!a || !NAME.test(a) || b !== undefined) return null;
      return { kind, ref, testRunId: owner, checkId: a };
    default:
      return null;
  }
}

export function formatEvidenceRef(ev: EvidenceRef): string {
  switch (ev.kind) {
    case "pcap":
      return `ev:${ev.testRunId}/pcap/${ev.capture}/${ev.frame}`;
    case "log":
      return `ev:${ev.testRunId}/log/${ev.source}/${ev.line}`;
    case "metric":
      return `ev:${ev.testRunId}/metric/${ev.name}/${ev.ts}`;
    case "check":
      return `ev:${ev.testRunId}/check/${ev.checkId}`;
    case "doc":
      return `ev:${ev.testbenchId}/doc/${ev.path}${ev.anchor ? `#${ev.anchor}` : ""}`;
  }
}

/** Compact chip label. The full ref goes in the tooltip. */
export function evidenceLabel(input: string | EvidenceRef): string {
  const ev = typeof input === "string" ? parseEvidenceRef(input) : input;
  if (!ev) return typeof input === "string" ? input.replace(/^ev:/, "") : "evidence";
  switch (ev.kind) {
    case "pcap":
      return `${ev.capture} #${ev.frame}`;
    case "log":
      return `${ev.source} L${ev.line}`;
    case "metric":
      return `${ev.name} @ ${new Date(ev.ts * 1000).toISOString().slice(11, 16)}`;
    case "check":
      return `check ${ev.checkId}`;
    case "doc": {
      const file = ev.path.split("/").pop() ?? ev.path;
      return ev.anchor ? `${file}#${ev.anchor}` : file;
    }
  }
}

/** `[[ev:…]]` inline citation. Inner text runs to the first `]]`. */
const CITATION = /\[\[(ev:[^\]\s]+)\]\]/g;

export type CitationSegment = { type: "text"; text: string } | { type: "ev"; ref: string };

/** Splits text into plain runs and `[[ev:…]]` citations, in order. */
export function splitCitations(text: string): CitationSegment[] {
  const out: CitationSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(CITATION)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ type: "text", text: text.slice(last, at) });
    out.push({ type: "ev", ref: m[1]! });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ type: "text", text: text.slice(last) });
  return out;
}

/** Unique cited refs in order of first appearance. */
export function extractCitations(text: string): string[] {
  const seen = new Set<string>();
  for (const seg of splitCitations(text)) if (seg.type === "ev") seen.add(seg.ref);
  return [...seen];
}

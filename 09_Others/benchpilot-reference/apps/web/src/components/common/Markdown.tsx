import { splitCitations, type Citation } from "@benchpilot/shared";
import { memo, type ComponentProps, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { EvidenceChip } from "@/components/evidence/EvidenceChip";
import { cn } from "@/lib/utils";
import { VerdictPill } from "./Pills";

interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  data?: { hName?: string; hProperties?: Record<string, string> };
}

/** remark plugin: `[[ev:…]]` inside text → `<ev-chip data-ref>` elements (01 inline citations). */
function remarkEvidence() {
  const walk = (node: MdNode) => {
    if (!node.children) return;
    node.children = node.children.flatMap((child): MdNode[] => {
      if (child.type !== "text" || !child.value?.includes("[[ev:")) {
        walk(child);
        return [child];
      }
      return splitCitations(child.value).map((seg) =>
        seg.type === "text" ? { type: "text", value: seg.text } : { type: "evidenceRef", data: { hName: "ev-chip", hProperties: { dataRef: seg.ref } } },
      );
    });
  };
  return (tree: MdNode) => walk(tree);
}

const VERDICT_WORDS: Record<string, "pass" | "fail" | "error"> = { PASS: "pass", FAIL: "fail", ERROR: "error" };

/** Table cell text like `FAIL` or `FAIL regression` → verdict pill + rest. */
function cellContent(children: ReactNode) {
  if (typeof children !== "string") return children;
  const m = /^(PASS|FAIL|ERROR)\b\s*(.*)$/.exec(children);
  if (!m) return children;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <VerdictPill state={VERDICT_WORDS[m[1]!]!} />
      {m[2] && <span>{m[2]}</span>}
    </span>
  );
}

function components(citations: Citation[]): Components {
  const valid = new Map(citations.map((c) => [c.ref, c.valid]));
  const custom: Record<string, (props: Record<string, unknown>) => ReactNode> = {
    "ev-chip": (props) => {
      const ref = String(props["data-ref"] ?? "");
      return <EvidenceChip evidenceRef={ref} valid={valid.get(ref) ?? true} />;
    },
  };
  return {
    p: ({ node: _n, ...p }) => <p className="max-w-[68ch]" {...p} />,
    ul: ({ node: _n, ...p }) => <ul className="grid max-w-[70ch] list-disc gap-1.5 pl-[18px]" {...p} />,
    ol: ({ node: _n, ...p }) => <ol className="grid max-w-[70ch] list-decimal gap-1.5 pl-[18px]" {...p} />,
    h1: ({ node: _n, ...p }) => <h2 className="text-[17px] font-semibold text-balance" {...p} />,
    h2: ({ node: _n, ...p }) => <h3 className="mt-1 text-[15px] font-semibold text-balance" {...p} />,
    h3: ({ node: _n, ...p }) => <h4 className="mt-1 text-sm font-semibold" {...p} />,
    h4: ({ node: _n, ...p }) => <h5 className="text-sm font-semibold" {...p} />,
    a: ({ node: _n, ...p }) => <a className="text-primary underline-offset-4 hover:underline" target="_blank" rel="noreferrer" {...p} />,
    strong: ({ node: _n, ...p }) => <strong className="font-semibold" {...p} />,
    hr: () => <hr className="border-border" />,
    blockquote: ({ node: _n, ...p }) => <blockquote className="border-l-2 border-border-strong pl-3 text-muted-foreground" {...p} />,
    code: ({ node: _n, className, ...p }) =>
      className ? (
        <code className={cn("font-mono text-[12px]", className)} {...p} />
      ) : (
        <code className="rounded bg-muted px-[5px] py-px font-mono text-[0.9em] break-words" {...p} />
      ),
    pre: ({ node: _n, ...p }) => <pre className="overflow-x-auto rounded-lg border bg-code p-3 text-[12px] leading-relaxed" {...p} />,
    table: ({ node: _n, ...p }) => (
      <div className="max-w-full overflow-x-auto rounded-lg border bg-card">
        <table className="w-full border-collapse text-[13px]" {...p} />
      </div>
    ),
    th: ({ node: _n, ...p }) => <th className="border-b bg-muted px-2.5 py-[7px] text-left text-xs font-medium whitespace-nowrap text-muted-foreground" {...p} />,
    td: ({ node: _n, children, ...p }) => (
      <td className="border-b px-2.5 py-[7px] align-top tabular-nums [tr:last-child_&]:border-b-0" {...p}>
        {cellContent(children)}
      </td>
    ),
    ...(custom as Components),
  };
}

interface MarkdownProps {
  children: string;
  citations?: Citation[];
  className?: string;
}

/** Assistant and document markdown: GFM tables, styled like the mockup, `[[ev:…]]` as evidence chips. */
export const Markdown = memo(function Markdown({ children, citations = [], className }: MarkdownProps) {
  return (
    <div className={cn("grid min-w-0 gap-2.5 text-sm leading-normal [&>*]:min-w-0", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkEvidence]} components={components(citations)}>
        {children}
      </ReactMarkdown>
    </div>
  );
});

export type MarkdownComponentProps = ComponentProps<typeof Markdown>;

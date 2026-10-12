// REQ-UX-4bea0002

import { parseRef, type Reference, referenceLabel } from "@vera/shared";
import { File, Files, Hash, List, Package, TriangleAlert } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

interface Node {
  type: string;
  value?: string;
  children?: Node[];
  data?: { hName: string; hProperties: Record<string, string> };
}
function remarkCitations() {
  function walk(node: Node) {
    if (!node.children) return;
    node.children = node.children.flatMap((child): Node[] => {
      if (child.type !== "text" || !child.value?.includes("[[")) {
        walk(child);
        return [child];
      }
      return child.value
        .split(/(\[\[[^\]\n]+\]\])/g)
        .filter(Boolean)
        .map((text) =>
          text.startsWith("[[") && text.endsWith("]]")
            ? {
                type: "citation",
                data: { hName: "vera-citation", hProperties: { dataRef: text.slice(2, -2) } },
              }
            : { type: "text", value: text },
        );
    });
  }
  return walk;
}
function CitationChip({ reference, valid }: { reference: string; valid: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const parsed = parseRef(reference);
  const label = referenceLabel(reference);
  if (!valid || !parsed)
    return (
      <button
        type="button"
        aria-disabled="true"
        data-citation="invalid"
        data-citation-kind={parsed?.kind ?? "unknown"}
        className="citation invalid"
        title={`${reference}: ${t("chat.invalidCitation")}`}
        aria-label={`${reference}: ${t("chat.invalidCitation")}`}
      >
        <TriangleAlert width="1em" height="1em" aria-hidden="true" /> {label}
      </button>
    );
  return (
    <>
      <button
        type="button"
        className="citation"
        data-citation="valid"
        data-citation-kind={parsed.kind}
        title={reference}
        aria-label={reference}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <CitationIcon kind={parsed.kind} /> {label}
      </button>
      {open && (
        <span role="status" className="citation-note">
          {t("chat.viewerPending")} {reference}
        </span>
      )}
    </>
  );
}
function CitationIcon({ kind }: { kind: Reference["kind"] }) {
  const Icon = { page: File, "page-range": Files, heading: Hash, lines: List, artifact: Package }[kind];
  return <Icon width="1em" height="1em" aria-hidden="true" />;
}
export function Markdown({
  text,
  citations = [],
}: {
  text: string;
  citations?: { ref: string; valid: boolean }[];
}) {
  const custom: Record<string, (props: Record<string, unknown>) => ReactNode> = {
    "vera-citation": (props) => {
      const reference = String(props["data-ref"] ?? "");
      return (
        <CitationChip reference={reference} valid={citations.some((c) => c.ref === reference && c.valid)} />
      );
    },
  };
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkCitations]}
        rehypePlugins={[rehypeHighlight]}
        skipHtml
        components={{
          ...(custom as Components),
          a: ({ children }) => <span className="markdown-link">{children}</span>,
          img: ({ alt }) => <span>{alt}</span>,
          table: ({ children }) => (
            <div className="markdown-table">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

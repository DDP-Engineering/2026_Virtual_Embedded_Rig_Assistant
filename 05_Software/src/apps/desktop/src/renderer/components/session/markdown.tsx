// REQ-UX-4bea0002

import { parseRef, type Reference, referenceLabel } from "@vera/shared";
import { File, Files, Hash, List, Package, TriangleAlert } from "lucide-react";
import { memo, type ReactNode, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { ExternalSourceLink } from "./external-source-link.js";

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
function CitationChip({
  reference,
  valid,
  onOpen,
}: {
  reference: string;
  valid: boolean;
  onOpen?: ((ref: string) => void) | undefined;
}) {
  const { t } = useTranslation();
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
    <button
      type="button"
      className="citation"
      data-citation="valid"
      data-citation-kind={parsed.kind}
      title={reference}
      aria-label={reference}
      onClick={() => onOpen?.(reference)}
      aria-haspopup="dialog"
    >
      <CitationIcon kind={parsed.kind} /> {label}
    </button>
  );
}
function CitationIcon({ kind }: { kind: Reference["kind"] }) {
  const Icon = { page: File, "page-range": Files, heading: Hash, lines: List, artifact: Package }[kind];
  return <Icon width="1em" height="1em" aria-hidden="true" />;
}
const remarkPlugins = [remarkGfm, remarkCitations];
const rehypePlugins = [rehypeHighlight];
const NO_CITATIONS: { ref: string; valid: boolean }[] = [];
/**
 * Renders message Markdown. Memoized on its props: the unified pipeline (GFM, citations, code
 * highlighting) runs again only when the text, the citations or the citation handler change (PERF-03).
 */
export const Markdown = memo(function Markdown({
  text,
  citations = NO_CITATIONS,
  onCitation,
}: {
  text: string;
  citations?: { ref: string; valid: boolean }[];
  onCitation?: ((ref: string) => void) | undefined;
}) {
  const options = useRef({ citations, onCitation });
  options.current = { citations, onCitation };
  // Keep chip DOM identity and keyboard focus through transcript refresh and modal updates.
  const components = useMemo<Components>(
    () => ({
      a: (props) => <ExternalSourceLink href={String(props.href ?? "")}>{props.children}</ExternalSourceLink>,
      ...({
        "vera-citation": (props: Record<string, unknown>): ReactNode => {
          const reference = String(props["data-ref"] ?? "");
          return (
            <CitationChip
              reference={reference}
              valid={options.current.citations.some((c) => c.ref === reference && c.valid)}
              onOpen={options.current.onCitation}
            />
          );
        },
      } as Components),
      img: ({ alt }) => <span>{alt}</span>,
      table: ({ children }) => (
        <div className="markdown-table">
          <table>{children}</table>
        </div>
      ),
    }),
    [],
  );
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        skipHtml
        components={components}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});

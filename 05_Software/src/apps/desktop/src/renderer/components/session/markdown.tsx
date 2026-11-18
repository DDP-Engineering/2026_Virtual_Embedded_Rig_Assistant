// REQ-UX-4bea0002

import { parseRef, type Reference, referenceLabel } from "@vera/shared";
import { CircleQuestionMark, File, Files, Hash, List, Package, TriangleAlert } from "lucide-react";
import { memo, type ReactNode, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { ExternalSourceLink } from "./external-source-link.js";
import { CodeBlock } from "./message-actions.js";

interface Node {
  type: string;
  value?: string;
  lang?: string | null;
  position?: { start: { offset?: number }; end: { offset?: number } };
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
  const Icon = {
    page: File,
    "page-range": Files,
    heading: Hash,
    lines: List,
    artifact: Package,
    help: CircleQuestionMark,
  }[kind];
  return <Icon width="1em" height="1em" aria-hidden="true" />;
}
function remarkBlockSource() {
  return (tree: Node, file: { value: unknown }) => {
    const source = String(file.value);
    function walk(node: Node) {
      if (node.type === "code") {
        const raw = source.slice(node.position?.start.offset, node.position?.end.offset);
        const lines = raw.split(/\r\n|\n|\r/);
        const opening = lines[0]?.match(/^ {0,3}(`{3,}|~{3,})/);
        const closing = lines.length > 1 ? lines.at(-1)?.match(/^[ >\t]*(`{3,}|~{3,})[ \t]*$/) : undefined;
        // The parser includes a fence-looking content line in value when it did not close the block.
        const contentLines = node.value ? node.value.split(/\r\n|\n|\r/).length : 0;
        const complete =
          !!opening &&
          !!closing &&
          lines.length >= contentLines + 2 &&
          opening[1]?.[0] === closing[1]?.[0] &&
          (closing[1]?.length ?? 0) >= (opening[1]?.length ?? 0);
        node.data = {
          hName: "code",
          hProperties: {
            "data-block-text": node.value ?? "",
            "data-block-language": node.lang ?? "",
            "data-block-complete": String(complete),
          },
        };
      }
      for (const child of node.children ?? []) walk(child);
    }
    walk(tree);
  };
}
const remarkPlugins = [remarkGfm, remarkCitations, remarkBlockSource];
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
  link,
  assistantActions = false,
  streaming = false,
}: {
  text: string;
  assistantActions?: boolean;
  streaming?: boolean;
  citations?: { ref: string; valid: boolean }[];
  onCitation?: ((ref: string) => void) | undefined;
  /** An in-app target for a link (help pages); other links stay external-confirmed or inert. */
  link?: ((href: string) => { page: string; open: () => void } | undefined) | undefined;
}) {
  const options = useRef({ citations, onCitation, link, assistantActions, streaming });
  options.current = { citations, onCitation, link, assistantActions, streaming };
  // Keep chip DOM identity and keyboard focus through transcript refresh and modal updates.
  const components = useMemo<Components>(
    () => ({
      a: (props) => {
        const href = String(props.href ?? "");
        const target = options.current.link?.(href);
        return target ? (
          <button type="button" className="markdown-link" data-help-link={target.page} onClick={target.open}>
            {props.children}
          </button>
        ) : (
          <ExternalSourceLink href={href}>{props.children}</ExternalSourceLink>
        );
      },
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
      code: ({ children, className }) => <code className={className}>{children}</code>,
      pre: ({ children, node }) => {
        const code = node?.children[0];
        if (!options.current.assistantActions || code?.type !== "element") return <pre>{children}</pre>;
        return (
          <CodeBlock
            text={String(code.properties["data-block-text"] ?? "")}
            language={String(code.properties["data-block-language"] ?? "")}
            streaming={options.current.streaming || code.properties["data-block-complete"] !== "true"}
          >
            {children}
          </CodeBlock>
        );
      },
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

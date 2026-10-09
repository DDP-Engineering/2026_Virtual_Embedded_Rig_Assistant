import type { TestbenchDoc } from "@benchpilot/shared";
import { Pencil, Pin, Save, Upload } from "lucide-react";
import { useRef, useState, type ChangeEvent } from "react";
import { toast } from "sonner";
import { useCreateDoc, useDocs, useSaveDoc } from "@/api/queries";
import { EmptyState } from "@/components/common/Bits";
import { Markdown } from "@/components/common/Markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Box } from "./parts";

export const MD_ACCEPT = ".md,.markdown,text/markdown";

export const isMarkdownFile = (name: string) => /\.(md|markdown)$/i.test(name);

/** Mockup copy: TESTBENCH.md is always in the system prompt, the rest is found by search. */
export function docLabel(doc: Pick<TestbenchDoc, "path" | "pinned">) {
  if (doc.pinned) return "Agent instructions — always loaded";
  if (doc.path.endsWith("topology.yaml")) return "Searchable · drives the diagram";
  return "Searchable";
}

/** YAML (topology.yaml) renders as a code block; markdown as-is. */
export const docMarkdown = (doc: Pick<TestbenchDoc, "path">, content: string) => (/\.ya?ml$/i.test(doc.path) ? "```yaml\n" + content.replace(/\n$/, "") + "\n```" : content);

const shortPath = (path: string) => path.replace(/^docs\//, "");

function sortDocs(docs: TestbenchDoc[]) {
  return [...docs].sort((a, b) => Number(b.pinned) - Number(a.pinned));
}

/** `My Notes (v2).md` → `docs/My-Notes-v2-.md`: the server accepts only `[A-Za-z0-9_.-]` names under docs/. */
export function docPathFor(fileName: string): string {
  return `docs/${fileName.replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^[.-]+/, "") || "document.md"}`;
}

/** Reads a picked file as text; rejects non-markdown files with a toast. */
export async function readMarkdownFile(file: File): Promise<string | null> {
  if (!isMarkdownFile(file.name)) {
    toast.error(`${file.name} is not a markdown file`);
    return null;
  }
  return file.text();
}

export function DocumentsTab({ testbenchId }: { testbenchId: string }) {
  const { data: docs, isPending, error } = useDocs(testbenchId);
  const saveDoc = useSaveDoc(testbenchId);
  const createDoc = useCreateDoc(testbenchId);
  const fileRef = useRef<HTMLInputElement>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState<string | null>(null);

  if (isPending)
    return (
      <div className="grid grid-cols-[minmax(200px,260px)_minmax(0,1fr)] items-start gap-4">
        <Skeleton className="h-72 rounded-[10px]" />
        <Skeleton className="h-96 rounded-[10px]" />
      </div>
    );
  if (error) return <EmptyState>Could not load documents: {error.message}</EmptyState>;

  const sorted = sortDocs(docs);
  const doc = sorted.find((d) => d.id === selectedId) ?? sorted[0];
  const editing = draft !== null;
  const dirty = editing && draft !== doc?.content;

  const select = (id: number) => {
    if (id === doc?.id) return;
    if (dirty && !window.confirm("Discard unsaved changes?")) return;
    setDraft(null);
    setSelectedId(id);
  };

  const onUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const content = await readMarkdownFile(file);
    if (content === null) return;
    createDoc.mutate(
      { path: docPathFor(file.name), content },
      {
        onSuccess: (created) => {
          toast.success(`Uploaded ${created.path} · search index updated`);
          setDraft(null);
          setSelectedId(created.id);
        },
        onError: (err) => toast.error(`Upload failed: ${err.message}`),
      },
    );
  };

  const onSave = () => {
    if (!doc || draft === null) return;
    saveDoc.mutate(
      { docId: doc.id, content: draft },
      {
        onSuccess: () => {
          toast.success("Saved · search index updated");
          setDraft(null);
        },
        onError: (err) => toast.error(`Save failed: ${err.message}`),
      },
    );
  };

  return (
    <div className="grid grid-cols-[minmax(200px,260px)_minmax(0,1fr)] items-start gap-4">
      <Box>
        <nav aria-label="Documents" className="grid gap-0.5">
          {sorted.map((d) => (
            <button
              key={d.id}
              type="button"
              aria-current={d.id === doc?.id ? "true" : undefined}
              onClick={() => select(d.id)}
              title={`${d.path} — ${docLabel(d)}`}
              className={cn(
                "grid gap-0.5 rounded-md px-2.5 py-[7px] text-left text-[13px] hover:bg-accent",
                d.id === doc?.id && "bg-primary-soft hover:bg-primary-soft",
              )}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate font-mono text-[12.5px]">{shortPath(d.path)}</span>
                {d.pinned && <Pin className="size-3 shrink-0 text-primary" aria-label="Pinned" />}
              </span>
              <small className="truncate text-[11px] text-faint-foreground">{d.pinned ? "Always loaded" : "Searchable"}</small>
            </button>
          ))}
        </nav>
        <input ref={fileRef} type="file" accept={MD_ACCEPT} className="hidden" onChange={(e) => void onUpload(e)} />
        <Button variant="outline" className="justify-self-start" disabled={createDoc.isPending} onClick={() => fileRef.current?.click()}>
          <Upload aria-hidden="true" />
          {createDoc.isPending ? "Uploading…" : "Upload .md"}
        </Button>
      </Box>

      {doc ? (
        <Box>
          <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 truncate font-mono text-[13px]" title={doc.path}>
              {doc.path}
            </span>
            <Badge variant={doc.pinned ? "default" : "secondary"} className={doc.pinned ? "bg-primary-soft text-primary" : undefined}>
              {docLabel(doc)}
            </Badge>
            <span className="flex-1" />
            {editing ? (
              <>
                {dirty && <span className="text-xs text-warn">Unsaved changes</span>}
                <Button variant="ghost" disabled={saveDoc.isPending} onClick={() => setDraft(null)}>
                  Cancel
                </Button>
                <Button disabled={!dirty || saveDoc.isPending} onClick={onSave}>
                  <Save aria-hidden="true" />
                  {saveDoc.isPending ? "Saving…" : "Save"}
                </Button>
              </>
            ) : (
              <Button variant="outline" onClick={() => setDraft(doc.content)}>
                <Pencil aria-hidden="true" />
                Edit
              </Button>
            )}
          </div>
          {editing ? (
            <div className="grid grid-cols-2 gap-3">
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                spellCheck={false}
                aria-label={`Edit ${doc.path}`}
                className="min-h-[520px] resize-y bg-code font-mono text-[12.5px] leading-relaxed"
              />
              <div className="min-w-0 overflow-auto rounded-lg border px-3.5 py-3" aria-label="Preview">
                <Markdown className="text-[13.5px]">{docMarkdown(doc, draft)}</Markdown>
              </div>
            </div>
          ) : (
            <Markdown className="max-w-[72ch] text-[13.5px]">{docMarkdown(doc, doc.content)}</Markdown>
          )}
        </Box>
      ) : (
        <EmptyState>No documents yet. Upload a .md file to start.</EmptyState>
      )}
    </div>
  );
}

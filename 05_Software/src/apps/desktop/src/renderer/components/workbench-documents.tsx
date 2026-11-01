import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  type DocumentScanKind,
  documentFolderPattern,
  documentPatternFolder,
  type WorkbenchConfig,
} from "@vera/shared";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/index.js";
import { useBytes } from "../lib/bytes.js";
import { VolumeWarning } from "./documents/volume-warning.js";
import { ErrorMessage } from "./error-message.js";

type Docs = WorkbenchConfig["docs"];
const clean = (values: readonly string[]) => values.map((s) => s.trim()).filter(Boolean);
const kindOrder: DocumentScanKind[] = ["pdf", "office", "markdown", "html", "text"];
// The folder's contents can change between visits, so scans and previews are never served from cache.
const fresh = { staleTime: 0, gcTime: 0, refetchOnMount: "always" } as const;

/** The value after it has stopped changing for `delay` milliseconds. */
function useSettled<T>(value: T, delay: number): T {
  const [settled, setSettled] = useState(value);
  const key = JSON.stringify(value);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the serialized key stands for the value.
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [key, delay]);
  return settled;
}

/** Documentation folders of a workbench folder: detected checkboxes, Add folder, preview and raw globs. */
export function WorkbenchDocuments({
  folder,
  docs,
  setDocs,
  disabled = false,
}: {
  folder: string;
  docs: Docs;
  setDocs: (docs: Docs) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const bytes = useBytes();
  const heading = useId();
  const [error, setError] = useState<unknown>();
  const kinds: Record<DocumentScanKind, string> = {
    pdf: t("documentsSetup.kindPdf"),
    office: t("documentsSetup.kindOffice"),
    markdown: t("documentsSetup.kindMarkdown"),
    html: t("documentsSetup.kindHtml"),
    text: t("documentsSetup.kindText"),
  };
  const include = clean(docs.include);
  const exclude = clean(docs.exclude);
  const scan = useQuery({
    queryKey: ["workbench.scanDocs", folder],
    queryFn: () => api.invoke("workbench.scanDocs", { folder }),
    ...fresh,
  });
  // Typing a pattern under Advanced walks the folder once it pauses, not on every keystroke.
  const settled = useSettled({ include, exclude }, 300);
  const preview = useQuery({
    queryKey: ["workbench.previewDocs", folder, settled.include, settled.exclude],
    queryFn: () => api.invoke("workbench.previewDocs", { folder, ...settled }),
    placeholderData: keepPreviousData,
    ...fresh,
  });
  const detected = scan.data?.folders ?? [];
  // Literal folder patterns that the scan did not report: added by hand, or listed in the YAML.
  // They stay listed after unchecking so keyboard focus is not lost.
  const [manual, setManual] = useState<string[]>([]);
  const listed = include
    .map(documentPatternFolder)
    .filter((path): path is string => !!path && !detected.some((f) => f.path === path));
  // Until the scan answers, rows would be mislabelled and then remounted, so they wait for it.
  const others = scan.isPending
    ? []
    : [...new Set([...manual, ...listed])]
        .filter((path) => !detected.some((f) => f.path === path))
        // A stable order keeps rows in place when one is unchecked and moves between the sources.
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  function toggle(path: string, checked: boolean) {
    const pattern = documentFolderPattern(path);
    if (!checked && !detected.some((f) => f.path === path))
      setManual((current) => (current.includes(path) ? current : [...current, path]));
    setDocs({
      ...docs,
      include: checked
        ? [...include.filter((p) => p !== pattern), pattern]
        : include.filter((p) => p !== pattern),
    });
  }
  async function addFolder() {
    setError(undefined);
    try {
      // Documentation folders live inside the workbench, so browsing starts at its root.
      const picked = await api.invoke("app.chooseFolder", { start: folder });
      if (!picked.folder) return;
      const { path } = await api.invoke("workbench.relativeFolder", { root: folder, folder: picked.folder });
      setManual((current) => (current.includes(path) ? current : [...current, path]));
      if (!include.includes(documentFolderPattern(path)))
        setDocs({ ...docs, include: [...include, documentFolderPattern(path)] });
    } catch (failure) {
      setError(failure);
    }
  }
  const summary = (entry: (typeof detected)[number]) =>
    [
      ...kindOrder.filter((k) => entry.kinds[k]).map((k) => `${entry.kinds[k]} ${kinds[k]}`),
      bytes(entry.bytes),
    ].join(" · ");
  const row = (path: string, detail: string) => (
    <li key={path}>
      <label className="workbench-tool-option" data-docs-folder={path}>
        <input
          type="checkbox"
          disabled={disabled}
          checked={include.includes(documentFolderPattern(path))}
          onChange={(e) => toggle(path, e.currentTarget.checked)}
        />
        <span>
          <strong>{path}/</strong>
          <span className="muted">{detail}</span>
        </span>
      </label>
    </li>
  );
  return (
    <div className="workbench-documents" data-docs>
      <p id={heading}>{t("projects.sourceInfo")}</p>
      {error !== undefined && <ErrorMessage error={error} />}
      {scan.isError && <ErrorMessage error={scan.error} />}
      {scan.isPending && <p role="status">{t("documentsSetup.scanning")}</p>}
      {scan.data && detected.length === 0 && (
        <p className="muted" data-docs-none>
          {t("documentsSetup.noneDetected")}
        </p>
      )}
      <ul className="workbench-documents-list" aria-labelledby={heading}>
        {detected.map((entry) => row(entry.path, summary(entry)))}
        {others.map((path) => row(path, t("documentsSetup.addedByHand")))}
      </ul>
      {scan.data?.truncated && <p className="muted">{t("documentsSetup.truncated")}</p>}
      <button
        type="button"
        data-action="add-docs-folder"
        disabled={disabled}
        onClick={() => void addFolder()}
      >
        {t("documentsSetup.addFolder")}
      </button>
      {preview.data && (
        <p role="status" data-docs-preview>
          {t("documentsSetup.preview", { count: preview.data.files, size: bytes(preview.data.bytes) })}
          {preview.data.officePending > 0 &&
            ` ${t("documentsSetup.officePending", { count: preview.data.officePending })}`}
          {preview.data.truncated && ` ${t("documentsSetup.truncated")}`}
        </p>
      )}
      {preview.data && <VolumeWarning volume={preview.data} preview />}
      {preview.isError && <ErrorMessage error={preview.error} />}
      <details className="workbench-documents-advanced" data-docs-advanced>
        <summary>{t("documentsSetup.advanced")}</summary>
        <label>
          {t("projects.include")}
          <textarea
            data-project-include
            disabled={disabled}
            value={docs.include.join("\n")}
            onChange={(e) => setDocs({ ...docs, include: e.target.value.split("\n") })}
          />
        </label>
        <label>
          {t("projects.exclude")}
          <textarea
            disabled={disabled}
            value={docs.exclude.join("\n")}
            onChange={(e) => setDocs({ ...docs, exclude: e.target.value.split("\n") })}
          />
        </label>
      </details>
    </div>
  );
}

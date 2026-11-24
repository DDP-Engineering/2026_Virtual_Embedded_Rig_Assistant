import { useId, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

/** Searches the tab strip's current Display-safe labels and paths. */
export function TabSearch({
  tabs,
  select,
  dismiss,
}: {
  tabs: readonly { key: string; label: string; title: string }[];
  select: (key: string) => void;
  dismiss: () => void;
}) {
  const { t, i18n } = useTranslation();
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const lower = (value: string) => value.toLocaleLowerCase(i18n.resolvedLanguage);
  const filter = lower(query.trim());
  const matches = tabs.filter(
    ({ label, title }) => lower(label).includes(filter) || lower(title).includes(filter),
  );
  const resultButtons = () => [
    ...(dialog.current?.querySelectorAll<HTMLButtonElement>("[data-tab-result]") ?? []),
  ];
  useLayoutEffect(() => {
    const node = dialog.current;
    node?.showModal();
    input.current?.focus();
    return () => node?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="pinned-dialog tab-search-dialog"
      data-tab-search
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        dismiss();
      }}
    >
      <h2 id={titleId}>{t("documents.searchTabs")}</h2>
      <input
        ref={input}
        type="search"
        aria-label={t("documents.filterTabs")}
        placeholder={t("documents.filterTabs")}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            resultButtons()
              .at(event.key === "ArrowDown" ? 0 : -1)
              ?.focus();
          } else if (event.key === "Enter" && matches[0]) {
            event.preventDefault();
            select(matches[0].key);
          }
        }}
      />
      {matches.length === 0 ? (
        <p role="status">{t("documents.noMatchingTabs")}</p>
      ) : (
        <ul className="tab-search-results">
          {matches.map(({ key, label, title }, index) => (
            <li key={key}>
              <button
                type="button"
                data-tab-result
                onClick={() => select(key)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    event.preventDefault();
                    const next = index + (event.key === "ArrowDown" ? 1 : -1);
                    if (next < 0) input.current?.focus();
                    else resultButtons()[next]?.focus();
                  } else if (event.key === "Enter") {
                    event.preventDefault();
                    select(key);
                  }
                }}
              >
                <span>{label}</span>
                {title !== label && <small>{title}</small>}
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" onClick={dismiss}>
        {t("workbench.cancel")}
      </button>
    </dialog>
  );
}

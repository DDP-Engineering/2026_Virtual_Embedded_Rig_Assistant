import type { RecentWorkbenchState } from "@vera/shared";
import type { ReactNode } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

export function WorkbenchNavigation({
  entries,
  activeId,
  disabled,
  settingsReadOnly,
  open,
  pin,
  edit,
  reveal,
  remove,
  close,
  children,
}: {
  entries: RecentWorkbenchState[];
  activeId: string | undefined;
  disabled: boolean;
  settingsReadOnly: boolean;
  open: (folder: string) => Promise<boolean>;
  pin: (folder: string, value: boolean) => void;
  edit: (folder: string) => void;
  reveal: (folder: string) => void;
  remove: (folder: string) => void;
  close?: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem("vera.workbench.expanded") ?? "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? Object.fromEntries(Object.entries(parsed).filter(([, v]) => typeof v === "boolean"))
        : {};
    } catch {
      return {};
    }
  });
  function expand(folder: string, value: boolean) {
    setExpanded((old) => {
      const next = { ...old, [folder]: value };
      try {
        localStorage.setItem("vera.workbench.expanded", JSON.stringify(next));
      } catch {}
      return next;
    });
  }
  return (
    <section className="workbench-navigation" aria-label={t("welcome.workbenches")}>
      <strong>{t("welcome.workbenches")}</strong>
      {!entries.length && <p>{t("projects.empty")}</p>}
      {[...entries]
        .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned))
        .map((entry) => {
          const active = entry.id === activeId;
          const shown = expanded[entry.folder] ?? active;
          return (
            <div
              key={entry.folder}
              className="workbench-group"
              data-workbench-entry={entry.id}
              data-pinned={!!entry.pinned}
            >
              <div className="workbench-group-heading">
                <button
                  type="button"
                  disabled={disabled || entry.missing}
                  aria-expanded={shown}
                  aria-controls={`sessions-${entry.id}`}
                  aria-label={(shown ? t("projects.collapse") : t("projects.expand")) + ": " + entry.name}
                  onClick={() => {
                    if (!shown && !active)
                      void open(entry.folder).then((ok) => {
                        if (ok) expand(entry.folder, true);
                      });
                    else expand(entry.folder, !shown);
                  }}
                >
                  {shown ? "▾" : "▸"}
                </button>
                <button
                  type="button"
                  className="workbench-group-name"
                  disabled={disabled || entry.missing}
                  aria-current={active ? "page" : undefined}
                  onClick={() => {
                    void open(entry.folder).then((ok) => {
                      if (ok) expand(entry.folder, true);
                    });
                  }}
                >
                  {entry.pinned && (
                    <span role="img" aria-label={t("projects.pin")}>
                      📌{" "}
                    </span>
                  )}
                  {entry.name}
                </button>
                <details
                  className="workbench-menu"
                  onClickCapture={(event) => {
                    if ((event.target as HTMLElement).closest("button")) event.currentTarget.open = false;
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.currentTarget.open = false;
                      event.currentTarget.querySelector("summary")?.focus();
                    }
                  }}
                >
                  <summary aria-label={t("projects.menu") + ": " + entry.name}>⋯</summary>
                  <div>
                    <button
                      type="button"
                      disabled={disabled || settingsReadOnly}
                      onClick={() => pin(entry.folder, !entry.pinned)}
                    >
                      {entry.pinned ? t("projects.unpin") : t("projects.pin")}
                    </button>
                    <button
                      type="button"
                      disabled={disabled || entry.missing}
                      onClick={() => edit(entry.folder)}
                    >
                      {t("projects.edit")}
                    </button>
                    <button
                      type="button"
                      disabled={disabled || entry.missing}
                      onClick={() => reveal(entry.folder)}
                    >
                      {t("projects.explorer")}
                    </button>
                    {active && close && (
                      <button type="button" data-action="close-workbench" disabled={disabled} onClick={close}>
                        {t("workbench.close")}
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={disabled || settingsReadOnly}
                      onClick={() => remove(entry.folder)}
                    >
                      {t("projects.remove")}
                    </button>
                  </div>
                </details>
              </div>
              {entry.missing && <small>{t("workbench.missing")}</small>}
              <div id={`sessions-${entry.id}`} hidden={!shown}>
                {active
                  ? children
                  : shown && (
                      <button
                        type="button"
                        disabled={disabled || entry.missing}
                        onClick={() => void open(entry.folder)}
                      >
                        {t("projects.expand")}
                      </button>
                    )}
              </div>
            </div>
          );
        })}
    </section>
  );
}

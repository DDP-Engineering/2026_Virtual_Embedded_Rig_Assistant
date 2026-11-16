import type { CommandPrefixDisplay } from "@vera/shared";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/index.js";
import { ErrorMessage } from "./error-message.js";
import { Pager, usePaged } from "./pager.js";

/** Paths are presentation only; Save uses identities of native host selections. */
export function WorkbenchFolders({
  workbenchId,
  disabled = false,
  added = [],
  removed = [],
  change,
  live = false,
}: {
  workbenchId: string;
  live?: boolean;
  disabled?: boolean;
  added?: readonly CommandPrefixDisplay[];
  removed?: readonly string[];
  change?: ((added: CommandPrefixDisplay[], removed: string[]) => void) | undefined;
}) {
  const { t } = useTranslation();
  const [folders, setFolders] = useState<CommandPrefixDisplay[]>([]);
  const [error, setError] = useState<unknown>();
  const [pending, setPending] = useState(false);
  useEffect(() => {
    let current = true;
    let generation = 0;
    const load = () => {
      const version = ++generation;
      void api.invoke("workbench.additionalFolders.list", { workbenchId }).then(
        (entries) => {
          if (current && version === generation) {
            setFolders(entries);
            setError(undefined);
          }
        },
        (failure) => {
          if (current && version === generation) setError(failure);
        },
      );
    };
    load();
    const off = live
      ? api.subscribe("workbench", workbenchId, (event) => {
          if (event.type === "config.changed") load();
        })
      : () => {};
    return () => {
      current = false;
      off();
    };
  }, [workbenchId, live]);
  const entries = [
    ...folders.filter(({ id }) => !removed.includes(id)),
    ...added.filter(({ id }) => !folders.some((folder) => folder.id === id)),
  ];
  const { rows, pager } = usePaged(entries);
  async function choose() {
    if (!change || disabled || pending) return;
    setPending(true);
    setError(undefined);
    try {
      const folder = await api.invoke("workbench.additionalFolders.choose", { workbenchId });
      if (folder)
        change(
          [...added.filter(({ id }) => id !== folder.id), folder],
          removed.filter((id) => id !== folder.id),
        );
    } catch (failure) {
      setError(failure);
    } finally {
      setPending(false);
    }
  }
  return (
    <section data-additional-folders aria-label={t("folders.title")}>
      <h4>{t("folders.title")}</h4>
      {change && (
        <button
          type="button"
          data-add-folder
          disabled={disabled || pending || entries.length >= 64}
          onClick={() => void choose()}
        >
          {t("folders.add")}
        </button>
      )}
      {error !== undefined && <ErrorMessage error={error} />}
      <ul>
        {rows.map(({ id, label }) => (
          <li key={id}>
            {change && (
              <button
                type="button"
                data-remove-folder
                disabled={disabled || pending}
                aria-label={t("folders.remove", { folder: label })}
                onClick={() =>
                  change(
                    added.filter((folder) => folder.id !== id),
                    folders.some((folder) => folder.id === id)
                      ? [...new Set([...removed, id])]
                      : [...removed],
                  )
                }
              >
                {t("approval.remove")}
              </button>
            )}{" "}
            <span className="path-text">{label}</span>
          </li>
        ))}
      </ul>
      <Pager {...pager} />
    </section>
  );
}

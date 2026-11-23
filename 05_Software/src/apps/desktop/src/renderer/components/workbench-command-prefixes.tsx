import type { CommandPrefixDisplay } from "@vera/shared";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/index.js";
import { ErrorMessage } from "./error-message.js";
import { Pager, usePaged } from "./pager.js";

/** Saved command grants remain a draft until the workbench editor saves. */
export function WorkbenchCommandPrefixes({
  workbenchId,
  removed,
  remove,
  disabled,
}: {
  workbenchId: string;
  removed: readonly string[];
  remove(id: string): void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const [prefixes, setPrefixes] = useState<CommandPrefixDisplay[]>([]);
  const [error, setError] = useState<unknown>();
  useEffect(() => {
    let current = true;
    void api.invoke("workbench.commandPrefixes.list", { workbenchId }).then(
      (entries) => {
        if (current) {
          setPrefixes(entries);
          setError(undefined);
        }
      },
      (failure) => {
        if (current) setError(failure);
      },
    );
    return () => {
      current = false;
    };
  }, [workbenchId]);
  const { rows, pager } = usePaged(prefixes.filter(({ id }) => !removed.includes(id)));
  if (!rows.length && error === undefined) return null;
  return (
    <section data-command-prefixes aria-label={t("approval.allowedCommands")}>
      <h4>{t("approval.allowedCommands")}</h4>
      {error !== undefined && <ErrorMessage error={error} />}
      <ul>
        {rows.map(({ id, label }) => (
          <li key={id}>
            <button
              type="button"
              data-remove-command-prefix
              disabled={disabled}
              onClick={() => remove(id)}
              aria-label={t("approval.removePrefix", { prefix: label })}
            >
              {t("approval.remove")}
            </button>{" "}
            <code>{label}</code>
          </li>
        ))}
      </ul>
      <Pager {...pager} />
    </section>
  );
}

// REQ-UX-0f1a32c4 REQ-FUNC-37261edc
import { type BuiltinToolName, builtinToolNames } from "@vera/shared";
import { useId } from "react";
import { useTranslation } from "react-i18next";

export function WorkbenchTools({
  disabled,
  toggle,
}: {
  disabled: readonly string[];
  toggle: (name: BuiltinToolName, enabled: boolean) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const descriptions: Record<BuiltinToolName, string> = {
    read: t("workbenchTools.read"),
    list: t("workbenchTools.list"),
    glob: t("workbenchTools.glob"),
    grep: t("workbenchTools.grep"),
    write: t("workbenchTools.write"),
    edit: t("workbenchTools.edit"),
    artifact_save: t("workbenchTools.artifact_save"),
    todo: t("workbenchTools.todo"),
    search_docs: t("workbenchTools.search_docs"),
    read_doc: t("workbenchTools.read_doc"),
    load_skill: t("workbenchTools.load_skill"),
    web_search: t("workbenchTools.web_search"),
    web_read: t("workbenchTools.web_read"),
    web_download: t("workbenchTools.web_download"),
  };
  return (
    <div className="workbench-tools">
      <p className="muted">{t("workbenchTools.hint")}</p>
      <ul>
        {builtinToolNames.map((name) => (
          <li key={name}>
            <label className="workbench-tool-option">
              <input
                type="checkbox"
                data-tool-toggle={name}
                aria-label={name}
                aria-describedby={`${id}-${name}`}
                checked={!disabled.includes(name)}
                onChange={(event) => toggle(name, event.currentTarget.checked)}
              />
              <span>
                <strong>{name}</strong>
                <span id={`${id}-${name}`} data-tool-description={name} className="muted">
                  {descriptions[name]}
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

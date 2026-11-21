import { useTranslation } from "react-i18next";
import { modelOptionLabel, useModelCatalog } from "./model-catalog.js";

/**
 * A conversation model for a workbench: empty means the application default; the known models are
 * offered as suggestions, and any other reference can still be typed.
 */
export function ModelSelect({
  id,
  value,
  change,
  disabled,
}: {
  id: string;
  value: string | null;
  change: (model: string | null) => void;
  disabled?: boolean | undefined;
}) {
  const { t, i18n } = useTranslation();
  const { models, connections } = useModelCatalog();
  return (
    <>
      <input
        id={id}
        data-project-model
        list={`${id}-options`}
        placeholder={t("overview.appDefault")}
        value={value ?? ""}
        disabled={disabled}
        onChange={(event) => change(event.target.value.trim() || null)}
      />
      <datalist id={`${id}-options`}>
        {models.map((model) => (
          <option
            key={model.reference}
            value={model.reference}
            label={modelOptionLabel(model, connections, t, i18n.language)}
          />
        ))}
      </datalist>
    </>
  );
}

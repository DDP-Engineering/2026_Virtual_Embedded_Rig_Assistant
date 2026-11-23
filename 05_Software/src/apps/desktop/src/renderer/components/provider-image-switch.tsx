import { useTranslation } from "react-i18next";

export function ProviderImageSwitch({
  model,
  imageModels,
  setImageModels,
}: {
  model: string;
  imageModels: string[];
  setImageModels: (models: string[]) => void;
}) {
  const { t } = useTranslation();
  const enabled = imageModels.includes(model);
  return (
    <label className="provider-checkbox">
      <input
        type="checkbox"
        role="switch"
        aria-checked={enabled}
        checked={enabled}
        disabled={!/^\S+$/.test(model)}
        onChange={(event) =>
          setImageModels(
            event.target.checked ? [...imageModels, model] : imageModels.filter((id) => id !== model),
          )
        }
      />
      <span>{t("providers.acceptsImages")}</span>
    </label>
  );
}

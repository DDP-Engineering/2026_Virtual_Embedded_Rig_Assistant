import { curatedProviderPresets, providerChoices } from "@vera/shared";
import { useId } from "react";
import { useTranslation } from "react-i18next";

/** One dropdown of every provider VERA can connect; already connected single-instance ones are disabled. */
export function ProviderPresetSelector({
  value,
  change,
  disabled,
  hasOpenai,
  hasChatgpt,
}: {
  value: string;
  change: (id: string) => void;
  disabled: boolean;
  hasOpenai: boolean;
  hasChatgpt: boolean;
}) {
  const { t } = useTranslation();
  const id = useId();
  const choices = [
    { id: "chatgpt", label: t("chatgpt.title") },
    { id: "openai", label: t("providers.openai") },
    { id: "lmstudio", label: providerChoices.lmstudio.label },
    { id: "ollama", label: providerChoices.ollama.label },
    { id: "other", label: t("providers.other") },
    ...curatedProviderPresets,
  ];
  return (
    <>
      <label htmlFor={id}>{t("providers.provider")}</label>
      <select
        id={id}
        data-provider-preset
        value={value}
        disabled={disabled}
        onChange={(event) => change(event.target.value)}
      >
        {choices.map((choice) => (
          <option
            key={choice.id}
            value={choice.id}
            disabled={(choice.id === "openai" && hasOpenai) || (choice.id === "chatgpt" && hasChatgpt)}
          >
            {choice.label}
          </option>
        ))}
      </select>
    </>
  );
}

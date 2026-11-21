import { curatedProviderPresets, providerChoices } from "@vera/shared";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

export function ProviderPresetSelector({
  value,
  change,
  disabled,
  hasOpenai,
}: {
  value: string;
  change: (id: string) => void;
  disabled: boolean;
  hasOpenai: boolean;
}) {
  const { t } = useTranslation();
  const prefix = useId();
  const [search, setSearch] = useState("");
  const choices = [
    { id: "openai", label: t("providers.openai") },
    { id: "lmstudio", label: providerChoices.lmstudio.label },
    { id: "ollama", label: providerChoices.ollama.label },
    { id: "other", label: t("providers.other") },
    ...curatedProviderPresets,
  ];
  const term = search.trim().toLocaleLowerCase();
  const matches = choices.filter(({ id, label }) =>
    [id, label].some((text) => text.toLocaleLowerCase().includes(term)),
  );
  return (
    <>
      <label htmlFor={`${prefix}-search`}>{t("providers.search")}</label>
      <input
        id={`${prefix}-search`}
        type="search"
        value={search}
        disabled={disabled}
        onChange={(event) => setSearch(event.target.value)}
      />
      <label htmlFor={`${prefix}-preset`}>{t("providers.provider")}</label>
      <select
        id={`${prefix}-preset`}
        data-provider-preset
        value={value}
        disabled={disabled || !matches.length}
        onChange={(event) => change(event.target.value)}
      >
        {!matches.some((choice) => choice.id === value) && (
          <option hidden value={value}>
            {choices.find((choice) => choice.id === value)?.label}
          </option>
        )}
        {matches.map(({ id, label }) => (
          <option key={id} value={id} disabled={id === "openai" && hasOpenai}>
            {label}
          </option>
        ))}
      </select>
      {!matches.length && <p role="status">{t("providers.noMatches")}</p>}
    </>
  );
}

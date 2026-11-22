// REQ-UX-fe31a037
import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/index.js";
import { ErrorMessage } from "./error-message.js";
import { Pager, usePaged } from "./pager.js";

export type ProviderId = "chatgpt" | "openai" | `custom:${string}`;

/**
 * A provider's catalog as checkboxes. `enabled` is the saved list and `ticked` the page draft; with neither, the
 * whole catalog is offered and shown ticked. Long catalogs are filtered and paged.
 */
export function ProviderModels({
  id,
  enabled,
  ticked,
  change,
  disabled,
}: {
  id: ProviderId;
  enabled: readonly string[] | undefined;
  ticked: readonly string[] | undefined;
  change: (models: string[]) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const filterId = useId();
  const catalog = useQuery({
    queryKey: ["providers.catalog", id],
    queryFn: () => api.invoke("providers.models", { id }),
    staleTime: 60_000,
    retry: false,
  });
  const models = catalog.data?.models ?? [];
  const ids = models.map((model) => model.id);
  const current = ticked ?? enabled ?? ids;
  const [filter, setFilter] = useState("");
  const term = filter.trim().toLocaleLowerCase();
  const shown = term
    ? models.filter(({ id: model, name }) =>
        [model, name].some((text) => text.toLocaleLowerCase().includes(term)),
      )
    : models;
  const { rows, pager } = usePaged(shown);
  const toggle = (model: string, on: boolean) => {
    const next = on ? [...current, model] : current.filter((item) => item !== model);
    // Catalog order first; ticks the provider no longer lists are kept as saved.
    change([...ids.filter((item) => next.includes(item)), ...next.filter((item) => !ids.includes(item))]);
  };
  return (
    <fieldset className="provider-models" data-provider-models={id}>
      <legend>{t("providers.models")}</legend>
      {catalog.isPending && <p role="status">{t("home.loading")}</p>}
      {catalog.isError && <ErrorMessage error={catalog.error} />}
      {catalog.data && models.length === 0 && <p className="muted">{t("providers.noModels")}</p>}
      {models.length > 10 && (
        <label className="provider-models-filter" htmlFor={filterId}>
          {t("providers.filterModels")}
          <input
            id={filterId}
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
        </label>
      )}
      <ul>
        {rows.map((model) => (
          <li key={model.id}>
            <label>
              <input
                type="checkbox"
                data-provider-model={model.id}
                checked={current.includes(model.id)}
                disabled={disabled}
                onChange={(event) => toggle(model.id, event.target.checked)}
              />
              <span>{model.name}</span>
            </label>
          </li>
        ))}
      </ul>
      <Pager {...pager} />
    </fieldset>
  );
}

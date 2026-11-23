// REQ-UX-fe31a037
import { useQuery } from "@tanstack/react-query";
import type { ModelProfile } from "@vera/shared";
import { SlidersHorizontal } from "lucide-react";
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
  defaultModel,
  setDefault,
  profiles,
  editModel,
  change,
  disabled,
}: {
  id: ProviderId;
  enabled: readonly string[] | undefined;
  ticked: readonly string[] | undefined;
  defaultModel: string | null;
  setDefault: (model: string | null) => void;
  profiles: readonly ModelProfile[] | undefined;
  editModel: (model: string) => void;
  change: (models: string[]) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const filterId = useId();
  const defaultGroupId = useId();
  const catalog = useQuery({
    queryKey: ["providers.catalog", id],
    queryFn: () => api.invoke("providers.models", { id }),
    staleTime: 60_000,
    retry: false,
  });
  const models = catalog.data?.models ?? [];
  const ids = models.map((model) => model.id);
  const current = new Set(ticked ?? enabled ?? ids);
  const editable = new Set(profiles?.map(({ id }) => id));
  const [filter, setFilter] = useState("");
  const term = filter.trim().toLocaleLowerCase();
  const shown = term
    ? models.filter(({ id: model, name }) =>
        [model, name].some((text) => text.toLocaleLowerCase().includes(term)),
      )
    : models;
  const { rows, pager } = usePaged(shown);
  const toggle = (model: ProviderCatalogModel, on: boolean) => {
    if (on) current.add(model.id);
    else {
      current.delete(model.id);
      if (defaultModel === model.reference) setDefault(null);
    }
    // Catalog order first; ticks the provider no longer lists are kept as saved.
    const listed = new Set(ids);
    change([...ids.filter((item) => current.has(item)), ...[...current].filter((item) => !listed.has(item))]);
  };
  return (
    <section className="provider-models" aria-label={t("providers.models")} data-provider-models={id}>
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
      {rows.length > 0 && (
        <div className="provider-model-columns" aria-hidden="true">
          <span>{t("providers.useModel")}</span>
          <span>{t("providers.defaultModel")}</span>
        </div>
      )}
      <ul className="provider-model-items">
        {rows.map((model) => (
          <li key={model.id}>
            <label>
              <input
                type="checkbox"
                data-provider-model={model.id}
                checked={current.has(model.id)}
                disabled={disabled}
                onChange={(event) => toggle(model, event.target.checked)}
              />
              <span>{model.name}</span>
            </label>
            <input
              type="radio"
              name={defaultGroupId}
              aria-label={t("providers.defaultNamed", { name: model.name })}
              checked={defaultModel === model.reference}
              disabled={disabled || !current.has(model.id)}
              onChange={() => setDefault(model.reference)}
            />
            {editable.has(model.id) && (
              <button
                type="button"
                className="provider-model-edit"
                disabled={disabled}
                aria-label={t("providers.modelSettingsNamed", { name: model.name })}
                title={t("providers.modelSettings")}
                onClick={() => editModel(model.id)}
              >
                <SlidersHorizontal aria-hidden="true" />
              </button>
            )}
          </li>
        ))}
      </ul>
      <Pager {...pager} />
    </section>
  );
}

type ProviderCatalogModel = Pick<
  import("@vera/shared").ProviderCatalog["models"][number],
  "id" | "reference"
>;

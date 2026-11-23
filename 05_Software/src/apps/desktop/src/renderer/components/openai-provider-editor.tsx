import type { ProviderList, ProviderSave } from "@vera/shared";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { ProviderTest } from "./provider-test.js";

type Save = (request: ProviderSave, done: () => void) => Promise<void>;

export function OpenAIEditor({
  provider,
  existing,
  disabled,
  save,
  close,
  remove,
}: {
  provider: ProviderList["openai"];
  existing: boolean;
  disabled: boolean;
  save: Save;
  close: () => void;
  remove: () => void;
}) {
  const { t } = useTranslation();
  const prefix = useId();
  const [key, setKey] = useState("");
  const [model, setModel] = useState(provider.model ?? "");
  useEffect(() => setModel(provider.model ?? ""), [provider.model]);
  const done = () => {
    setKey("");
    close();
  };
  const submit = (
    <button type="submit" data-provider-action="save-openai">
      {t("providers.save")}
    </button>
  );
  const cancel = (
    <button type="button" onClick={done}>
      {t("providers.cancel")}
    </button>
  );
  return (
    <form
      aria-label={t("providers.openai")}
      className="workbench-form provider-editor"
      data-provider-editor="openai"
      onSubmit={(event) => {
        event.preventDefault();
        void save({ provider: "openai", ...(key ? { apiKey: key } : {}), model: model.trim() }, done);
      }}
    >
      <fieldset disabled={disabled} className="provider-fields">
        <label htmlFor={`${prefix}-key`}>{t("providers.openaiKey")}</label>
        <input
          id={`${prefix}-key`}
          type="password"
          autoComplete="off"
          spellCheck={false}
          required={!provider.configured}
          value={key}
          onChange={(event) => setKey(event.target.value)}
          maxLength={16384}
        />
        <label htmlFor={`${prefix}-model`}>{t("providers.openaiModel")}</label>
        <input
          id={`${prefix}-model`}
          value={model}
          onChange={(event) => setModel(event.target.value)}
          maxLength={200}
        />
        {existing ? (
          <ProviderTest
            name={t("providers.openai")}
            id="openai"
            version={JSON.stringify(provider)}
            disabled={
              disabled || !provider.configured || !provider.model || !!key || model !== (provider.model ?? "")
            }
            before={submit}
            after={
              <>
                <button
                  type="button"
                  onClick={() => {
                    setKey("");
                    remove();
                  }}
                >
                  {t("providers.remove")}
                </button>
                {cancel}
              </>
            }
          />
        ) : (
          <div className="workbench-actions">
            {submit}
            {cancel}
          </div>
        )}
      </fieldset>
    </form>
  );
}

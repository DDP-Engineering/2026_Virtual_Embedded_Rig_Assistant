import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { PluginCredentialList, PluginCredentialScope } from "@vera/shared";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/index.js";
import { ConsentDialog } from "./consent-dialog.js";
import { ErrorMessage } from "./error-message.js";
import "./web-access.css";

type Draft = { ref: string; username: string; password: string };
const empty: Draft = { ref: "", username: "", password: "" };

/** The texts of one scope's section; every key is a literal so the catalog check sees it. */
function useScopeText(scope: PluginCredentialScope) {
  const { t } = useTranslation();
  if (scope === "mqtt")
    return {
      title: t("settings.mqttCredentials"),
      description: t("mqttCredentials.description"),
      loading: t("mqttCredentials.loading"),
      none: t("mqttCredentials.none"),
      stored: (storage: string) => t("mqttCredentials.stored", { storage }),
      remove: t("mqttCredentials.remove"),
      add: t("mqttCredentials.add"),
      reference: t("mqttCredentials.reference"),
      referenceHint: t("mqttCredentials.referenceHint"),
      username: t("mqttCredentials.username") as string | undefined,
      secret: t("mqttCredentials.password"),
      save: t("mqttCredentials.save"),
      saved: t("mqttCredentials.saved"),
    };
  return {
    title: t("settings.wokwiTokens"),
    description: t("wokwiTokens.description"),
    loading: t("wokwiTokens.loading"),
    none: t("wokwiTokens.none"),
    stored: (storage: string) => t("wokwiTokens.stored", { storage }),
    remove: t("wokwiTokens.remove"),
    add: t("wokwiTokens.add"),
    reference: t("wokwiTokens.reference"),
    referenceHint: t("wokwiTokens.referenceHint"),
    username: undefined as string | undefined,
    secret: t("wokwiTokens.token"),
    save: t("wokwiTokens.save"),
    saved: t("wokwiTokens.saved"),
  };
}
type ScopeText = ReturnType<typeof useScopeText>;

/** The three channels of a scope; the token of a Wokwi save travels as `token`, an MQTT password as `password`. */
const channels = {
  list: (scope: PluginCredentialScope) =>
    scope === "mqtt" ? api.invoke("mqtt.credentials.list", {}) : api.invoke("wokwi.credentials.list", {}),
  save: (scope: PluginCredentialScope, draft: Draft, storageConsent: boolean | undefined) => {
    const consent = storageConsent === undefined ? {} : { storageConsent };
    return scope === "mqtt"
      ? api.invoke("mqtt.credentials.save", {
          ref: draft.ref,
          password: draft.password,
          ...(draft.username ? { username: draft.username } : {}),
          ...consent,
        })
      : api.invoke("wokwi.credentials.save", { ref: draft.ref, token: draft.password, ...consent });
  },
  remove: (scope: PluginCredentialScope, ref: string) =>
    scope === "mqtt"
      ? api.invoke("mqtt.credentials.remove", { ref })
      : api.invoke("wokwi.credentials.remove", { ref }),
};

/**
 * Settings > MQTT credentials or Wokwi tokens: secrets for official plugins (mqtt-tools, wokwi), never shown back.
 */
export function PluginCredentialsPanel({ scope }: { scope: PluginCredentialScope }) {
  const text = useScopeText(scope);
  const query = useQuery({
    queryKey: [`${scope}.credentials.list`],
    queryFn: () => channels.list(scope),
  });
  return (
    <section className={`surface web-access ${scope}-credentials`} data-settings-section={scope}>
      <h2>{text.title}</h2>
      <p className="muted">{text.description}</p>
      {query.isPending && <p role="status">{text.loading}</p>}
      {query.error && <ErrorMessage error={query.error} />}
      {query.data && <PluginCredentialsForm scope={scope} text={text} list={query.data} />}
    </section>
  );
}

function PluginCredentialsForm({
  scope,
  text,
  list,
}: {
  scope: PluginCredentialScope;
  text: ScopeText;
  list: PluginCredentialList;
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const storage = {
    encrypted: t("webAccess.storage.encrypted"),
    unprotected: t("webAccess.storage.unprotected"),
    memory: t("webAccess.storage.memory"),
  };
  const [draft, setDraft] = useState<Draft>(empty);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<unknown>();
  const [consent, setConsent] = useState(false);
  const pending = useRef<Draft>(empty);
  const refresh = () => client.invalidateQueries({ queryKey: [`${scope}.credentials.list`] });
  const run = async (action: () => Promise<boolean>) => {
    setBusy(true);
    setSaved(false);
    setError(undefined);
    try {
      setSaved(await action());
    } catch (failure) {
      // The typed password stays in the form only; nothing keeps a copy after a failed save.
      pending.current = empty;
      setError(failure);
    } finally {
      setBusy(false);
    }
  };
  const save = (storageConsent?: boolean) =>
    run(async () => {
      const result = await channels.save(scope, pending.current, storageConsent);
      if (result.status === "consent-required") {
        setConsent(true);
        return false;
      }
      setConsent(false);
      pending.current = empty;
      setDraft(empty);
      await refresh();
      return true;
    });
  const valid = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(draft.ref.trim()) && draft.password.length > 0;
  return (
    <>
      {list.credentials.length === 0 ? (
        <p className="muted" role="note">
          {text.none}
        </p>
      ) : (
        <ul className="plugin-credential-list">
          {list.credentials.map(({ ref, storage: location }) => (
            <li key={ref} data-credential={ref}>
              <code>{ref}</code>{" "}
              <span className="muted">{text.stored(storage[location ?? "encrypted"])}</span>{" "}
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await channels.remove(scope, ref);
                    await refresh();
                    return false;
                  })
                }
              >
                {text.remove}
              </button>
            </li>
          ))}
        </ul>
      )}
      <fieldset disabled={busy}>
        <legend>{text.add}</legend>
        <label>
          {text.reference}
          <input
            value={draft.ref}
            spellCheck={false}
            autoComplete="off"
            pattern="[a-z0-9](?:[a-z0-9\-]{0,62}[a-z0-9])?"
            onChange={(event) => setDraft({ ...draft, ref: event.target.value })}
          />
        </label>
        <p className="muted">{text.referenceHint}</p>
        {text.username !== undefined && (
          <label>
            {text.username}
            <input
              value={draft.username}
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => setDraft({ ...draft, username: event.target.value })}
            />
          </label>
        )}
        <label>
          {text.secret}
          <input
            type="password"
            autoComplete="off"
            value={draft.password}
            onChange={(event) => setDraft({ ...draft, password: event.target.value })}
          />
        </label>
        <div className="workbench-actions">
          <button
            type="button"
            disabled={!valid}
            onClick={() => {
              pending.current = { ...draft, ref: draft.ref.trim() };
              void save();
            }}
          >
            {text.save}
          </button>
          {saved && <span role="status">{text.saved}</span>}
        </div>
      </fieldset>
      {error !== undefined && <ErrorMessage error={error} />}
      {consent && (
        <ConsentDialog
          pending={busy}
          choice={(choice) => save(choice)}
          cancel={() => {
            pending.current = empty;
            setConsent(false);
          }}
        />
      )}
    </>
  );
}

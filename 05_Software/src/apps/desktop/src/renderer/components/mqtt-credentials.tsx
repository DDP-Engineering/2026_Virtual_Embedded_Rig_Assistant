import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { MqttCredentialList } from "@vera/shared";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/index.js";
import { ConsentDialog } from "./consent-dialog.js";
import { ErrorMessage } from "./error-message.js";
import "./web-access.css";

type Draft = { ref: string; username: string; password: string };
const empty: Draft = { ref: "", username: "", password: "" };

/** Settings > MQTT credentials: broker logins for the official mqtt-tools plugin, never shown back. */
export function MqttCredentialsPanel() {
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: ["mqtt.credentials.list"],
    queryFn: () => api.invoke("mqtt.credentials.list", {}),
  });
  return (
    <section className="surface web-access mqtt-credentials" data-settings-section="mqtt">
      <h2>{t("settings.mqttCredentials")}</h2>
      <p className="muted">{t("mqttCredentials.description")}</p>
      {query.isPending && <p role="status">{t("mqttCredentials.loading")}</p>}
      {query.error && <ErrorMessage error={query.error} />}
      {query.data && <MqttCredentialsForm list={query.data} />}
    </section>
  );
}

function MqttCredentialsForm({ list }: { list: MqttCredentialList }) {
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
  const refresh = () => client.invalidateQueries({ queryKey: ["mqtt.credentials.list"] });
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
      const { ref, username, password } = pending.current;
      const result = await api.invoke("mqtt.credentials.save", {
        ref,
        password,
        ...(username ? { username } : {}),
        ...(storageConsent === undefined ? {} : { storageConsent }),
      });
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
          {t("mqttCredentials.none")}
        </p>
      ) : (
        <ul className="mqtt-credential-list">
          {list.credentials.map(({ ref, storage: location }) => (
            <li key={ref} data-credential={ref}>
              <code>{ref}</code>{" "}
              <span className="muted">
                {t("mqttCredentials.stored", { storage: storage[location ?? "encrypted"] })}
              </span>{" "}
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await api.invoke("mqtt.credentials.remove", { ref });
                    await refresh();
                    return false;
                  })
                }
              >
                {t("mqttCredentials.remove")}
              </button>
            </li>
          ))}
        </ul>
      )}
      <fieldset disabled={busy}>
        <legend>{t("mqttCredentials.add")}</legend>
        <label>
          {t("mqttCredentials.reference")}
          <input
            value={draft.ref}
            spellCheck={false}
            autoComplete="off"
            pattern="[a-z0-9](?:[a-z0-9\-]{0,62}[a-z0-9])?"
            onChange={(event) => setDraft({ ...draft, ref: event.target.value })}
          />
        </label>
        <p className="muted">{t("mqttCredentials.referenceHint")}</p>
        <label>
          {t("mqttCredentials.username")}
          <input
            value={draft.username}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => setDraft({ ...draft, username: event.target.value })}
          />
        </label>
        <label>
          {t("mqttCredentials.password")}
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
            {t("mqttCredentials.save")}
          </button>
          {saved && <span role="status">{t("mqttCredentials.saved")}</span>}
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

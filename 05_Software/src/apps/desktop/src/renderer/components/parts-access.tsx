import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type PartsAccessSnapshot,
  type PartsAccessTestResult,
  type PartsSearchSettings,
  type PartsSupplierId,
  partsSupplierIds,
  partsSuppliers,
} from "@vera/shared";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/index.js";
import { ConsentDialog } from "./consent-dialog.js";
import { ErrorMessage } from "./error-message.js";
import "./web-access.css";

/** Settings > Parts search: supplier switches, credentials (never shown back) and region. */
export function PartsAccessPanel() {
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: ["parts.access.get"],
    queryFn: () => api.invoke("parts.access.get", {}),
  });
  return (
    <section className="surface web-access parts-access" data-settings-section="parts">
      <h2>{t("settings.partsSearch")}</h2>
      <p className="muted">{t("partsSearch.description")}</p>
      {query.isPending && <p role="status">{t("partsSearch.loading")}</p>}
      {query.error && <ErrorMessage error={query.error} />}
      {query.data && <PartsAccessForm snapshot={query.data} />}
    </section>
  );
}

type Pending = { supplier: PartsSupplierId; credential: { secret: string; id?: string } };
function PartsAccessForm({ snapshot }: { snapshot: PartsAccessSnapshot }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  // Every key is spelled out so the translation check can see it.
  const labels = {
    country: t("partsSearch.country"),
    language: t("partsSearch.language"),
    currency: t("partsSearch.currency"),
    farnellStore: t("partsSearch.farnellStore"),
  };
  const idLabels: Partial<Record<PartsSupplierId, string>> = {
    digikey: t("partsSearch.idLabel.digikey"),
    tme: t("partsSearch.idLabel.tme"),
  };
  const secretLabels: Record<PartsSupplierId, string> = {
    mouser: t("partsSearch.secretLabel.mouser"),
    digikey: t("partsSearch.secretLabel.digikey"),
    tme: t("partsSearch.secretLabel.tme"),
    farnell: t("partsSearch.secretLabel.farnell"),
    rutronik: t("partsSearch.secretLabel.rutronik"),
  };
  const storage = {
    encrypted: t("webAccess.storage.encrypted"),
    unprotected: t("webAccess.storage.unprotected"),
    memory: t("webAccess.storage.memory"),
  };
  const outcomes: Record<PartsAccessTestResult["status"] | "testing", string> = {
    testing: t("partsSearch.results.testing"),
    ok: t("partsSearch.results.ok"),
    partial: t("partsSearch.results.partial"),
    failed: t("partsSearch.results.failed"),
    "key-required": t("partsSearch.results.key-required"),
    auth: t("partsSearch.results.auth"),
    "rate-limited": t("partsSearch.results.rate-limited"),
    timeout: t("partsSearch.results.timeout"),
    unavailable: t("partsSearch.results.unavailable"),
    disabled: t("partsSearch.results.disabled"),
    cancelled: t("partsSearch.results.cancelled"),
  };
  const [preferences, setPreferences] = useState<PartsSearchSettings>(snapshot.preferences);
  const [secrets, setSecrets] = useState<Partial<Record<PartsSupplierId, { secret: string; id: string }>>>(
    {},
  );
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<unknown>();
  const [consent, setConsent] = useState<Pending>();
  const [results, setResults] = useState<
    Partial<Record<PartsSupplierId, PartsAccessTestResult["status"] | "testing">>
  >({});
  const attempt = useRef<{ id: string; supplier: PartsSupplierId } | undefined>(undefined);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
      if (attempt.current)
        void api.invoke("parts.access.cancel", { testId: attempt.current.id }).catch(() => {});
    },
    [],
  );
  const refresh = () => client.invalidateQueries({ queryKey: ["parts.access.get"] });
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setSaved(false);
    setError(undefined);
    try {
      await action();
      if (alive.current) setSaved(true);
    } catch (failure) {
      if (alive.current) setError(failure);
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const save = (pending?: Pending, storageConsent?: boolean) =>
    run(async () => {
      const result = await api.invoke("parts.access.save", {
        preferences,
        ...(pending ? { supplier: pending.supplier, credential: pending.credential } : {}),
        ...(storageConsent === undefined ? {} : { storageConsent }),
      });
      if (result.status === "consent-required" && pending) {
        setConsent(pending);
        throw undefined;
      }
      setConsent(undefined);
      if (pending) setSecrets((current) => ({ ...current, [pending.supplier]: { secret: "", id: "" } }));
      await refresh();
    }).catch(() => {});
  const saveKey = (supplier: PartsSupplierId) => {
    const entry = secrets[supplier];
    if (!entry?.secret.trim()) return;
    const credential = partsSuppliers[supplier].pair
      ? { secret: entry.secret.trim(), id: entry.id.trim() }
      : { secret: entry.secret.trim() };
    void save({ supplier, credential });
  };
  const test = async (supplier: PartsSupplierId) => {
    const id = crypto.randomUUID();
    attempt.current = { id, supplier };
    setResults((current) => ({ ...current, [supplier]: "testing" }));
    try {
      const result = await api.invoke("parts.access.test", { testId: id, supplier });
      if (alive.current) setResults((current) => ({ ...current, [supplier]: result.status }));
    } catch (failure) {
      if (alive.current) {
        setResults((current) => ({ ...current, [supplier]: "failed" }));
        setError(failure);
      }
    } finally {
      if (attempt.current?.id === id) attempt.current = undefined;
    }
  };
  const field = (key: "country" | "language" | "currency" | "farnellStore", pattern: string) => (
    <label>
      {labels[key]}
      <input
        value={preferences[key]}
        pattern={pattern}
        spellCheck={false}
        onChange={(event) => setPreferences({ ...preferences, [key]: event.target.value })}
      />
    </label>
  );
  return (
    <>
      <fieldset disabled={busy}>
        <legend>{t("partsSearch.region")}</legend>
        {field("country", "[A-Z]{2}")}
        {field("language", "[a-z]{2}")}
        {field("currency", "[A-Z]{3}")}
        {field("farnellStore", "[a-z0-9][a-z0-9.\\-]{1,62}[a-z0-9]")}
      </fieldset>
      {partsSupplierIds.map((supplier) => {
        const metadata = snapshot.keys[supplier];
        const pair = partsSuppliers[supplier].pair;
        const entry = secrets[supplier] ?? { secret: "", id: "" };
        const status = results[supplier];
        return (
          <fieldset key={supplier} disabled={busy} data-supplier={supplier}>
            <legend>{partsSuppliers[supplier].name}</legend>
            <label>
              <input
                type="checkbox"
                checked={preferences.suppliers[supplier].enabled}
                onChange={(event) =>
                  setPreferences({
                    ...preferences,
                    suppliers: { ...preferences.suppliers, [supplier]: { enabled: event.target.checked } },
                  })
                }
              />
              {t("partsSearch.enabled")}
            </label>
            <p className="muted" role="note">
              {metadata.keyConfigured
                ? t("partsSearch.keyConfigured", {
                    storage: storage[metadata.storage ?? "encrypted"],
                  })
                : t("partsSearch.noKey")}
            </p>
            {pair && (
              <label>
                {idLabels[supplier]}
                <input
                  autoComplete="off"
                  spellCheck={false}
                  value={entry.id}
                  onChange={(event) =>
                    setSecrets({ ...secrets, [supplier]: { ...entry, id: event.target.value } })
                  }
                />
              </label>
            )}
            <label>
              {secretLabels[supplier]}
              <input
                type="password"
                autoComplete="off"
                value={entry.secret}
                onChange={(event) =>
                  setSecrets({ ...secrets, [supplier]: { ...entry, secret: event.target.value } })
                }
              />
            </label>
            <div className="workbench-actions">
              <button
                type="button"
                disabled={!entry.secret.trim() || (pair && !entry.id.trim())}
                onClick={() => saveKey(supplier)}
              >
                {t("partsSearch.saveKey")}
              </button>
              <button
                type="button"
                disabled={!metadata.keyConfigured}
                onClick={() =>
                  void run(async () => {
                    await api.invoke("parts.access.removeKey", { supplier });
                    await refresh();
                  })
                }
              >
                {t("partsSearch.removeKey")}
              </button>
              {status === "testing" ? (
                <button
                  type="button"
                  onClick={() => {
                    if (attempt.current?.supplier === supplier)
                      void api.invoke("parts.access.cancel", { testId: attempt.current.id });
                  }}
                >
                  {t("partsSearch.cancelTest")}
                </button>
              ) : (
                <button type="button" disabled={!!attempt.current} onClick={() => void test(supplier)}>
                  {t("partsSearch.test")}
                </button>
              )}
            </div>
            {status && (
              <p role="status" data-status={status}>
                {outcomes[status]}
              </p>
            )}
          </fieldset>
        );
      })}
      <div className="workbench-actions">
        <button type="button" disabled={busy} onClick={() => void save()}>
          {t("partsSearch.save")}
        </button>
        {saved && <span role="status">{t("partsSearch.saved")}</span>}
      </div>
      {error !== undefined && <ErrorMessage error={error} />}
      {consent && (
        <ConsentDialog
          pending={busy}
          choice={(choice) => save(consent, choice)}
          cancel={() => setConsent(undefined)}
        />
      )}
    </>
  );
}

import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "./api/index.js";
import { ErrorMessage } from "./components/error-message.js";
import { Metadata } from "./components/metadata.js";
import { Settings, useSettingsSections } from "./components/settings.js";
import { Shell } from "./components/shell.js";
import { Workbench } from "./components/workbench.js";
import { usePreferences } from "./hooks/use-preferences.js";

export function App() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState(false);
  const [section, setSection] = useState("appearance");
  const focusHeading = useCallback((node: HTMLHeadingElement | null) => node?.focus(), []);
  const info = useQuery({ queryKey: ["app.info"], queryFn: () => api.getAppInfo() });
  const { snapshot, mutation } = usePreferences(info.data?.locale ?? "en");
  const sections = useSettingsSections();
  function navigate(value: boolean) {
    setSettings(value);
  }
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === ",") {
        event.preventDefault();
        setSettings(true);
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
  const navigation = settings ? (
    sections.map(({ id, label }) => (
      <button
        key={id}
        type="button"
        data-section={id}
        aria-current={section === id ? "location" : undefined}
        onClick={() => {
          setSection(id);
          const target = document.getElementById(`section-${id}`);
          target?.scrollIntoView({ block: "start" });
          target?.querySelector("h2")?.focus();
        }}
      >
        {label}
      </button>
    ))
  ) : (
    <>
      <strong>{t("welcome.workbenches")}</strong>
      <p className="muted">{t("welcome.sidebarPlaceholder")}</p>
    </>
  );
  return (
    <Shell
      settings={settings}
      navigate={navigate}
      navigation={navigation}
      storageReadOnly={!snapshot.data || snapshot.data.readOnly}
    >
      <div className="page-content">
        <h2 className="page-title" key={settings ? "settings" : "welcome"} ref={focusHeading} tabIndex={-1}>
          {settings ? t("settings.title") : t("welcome.title")}
        </h2>
        {(info.isPending || snapshot.isPending) && (
          <p role="status" data-i18n="home.loading">
            {t("home.loading")}
          </p>
        )}
        {(info.isError || snapshot.isError) && (
          <>
            <ErrorMessage error={info.error ?? snapshot.error} />
            <button
              type="button"
              onClick={() => {
                void info.refetch();
                void snapshot.refetch();
              }}
            >
              {t("settings.retry")}
            </button>
          </>
        )}
        {settings && snapshot.data && (
          <Settings
            snapshot={snapshot.data}
            info={info.data}
            saving={mutation.isPending}
            error={mutation.error}
            update={(patch) => mutation.mutate(patch)}
          />
        )}
        <div hidden={settings}>
          <p className="muted">{t("welcome.description")}</p>
          {info.data && snapshot.data && <Workbench settingsReadOnly={snapshot.data.readOnly} />}
          {info.data && (
            <section className="surface">
              <h3>{t("welcome.application")}</h3>
              <Metadata info={info.data} />
            </section>
          )}
        </div>
      </div>
    </Shell>
  );
}

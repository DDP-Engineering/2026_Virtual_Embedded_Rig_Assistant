import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SettingsPatch, SettingsSnapshot } from "@vera/shared";
import { useEffect, useLayoutEffect } from "react";
import { api } from "../api/index.js";
import i18next from "../i18n.js";
import { resolveLanguage } from "../lib/language.js";

const settingsKey = ["app.settings"];
export function usePreferences(locale: string) {
  const client = useQueryClient();
  const snapshot = useQuery({ queryKey: settingsKey, queryFn: () => api.getSettings() });
  const mutation = useMutation({
    scope: { id: "app.settings" },
    mutationFn: (patch: SettingsPatch) => api.updateSettings(patch),
    onSuccess: (result: SettingsSnapshot) => client.setQueryData(settingsKey, result),
  });
  useEffect(
    () =>
      api.subscribe("app", (event) => {
        if (event.type === "settings.changed") void client.invalidateQueries({ queryKey: settingsKey });
      }),
    [client],
  );
  const theme = snapshot.data?.settings.theme ?? "system";
  const scale = snapshot.data?.settings.textScale ?? 1;
  const language = resolveLanguage(snapshot.data?.settings.language ?? "system", locale);
  useLayoutEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme =
        theme === "system" ? (media.matches ? "dark" : "light") : theme;
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
  useLayoutEffect(() => {
    document.documentElement.style.fontSize = `${14 * scale}px`;
  }, [scale]);
  useLayoutEffect(() => {
    document.documentElement.lang = language;
    void i18next.changeLanguage(language);
  }, [language]);
  return { snapshot, mutation };
}

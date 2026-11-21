import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type SettingsPatch, type SettingsSnapshot, typographyDefaults } from "@vera/shared";
import { useEffect, useLayoutEffect } from "react";
import { api } from "../api/index.js";
import i18next from "../i18n.js";
import { resolveLanguage } from "../lib/language.js";
import { setAppAdvanced } from "./app-advanced.js";
import { useAppearancePreview } from "./appearance-preview.js";

const settingsKey = ["app.settings"];
/** Shared confirmed snapshot; a late read cannot replace a newer confirmed update. */
export function useSettingsSnapshot() {
  const client = useQueryClient();
  return useQuery({
    queryKey: settingsKey,
    queryFn: async ({ signal }) => {
      const previous = client.getQueryData<SettingsSnapshot>(settingsKey);
      const result = await api.getSettings();
      signal.throwIfAborted();
      const current = client.getQueryData<SettingsSnapshot>(settingsKey);
      return current !== previous && current ? current : result;
    },
  });
}
export function usePreferences(locale: string) {
  const client = useQueryClient();
  const snapshot = useSettingsSnapshot();
  const mutation = useMutation({
    scope: { id: "app.settings" },
    mutationFn: (patch: SettingsPatch) => api.updateSettings(patch),
    onSuccess: async (result: SettingsSnapshot) => {
      await client.cancelQueries({ queryKey: settingsKey });
      client.setQueryData(settingsKey, result);
    },
  });
  useEffect(
    () =>
      api.subscribe("app", (event) => {
        if (event.type === "settings.changed") void client.invalidateQueries({ queryKey: settingsKey });
      }),
    [client],
  );
  // An unsaved Appearance draft is shown over the saved values (REQ-UX-58a693f3).
  const preview = useAppearancePreview();
  const theme = preview?.theme ?? snapshot.data?.settings.theme ?? "system";
  const scale = preview?.textScale ?? snapshot.data?.settings.textScale ?? 1;
  const chatFontSize =
    preview?.chatFontSize ?? snapshot.data?.settings.chatFontSize ?? typographyDefaults.chatFontSize;
  const codeFontSize =
    preview?.codeFontSize ?? snapshot.data?.settings.codeFontSize ?? typographyDefaults.codeFontSize;
  const language = resolveLanguage(preview?.language ?? snapshot.data?.settings.language ?? "system", locale);
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
    document.documentElement.style.setProperty("--chat-font-size", `${chatFontSize}px`);
    document.documentElement.style.setProperty("--code-font-size", `${codeFontSize}px`);
  }, [chatFontSize, codeFontSize]);
  const advanced = snapshot.data?.settings.advanced;
  // Lists, transcripts and terminal views read the saved application Advanced values from this store.
  useLayoutEffect(() => setAppAdvanced(advanced), [advanced]);
  useLayoutEffect(() => {
    document.documentElement.lang = language;
    void i18next.changeLanguage(language);
  }, [language]);
  return { snapshot, mutation };
}

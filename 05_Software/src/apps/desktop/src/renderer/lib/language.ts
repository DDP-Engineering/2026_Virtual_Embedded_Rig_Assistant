export function resolveLanguage(setting: string, locale: string): "en" | "ro" | "de" {
  const language = (setting === "system" ? locale : setting).toLowerCase().split(/[-_]/)[0];
  return language === "ro" || language === "de" ? language : "en";
}

export const interfaceLanguages = ["en", "ro", "de", "fr"] as const;
export type InterfaceLanguage = (typeof interfaceLanguages)[number];

export function resolveLanguage(setting: string, locale: string): InterfaceLanguage {
  const language = (setting === "system" ? locale : setting).toLowerCase().split(/[-_]/)[0];
  return interfaceLanguages.find((code) => code === language) ?? "en";
}

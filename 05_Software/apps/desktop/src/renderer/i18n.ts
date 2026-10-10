import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import de from "./locales/de.json";
import en from "./locales/en.json";
import ro from "./locales/ro.json";

await i18next.use(initReactI18next).init({
  lng: "en",
  fallbackLng: "en",
  resources: { en: { translation: en }, ro: { translation: ro }, de: { translation: de } },
  interpolation: { escapeValue: false },
});
export default i18next;

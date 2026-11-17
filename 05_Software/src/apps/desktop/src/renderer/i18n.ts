import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import de from "./locales/de.json";
import en from "./locales/en.json";
import fr from "./locales/fr.json";
import ro from "./locales/ro.json";

const resources = {
  en: { translation: en },
  ro: { translation: ro },
  de: { translation: de },
  fr: { translation: fr },
};
if (!i18next.isInitialized) {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources,
    interpolation: { escapeValue: false },
  });
} else {
  for (const [language, resource] of Object.entries(resources))
    i18next.addResourceBundle(language, "translation", resource.translation, true, true);
  await i18next.changeLanguage(i18next.language);
}
if (import.meta.hot) {
  // React Refresh can keep the i18next singleton while replacing components that need new keys.
  import.meta.hot.accept(
    ["./locales/en.json", "./locales/ro.json", "./locales/de.json", "./locales/fr.json"],
    (catalogs) => {
      for (const [index, language] of ["en", "ro", "de", "fr"].entries()) {
        const catalog = catalogs[index]?.default;
        if (catalog) i18next.addResourceBundle(language, "translation", catalog, true, true);
      }
      void i18next.changeLanguage(i18next.language);
    },
  );
}
export default i18next;

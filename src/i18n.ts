import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import de from "./locales/de/translation.json";
import en from "./locales/en/translation.json";
import fr from "./locales/fr/translation.json";
import it from "./locales/it/translation.json";
import es from "./locales/es/translation.json";
import nl from "./locales/nl/translation.json";
import fi from "./locales/fi/translation.json";
import pl from "./locales/pl/translation.json";
import hr from "./locales/hr/translation.json";
import ru from "./locales/ru/translation.json";

export const SUPPORTED_LANGUAGES = [
  { code: "de", flag: "🇩🇪" },
  { code: "en", flag: "🇬🇧" },
  { code: "fr", flag: "🇫🇷" },
  { code: "it", flag: "🇮🇹" },
  { code: "es", flag: "🇪🇸" },
  { code: "nl", flag: "🇳🇱" },
  { code: "fi", flag: "🇫🇮" },
  { code: "pl", flag: "🇵🇱" },
  { code: "hr", flag: "🇭🇷" },
  { code: "ru", flag: "🇷🇺" },
] as const;

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      de: { translation: de },
      en: { translation: en },
      fr: { translation: fr },
      it: { translation: it },
      es: { translation: es },
      nl: { translation: nl },
      fi: { translation: fi },
      pl: { translation: pl },
      hr: { translation: hr },
      ru: { translation: ru },
    },
    supportedLngs: SUPPORTED_LANGUAGES.map((l) => l.code),
    nonExplicitSupportedLngs: true,
    load: "languageOnly",
    fallbackLng: "de",
    interpolation: { escapeValue: false },
    detection: {
      order: ["localStorage", "navigator"],
      lookupLocalStorage: "tua_language",
      caches: ["localStorage"],
    },
  });

export default i18n;

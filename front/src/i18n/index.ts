import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import zh from "@/i18n/locales/zh.json";
import en from "@/i18n/locales/en.json";

const STORAGE_KEY = "meeting.locale";

/** Language switch is temporarily disabled; always Chinese. */
export function getStoredLocale(): "zh" | "en" {
  return "zh";
}

void i18n.use(initReactI18next).init({
  resources: { zh: { translation: zh }, en: { translation: en } },
  lng: "zh",
  fallbackLng: "zh",
  interpolation: { escapeValue: false },
});

export function setLocale(_lng: "zh" | "en") {
  localStorage.setItem(STORAGE_KEY, "zh");
  void i18n.changeLanguage("zh");
}

export default i18n;

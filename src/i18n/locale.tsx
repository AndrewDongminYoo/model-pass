import { createContext, useContext } from "react";
import type { AppLocale } from "./brand";

export const localeStorageKey = "model-pass-locale";

export interface I18nValue {
  locale: AppLocale;
  setLocale: (locale: AppLocale) => void;
  t: (en: string, ko: string) => string;
}

const defaultValue: I18nValue = {
  locale: "ko",
  setLocale: () => undefined,
  t: (_en, ko) => ko,
};

export const I18nContext = createContext<I18nValue>(defaultValue);

export function storedLocale(): AppLocale {
  try {
    return window.localStorage.getItem(localeStorageKey) === "en" ? "en" : "ko";
  } catch {
    return "ko";
  }
}

export function useI18n(): I18nValue {
  return useContext(I18nContext);
}

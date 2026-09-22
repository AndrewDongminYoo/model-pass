import { useEffect, useState, type PropsWithChildren } from "react";
import { appNameFor, type AppLocale } from "./brand";
import { I18nContext, localeStorageKey, storedLocale } from "./locale";

export function I18nProvider({ children }: PropsWithChildren) {
  const [locale, updateLocale] = useState<AppLocale>(storedLocale);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = appNameFor(locale);
  }, [locale]);

  function setLocale(nextLocale: AppLocale) {
    updateLocale(nextLocale);
    try {
      window.localStorage.setItem(localeStorageKey, nextLocale);
    } catch {
      // Keep the current in-memory choice when storage is unavailable.
    }
  }

  return (
    <I18nContext.Provider
      value={{
        locale,
        setLocale,
        t: (en, ko) => (locale === "ko" ? ko : en),
      }}
    >
      {children}
    </I18nContext.Provider>
  );
}

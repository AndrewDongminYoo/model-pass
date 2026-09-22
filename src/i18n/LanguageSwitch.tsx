import { useI18n } from "./locale";

export function LanguageSwitch() {
  const { locale, setLocale, t } = useI18n();

  return (
    <div
      className="language-switch"
      role="group"
      aria-label={t("Language", "언어")}
    >
      <button
        type="button"
        aria-pressed={locale === "ko"}
        onClick={() => setLocale("ko")}
      >
        한국어
      </button>
      <button
        type="button"
        aria-pressed={locale === "en"}
        onClick={() => setLocale("en")}
      >
        English
      </button>
    </div>
  );
}

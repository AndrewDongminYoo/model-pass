export const appNames = {
  ko: "모델패스",
  en: "Model Pass",
} as const;

export type AppLocale = keyof typeof appNames;

export function appNameFor(locale: AppLocale): string {
  return appNames[locale];
}

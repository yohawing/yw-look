import i18next from "i18next";
import { initReactI18next, useTranslation } from "react-i18next";
import en from "./locales/en.json";
import ja from "./locales/ja.json";
import zh from "./locales/zh-Hans.json";
import ko from "./locales/ko.json";
import type { LocalizedMessage } from "./localizedMessage";

export const supportedLocales = ["en", "ja", "zh-Hans", "ko"] as const;
export type Locale = (typeof supportedLocales)[number];
export type LanguagePreference = "system" | Locale;

export function resolveLocale(
  preference: string | undefined,
  languages: readonly string[] = [],
): Locale {
  if (supportedLocales.includes(preference as Locale))
    return preference as Locale;
  for (const language of languages) {
    try {
      const locale = new Intl.Locale(language);
      if (locale.language === "zh") {
        if (locale.maximize().script === "Hans") return "zh-Hans";
      } else if (supportedLocales.includes(locale.language as Locale)) {
        return locale.language as Locale;
      }
    } catch {
      /* Ignore malformed system language tags. */
    }
  }
  return "en";
}

export const i18n = i18next.createInstance();
void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    ja: { translation: ja },
    "zh-Hans": { translation: zh },
    ko: { translation: ko },
  },
  lng: "en",
  fallbackLng: "en",
  supportedLngs: [...supportedLocales],
  load: "currentOnly",
  initAsync: false,
  keySeparator: false,
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

export function setLanguage(preference: string | undefined) {
  const locale = resolveLocale(
    preference,
    typeof navigator === "undefined" ? [] : navigator.languages,
  );
  void i18n.changeLanguage(locale);
  if (typeof document !== "undefined") document.documentElement.lang = locale;
}

export function useLocale() {
  const { i18n: instance } = useTranslation(undefined, { i18n });
  return instance.resolvedLanguage ?? "en";
}

export function t(key: string, values?: Record<string, string | number>) {
  return i18n.t(key, values ?? {});
}

export function formatNumber(
  value: number,
  options?: Intl.NumberFormatOptions,
) {
  return new Intl.NumberFormat(i18n.resolvedLanguage ?? "en", options).format(
    value,
  );
}

export function formatLocalizedMessage(
  message: string | LocalizedMessage,
): string {
  if (typeof message === "string") return message;
  return i18n.t(message.key, {
    defaultValue: message.defaultValue,
    ...message.values,
  });
}

import { i18n } from "../../lib/i18n";
import en from "./locales/en.json";
import ja from "./locales/ja.json";
import zh from "./locales/zh-Hans.json";
import ko from "./locales/ko.json";

for (const [language, resource] of Object.entries({
  en,
  ja,
  "zh-Hans": zh,
  ko,
})) {
  i18n.addResourceBundle(language, "vrm-loader-pack", resource);
}

import { useTranslation } from "react-i18next";
import CustomSelect from "./CustomSelect";

const LANG_OPTIONS = [
  { value: "de", label: "🇩🇪 DE" },
  { value: "en", label: "🇬🇧 EN" },
];

export default function LanguageSelector() {
  const { i18n } = useTranslation();
  const lang = i18n.language?.startsWith("en") ? "en" : "de";

  return (
    <CustomSelect
      value={lang}
      options={LANG_OPTIONS}
      onChange={(val) => i18n.changeLanguage(val)}
      className="w-24"
    />
  );
}

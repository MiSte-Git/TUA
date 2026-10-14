import { useTranslation } from "react-i18next";
import CustomSelect from "./CustomSelect";
import { SUPPORTED_LANGUAGES } from "../i18n";

const LANG_OPTIONS = SUPPORTED_LANGUAGES.map((l) => ({
  value: l.code,
  label: `${l.flag} ${l.code.toUpperCase()}`,
}));

export default function LanguageSelector() {
  const { i18n } = useTranslation();
  const lang = i18n.resolvedLanguage ?? "de";

  return (
    <CustomSelect
      value={lang}
      options={LANG_OPTIONS}
      onChange={(val) => i18n.changeLanguage(val)}
      className="w-24"
    />
  );
}

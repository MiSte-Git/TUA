import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { useTranslation } from "react-i18next";
import CustomSelect from "./CustomSelect";

interface Props {
  months: number; // 1/3/6/9/12, or 0 = custom
  dateFrom: Date | null;
  dateTo: Date | null;
  onChangeMonths: (months: number) => void;
  onChangeDates: (from: Date | null, to: Date | null) => void;
  disabled: boolean;
}

const PRESET_MONTHS = [1, 3, 6, 9, 12];

const pickerInputClass =
  "bg-[#1e1e2e] border border-[#3a3a5a] focus:border-[#7c6af7] outline-none px-2 py-1 rounded text-[#e0e0f0] text-sm w-28 disabled:opacity-50";

export default function PeriodSelector({
  months,
  dateFrom,
  dateTo,
  onChangeMonths,
  onChangeDates,
  disabled,
}: Props) {
  const { t } = useTranslation();
  const isCustom = months === 0;

  const periodOptions = [
    ...PRESET_MONTHS.map((m) => ({
      value: String(m),
      label: t("period.last_months", { count: m }),
    })),
    { value: "custom", label: t("period.custom") },
  ];

  function handleSelectChange(val: string) {
    if (val === "custom") {
      onChangeMonths(0);
    } else {
      onChangeMonths(parseInt(val, 10));
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="text-[#888aaa] text-xs font-medium uppercase tracking-wide">
        {t("period.label")}
      </label>

      <CustomSelect
        value={isCustom ? "custom" : String(months)}
        options={periodOptions}
        onChange={handleSelectChange}
        disabled={disabled}
      />

      {isCustom && (
        <div className="flex items-center gap-3 mt-1 flex-wrap">
          <label className="text-[#888aaa] text-xs shrink-0">{t("period.from")}</label>
          <DatePicker
            selected={dateFrom}
            onChange={(date: Date | null) => onChangeDates(date, dateTo)}
            dateFormat="dd.MM.yyyy"
            placeholderText="TT.MM.JJJJ"
            disabled={disabled}
            className={pickerInputClass}
            popperPlacement="bottom-start"
          />
          <label className="text-[#888aaa] text-xs shrink-0">{t("period.to")}</label>
          <div className="flex items-center gap-1">
            <DatePicker
              selected={dateTo}
              onChange={(date: Date | null) => onChangeDates(dateFrom, date)}
              dateFormat="dd.MM.yyyy"
              placeholderText="TT.MM.JJJJ"
              disabled={disabled}
              className={pickerInputClass}
              popperPlacement="bottom-start"
            />
            <button
              type="button"
              onClick={() => onChangeDates(dateFrom, new Date())}
              disabled={disabled}
              className="text-xs text-[#888aaa] hover:text-[#e0e0f0] px-2 py-1 rounded border border-[#3a3a5a] hover:border-[#7c6af7] transition-colors disabled:opacity-50 whitespace-nowrap"
            >
              {t("period.today")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

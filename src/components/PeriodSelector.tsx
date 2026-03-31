interface Props {
  value: number;
  onChange: (months: number) => void;
  disabled: boolean;
}

const PERIODS = [3, 6, 9, 12];

export default function PeriodSelector({ value, onChange, disabled }: Props) {
  return (
    <div className="flex flex-col gap-2">
      <label className="text-[#888aaa] text-xs font-medium uppercase tracking-wide">
        Analysezeitraum
      </label>
      <div className="flex gap-2">
        {PERIODS.map((months) => (
          <button
            key={months}
            onClick={() => onChange(months)}
            disabled={disabled}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
              value === months
                ? "bg-[#7c6af7] text-white"
                : "bg-[#2a2a3e] text-[#888aaa] hover:bg-[#3a3a5e] hover:text-[#e0e0f0]"
            }`}
          >
            {months} Monate
          </button>
        ))}
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";

export interface SelectOption {
  value: string;
  label: string;
}

interface Props {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}

export default function CustomSelect({
  value,
  options,
  onChange,
  disabled,
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, []);

  return (
    <div ref={ref} className={`relative ${className ?? ""}`}>
      <button
        type="button"
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        className="w-full flex items-center justify-between bg-[#1e1e2e] border border-[#3a3a5a] hover:border-[#7c6af7] focus:border-[#7c6af7] outline-none px-3 py-2 rounded-lg text-[#e0e0f0] text-sm disabled:opacity-50 cursor-pointer transition-colors"
      >
        <span>{selected?.label ?? value}</span>
        <span
          className={`ml-2 text-[#888aaa] text-xs transition-transform duration-150 ${
            open ? "rotate-180" : ""
          }`}
        >
          ▾
        </span>
      </button>

      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-[#1e1e2e] border border-[#3a3a5a] rounded-lg shadow-xl z-50 overflow-hidden">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              className={`w-full text-left px-3 py-2 text-sm transition-colors hover:bg-[#2a2a3e] border-b border-[#2a2a3e] last:border-b-0 ${
                opt.value === value
                  ? "text-[#7c6af7] font-medium"
                  : "text-[#e0e0f0]"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

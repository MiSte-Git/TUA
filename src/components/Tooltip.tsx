import { useState } from "react";

interface Props {
  text: string;
  children: React.ReactNode;
  down?: boolean;
}

export default function Tooltip({ text, children, down = false }: Props) {
  const [visible, setVisible] = useState(false);

  return (
    <span
      className="relative inline-flex items-center gap-1"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      {children}
      <span className="text-[#a0a0cc] hover:text-[#7c6af7] text-xs cursor-default select-none transition-colors">ⓘ</span>
      {visible && (
        <span
          className={`absolute left-0 z-50 w-[220px] bg-[#2a2a4a] border border-[#3a3a5a] text-[#b0b0c8] text-xs rounded-lg px-3 py-2 shadow-xl pointer-events-none whitespace-normal leading-relaxed ${
            down ? "top-full mt-1.5" : "bottom-full mb-1.5"
          }`}
        >
          {text}
        </span>
      )}
    </span>
  );
}

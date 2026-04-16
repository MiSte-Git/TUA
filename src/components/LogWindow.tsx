import { useEffect, useRef } from "react";

interface Props {
  logs: string[];
}

export default function LogWindow({ logs }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  return (
    <div
      className="bg-[#111120] rounded-xl p-3 font-mono text-sm text-[#a0ffa0] flex flex-col"
      style={{ resize: "vertical", overflow: "auto", minHeight: "80px", height: "200px" }}
    >
      {logs.length === 0 ? (
        <span className="text-[#3a3a5a] select-none">— Log leer —</span>
      ) : (
        logs.map((line, i) => (
          <span key={i} className="leading-5 whitespace-pre-wrap break-all">
            {line}
          </span>
        ))
      )}
      <div ref={bottomRef} />
    </div>
  );
}

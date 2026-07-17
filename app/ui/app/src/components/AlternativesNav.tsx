import { useState, useEffect } from "react";
import { getAlternatives, type Alternative } from "@/lib/alternatives";

export function AlternativesNav({
  chatId,
  messageIndex,
  currentContent,
  onSwitch,
}: {
  chatId: string;
  messageIndex: number;
  currentContent: string;
  onSwitch: (alt: Alternative & { isCurrent?: boolean }) => void;
}) {
  const [alternatives, setAlternatives] = useState<Alternative[]>([]);
  const [activeIdx, setActiveIdx] = useState(-1); // -1 = current message

  useEffect(() => {
    const alts = getAlternatives(chatId, messageIndex);
    setAlternatives(alts);
    setActiveIdx(-1);
  }, [chatId, messageIndex]);

  if (alternatives.length === 0) return null;

  const total = alternatives.length + 1; // +1 for current
  const currentPos = activeIdx + 2; // 1-indexed, current = 1

  const goLeft = () => {
    const next = activeIdx - 1;
    if (next < -1) return;
    setActiveIdx(next);
    if (next === -1) {
      onSwitch({ content: currentContent, thinking: "", model: "", created_at: "", isCurrent: true });
    } else {
      onSwitch(alternatives[next]);
    }
  };

  const goRight = () => {
    const next = activeIdx + 1;
    if (next >= alternatives.length) return;
    setActiveIdx(next);
    onSwitch(alternatives[next]);
  };

  return (
    <div className="flex items-center gap-1.5 text-xs text-neutral-400 dark:text-neutral-500 mt-1">
      <button
        type="button"
        onClick={goLeft}
        disabled={activeIdx <= -1}
        className="px-1 hover:text-neutral-600 dark:hover:text-neutral-300 disabled:opacity-30 cursor-pointer disabled:cursor-default"
      >
        &lt;
      </button>
      <span>{currentPos}/{total}</span>
      <button
        type="button"
        onClick={goRight}
        disabled={activeIdx >= alternatives.length - 1}
        className="px-1 hover:text-neutral-600 dark:hover:text-neutral-300 disabled:opacity-30 cursor-pointer disabled:cursor-default"
      >
        &gt;
      </button>
    </div>
  );
}

import { CopySimple } from "@phosphor-icons/react";
import React, { useState } from "react";
import { useSettings } from "@/hooks/useSettings";
import {
  secureClipboardWrite,
  secureClipboardWriteItems,
} from "@/utils/secureClipboard";

interface CopyButtonProps {
  content: string;
  copyRef?: React.RefObject<HTMLElement | null>;
  removeClasses?: string[];
  size?: "sm" | "md";
  showLabels?: boolean;
  className?: string;
  title?: string;
}

const CopyButton: React.FC<CopyButtonProps> = ({
  content,
  copyRef,
  removeClasses = [],
  size = "sm",
  showLabels = false,
  className = "",
  title = "",
}) => {
  const [isCopied, setIsCopied] = useState(false);
  const { settings } = useSettings();
  const clearSeconds = settings.clipboardClearSeconds;

  const handleCopy = async () => {
    try {
      if (copyRef?.current) {
        // For copy response message
        const cloned = copyRef.current.cloneNode(true) as HTMLElement;

        removeClasses.forEach((className) => {
          cloned
            .querySelectorAll(`.${className}`)
            .forEach((element) => element.remove());
        });

        await secureClipboardWriteItems(
          [
            new ClipboardItem({
              "text/html": new Blob([cloned.innerHTML], {
                type: "text/html",
              }),
              "text/plain": new Blob([content], { type: "text/plain" }),
            }),
          ],
          clearSeconds,
        );
      } else {
        await secureClipboardWrite(content, clearSeconds);
      }

      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (error) {
      console.error("Clipboard API failed, falling back to plain text", error);
      try {
        await secureClipboardWrite(content, clearSeconds);
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 2000);
      } catch (fallbackError) {
        console.error("Fallback copy also failed:", fallbackError);
      }
    }
  };

  const iconSize = size === "sm" ? "h-3 w-3" : "h-7 w-7";
  const copiedBg = isCopied ? "bg-green-50 dark:bg-green-900/20" : "";
  const baseClasses =
    size === "sm"
      ? `text-xs px-4 py-2 z-10 rounded-lg hover:cursor-pointer transition-colors duration-200 btn-press-sm ${copiedBg} ${className}`
      : `${iconSize} px-1 py-0.5 text-xs cursor-pointer rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 flex items-center justify-center transition-colors duration-200 btn-press-sm ${copiedBg} ${className}`;

  const icon = isCopied ? (
    <svg className={`${iconSize} text-green-500`} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 8.5L6.5 12L13 4" style={{ strokeDasharray: 16, strokeDashoffset: 0, animation: "draw-check 0.25s ease-out" }} />
    </svg>
  ) : (
    <CopySimple className={iconSize} />
  );

  return (
    <button
      type="button"
      className={baseClasses}
      onClick={handleCopy}
      title={title}
    >
      {showLabels ? (
        <span className="flex items-center gap-1">
          {icon}
          {isCopied ? "Copié" : "Copier"}
        </span>
      ) : (
        icon
      )}
    </button>
  );
};

export default CopyButton;

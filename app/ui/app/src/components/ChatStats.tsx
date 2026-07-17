import { Message } from "@/gotypes";
import { useState, useRef, useEffect } from "react";

export function ChatStats({ messages }: { messages: Message[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  if (!messages || messages.length === 0) return null;

  const userMsgs = messages.filter((m) => m.role === "user");
  const assistantMsgs = messages.filter((m) => m.role === "assistant");
  const totalChars = messages.reduce((acc, m) => acc + (m.content?.length || 0), 0);
  const estimatedTokens = Math.ceil(totalChars / 4);

  const models = [...new Set(assistantMsgs.map((m) => m.model).filter(Boolean))];

  const firstMsg = messages[0];
  const lastMsg = messages[messages.length - 1];
  let duration = "";
  if (firstMsg?.created_at && lastMsg?.created_at) {
    const start = new Date(firstMsg.created_at as unknown as string | number).getTime();
    const end = new Date(lastMsg.created_at as unknown as string | number).getTime();
    const diffMs = end - start;
    if (diffMs > 0) {
      const mins = Math.floor(diffMs / 60000);
      const hours = Math.floor(mins / 60);
      if (hours > 0) duration = `${hours}h ${mins % 60}m`;
      else if (mins > 0) duration = `${mins}m`;
      else duration = `${Math.floor(diffMs / 1000)}s`;
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="p-1 rounded text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors cursor-pointer"
        title="Statistiques" aria-label="Statistiques de la conversation"
      >
        <svg width="14" height="14" viewBox="0 0 256 256" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="128" cy="128" r="96" stroke="currentColor" strokeWidth="20" fill="none"/>
          <line x1="128" y1="120" x2="128" y2="176" stroke="currentColor" strokeWidth="20" strokeLinecap="round"/>
          <circle cx="128" cy="88" r="10" fill="currentColor"/>
        </svg>
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-1 w-56 rounded-lg border border-neutral-200 bg-white shadow-lg dark:border-neutral-700 dark:bg-neutral-800 z-50 p-3 animate-popover">
          <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-2">
            Statistiques
          </div>
          <div className="space-y-1.5 text-xs text-neutral-600 dark:text-neutral-300">
            <div className="flex justify-between">
              <span>Messages</span>
              <span>{userMsgs.length} user / {assistantMsgs.length} assistant</span>
            </div>
            <div className="flex justify-between">
              <span>Tokens estimes</span>
              <span>~{estimatedTokens.toLocaleString()}</span>
            </div>
            {duration && (
              <div className="flex justify-between">
                <span>Duree</span>
                <span>{duration}</span>
              </div>
            )}
            {models.length > 0 && (
              <div className="flex justify-between">
                <span>Modele{models.length > 1 ? "s" : ""}</span>
                <span className="text-right max-w-[120px] truncate">{models.join(", ")}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

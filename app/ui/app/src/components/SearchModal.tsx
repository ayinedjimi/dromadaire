import { useState, useRef, useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { MagnifyingGlass, X } from "@phosphor-icons/react";
import { useSearch } from "@/hooks/useSearch";

interface SearchModalProps {
  onClose: () => void;
}

export function SearchModal({ onClose }: SearchModalProps) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { data: results, isLoading } = useSearch(query);

  // Autofocus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleResultClick = (chatId: string) => {
    onClose();
    navigate({ to: "/c/$chatId", params: { chatId } });
  };

  // Highlight query match in excerpt
  const highlightExcerpt = (text: string) => {
    if (!query.trim()) return text;
    const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
    const parts = text.split(regex);
    return parts.map((part, i) =>
      regex.test(part) ? (
        <mark key={i} className="bg-yellow-200 dark:bg-yellow-700 rounded px-0.5">
          {part}
        </mark>
      ) : (
        part
      ),
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/50 animate-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl dark:bg-neutral-800 overflow-hidden animate-modal-enter">
        {/* Search input */}
        <div className="flex items-center gap-3 border-b border-neutral-200 px-4 py-3 dark:border-neutral-700">
          <MagnifyingGlass className="h-5 w-5 flex-shrink-0 text-neutral-400" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher dans les conversations..."
            className="flex-1 bg-transparent text-sm text-neutral-900 placeholder-neutral-400 outline-none dark:text-white"
          />
          <button
            onClick={onClose}
            aria-label="Fermer la recherche"
            className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-700 dark:hover:text-neutral-300"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto">
          {isLoading && query.trim() && (
            <div className="px-4 py-6 text-center text-sm text-neutral-400">
              Recherche en cours...
            </div>
          )}

          {!isLoading && query.trim() && results && results.length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-neutral-400">
              Aucun résultat pour &quot;{query}&quot;
            </div>
          )}

          {!isLoading && results && results.length > 0 && (
            <ul className="py-1">
              {results.map((result, i) => (
                <li key={`${result.chat_id}-${i}`}>
                  <button
                    onClick={() => handleResultClick(result.chat_id)}
                    className="w-full px-4 py-3 text-left hover:bg-neutral-50 dark:hover:bg-neutral-700/50 transition-colors"
                  >
                    <div className="text-sm font-medium text-neutral-900 dark:text-white truncate">
                      {result.chat_title || "Sans titre"}
                    </div>
                    <div className="mt-1 text-xs text-neutral-500 dark:text-neutral-400 line-clamp-2">
                      {result.role && (
                        <span className="inline-block rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300 mr-1.5">
                          {result.role}
                        </span>
                      )}
                      {highlightExcerpt(result.excerpt)}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {!query.trim() && (
            <div className="px-4 py-6 text-center text-sm text-neutral-400">
              Tapez pour rechercher dans vos conversations
            </div>
          )}
        </div>

        {/* Footer hint */}
        <div className="border-t border-neutral-200 px-4 py-2 dark:border-neutral-700">
          <div className="flex items-center justify-between text-[10px] text-neutral-400">
            <span>
              <kbd className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono dark:bg-neutral-700">
                Esc
              </kbd>{" "}
              pour fermer
            </span>
            <span>
              <kbd className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono dark:bg-neutral-700">
                Enter
              </kbd>{" "}
              pour ouvrir
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { X } from "@phosphor-icons/react";
import { getRAGDocumentChunks } from "@/api";

interface DocumentPreviewProps {
  documentId: string;
  documentName: string;
  highlightChunkIndex?: number;
  onClose: () => void;
  rightOffset?: number;
}

export function DocumentPreview({
  documentId,
  documentName,
  highlightChunkIndex,
  onClose,
  rightOffset = 0,
}: DocumentPreviewProps) {
  const highlightRef = useRef<HTMLDivElement>(null);

  const { data: chunks, isLoading } = useQuery({
    queryKey: ["rag-chunks", documentId],
    queryFn: () => getRAGDocumentChunks(documentId),
  });

  // Auto-scroll to highlighted chunk
  useEffect(() => {
    if (highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [chunks, highlightChunkIndex]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="fixed top-0 z-50 flex h-full w-96 flex-col border-l border-[hsl(var(--border-100))] bg-[hsl(var(--bg-000))] shadow-xl"
      style={{ right: rightOffset }}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[hsl(var(--border-100))] px-4 py-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-[hsl(var(--text-000))]">
            {documentName}
          </h3>
          <p className="text-xs text-[hsl(var(--text-300))]">
            {chunks ? `${chunks.length} chunks` : "Chargement..."}
          </p>
        </div>
        <button
          onClick={onClose}
          aria-label="Fermer l'aperçu du document"
          className="ml-3 rounded p-1 text-[hsl(var(--text-400))] hover:bg-[hsl(var(--bg-100))] hover:text-[hsl(var(--text-100))]"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Chunks list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {isLoading && (
          <div className="text-center text-sm text-[hsl(var(--text-400))] py-8">
            Chargement des chunks...
          </div>
        )}

        {chunks?.map((chunk) => {
          const isHighlighted = chunk.chunk_index === highlightChunkIndex;
          return (
            <div
              key={chunk.id}
              ref={isHighlighted ? highlightRef : undefined}
              className={`rounded-lg border p-3 text-sm transition-colors ${
                isHighlighted
                  ? "border-blue-400 bg-blue-50 dark:border-blue-600 dark:bg-blue-950/30"
                  : "border-[hsl(var(--border-100))] bg-[hsl(var(--bg-100))]"
              }`}
            >
              <div className="mb-2 flex items-center justify-between">
                <span
                  className={`rounded px-2 py-0.5 text-xs font-medium ${
                    isHighlighted
                      ? "bg-blue-200 text-blue-800 dark:bg-blue-800 dark:text-blue-200"
                      : "bg-[hsl(var(--bg-200))] text-[hsl(var(--text-200))]"
                  }`}
                >
                  Chunk {chunk.chunk_index + 1}
                </span>
                <span className="text-xs text-[hsl(var(--text-400))]">
                  {chunk.token_count} tokens
                </span>
              </div>
              <p className="whitespace-pre-wrap text-[hsl(var(--text-100))] text-xs leading-relaxed">
                {chunk.content}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

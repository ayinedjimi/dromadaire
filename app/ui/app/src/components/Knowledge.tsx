import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft, X, Trash } from "@phosphor-icons/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getRAGDocuments, uploadRAGDocument, deleteRAGDocument } from "@/api";
import type { RAGDocument } from "@/api";
import { useRef, useState, useCallback, useEffect } from "react";
import { useInferenceCompute } from "@/hooks/useInferenceCompute";
import { useSettings } from "@/hooks/useSettings";

const MAX_FILE_SIZE_CPU = 2 * 1024 * 1024; // 2 Mo
const MAX_FILE_SIZE_GPU = 50 * 1024 * 1024; // 50 Mo

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

function ProgressBar({ doc }: { doc: RAGDocument }) {
  const startTimeRef = useRef<number | null>(null);
  const firstChunkRef = useRef<number>(0);
  const [eta, setEta] = useState<string>("");

  useEffect(() => {
    if (doc.progress_current > 0 && doc.progress_total > 0) {
      if (startTimeRef.current === null) {
        startTimeRef.current = Date.now();
        firstChunkRef.current = doc.progress_current;
      }

      const elapsed = (Date.now() - startTimeRef.current) / 1000;
      const chunksProcessed = doc.progress_current - firstChunkRef.current;

      if (chunksProcessed > 0) {
        const avgPerChunk = elapsed / chunksProcessed;
        const remaining = (doc.progress_total - doc.progress_current) * avgPerChunk;

        if (remaining < 60) {
          setEta(`~${Math.ceil(remaining)}s restant`);
        } else {
          const mins = Math.floor(remaining / 60);
          const secs = Math.ceil(remaining % 60);
          setEta(`~${mins}m${secs.toString().padStart(2, "0")}s restant`);
        }
      }
    }
  }, [doc.progress_current, doc.progress_total]);

  const pct = doc.progress_total > 0
    ? Math.round((doc.progress_current / doc.progress_total) * 100)
    : 0;

  return (
    <div className="w-full mt-1.5">
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-blue-600 dark:text-blue-400 font-medium">
          Chunk {doc.progress_current}/{doc.progress_total}
        </span>
        {eta && (
          <span className="text-neutral-400 dark:text-neutral-500">
            {eta}
          </span>
        )}
      </div>
      <div className="w-full h-1.5 bg-neutral-200 dark:bg-neutral-700 rounded-full overflow-hidden">
        <div
          className="h-full bg-blue-500 rounded-full transition-all duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function StatusBadge({ doc }: { doc: RAGDocument }) {
  switch (doc.status) {
    case "pending":
      return (
        <span className="inline-flex items-center rounded-full bg-yellow-100 dark:bg-yellow-900/30 px-2 py-0.5 text-xs font-medium text-yellow-700 dark:text-yellow-400">
          En attente
        </span>
      );
    case "processing":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 dark:bg-blue-900/30 px-2 py-0.5 text-xs font-medium text-blue-700 dark:text-blue-400">
          <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Embedding...
        </span>
      );
    case "ready":
      return (
        <span className="inline-flex items-center rounded-full bg-green-100 dark:bg-green-900/30 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-400">
          Pret ({doc.chunk_count} chunks)
        </span>
      );
    case "error":
      return (
        <span className="inline-flex items-center rounded-full bg-red-100 dark:bg-red-900/30 px-2 py-0.5 text-xs font-medium text-red-700 dark:text-red-400" title={doc.error_message}>
          Erreur
        </span>
      );
    default:
      return null;
  }
}

export default function Knowledge() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [fileSizeError, setFileSizeError] = useState<string | null>(null);
  const { isGPU, gpuName } = useInferenceCompute();
  const { settings } = useSettings();

  const maxFileSize = isGPU ? MAX_FILE_SIZE_GPU : MAX_FILE_SIZE_CPU;
  const embeddingModel = settings.embeddingModel || (isGPU ? "snowflake-arctic-embed:110m" : "snowflake-arctic-embed:33m");

  const { data: documents = [], isLoading } = useQuery({
    queryKey: ["rag-documents"],
    queryFn: getRAGDocuments,
    refetchInterval: (query) => {
      // Poll every 2s while any document is processing
      const docs = query.state.data;
      if (docs && docs.some((d: RAGDocument) => d.status === "pending" || d.status === "processing")) {
        return 2000;
      }
      return false;
    },
  });

  const uploadMutation = useMutation({
    mutationFn: uploadRAGDocument,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rag-documents"] });
    },
    onError: (error: Error) => {
      setFileSizeError(error.message);
      setTimeout(() => setFileSizeError(null), 5000);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteRAGDocument,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rag-documents"] });
    },
  });

  const handleFiles = useCallback(
    (files: FileList | File[]) => {
      setFileSizeError(null);
      for (const file of Array.from(files)) {
        if (file.size > maxFileSize) {
          const limitStr = isGPU ? "50 Mo" : "2 Mo";
          setFileSizeError(
            `Fichier trop volumineux (${formatFileSize(file.size)}). Limite ${isGPU ? "GPU" : "CPU"} : ${limitStr}.${
              !isGPU ? " L'embedding sur CPU est lent (~3s/chunk). Les fichiers volumineux peuvent prendre des heures." : ""
            }`
          );
          setTimeout(() => setFileSizeError(null), 8000);
          return;
        }
        uploadMutation.mutate(file);
      }
    },
    [uploadMutation, maxFileSize, isGPU],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer.files.length > 0) {
        handleFiles(e.dataTransfer.files);
      }
    },
    [handleFiles],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const isWindows = navigator.platform.toLowerCase().includes("win");

  return (
    <main className="flex h-screen w-full flex-col select-none dark:bg-neutral-900">
      <header
        className="w-full flex flex-none justify-between h-[52px] py-2.5 items-center border-b border-neutral-200 dark:border-neutral-800 select-none"
        onMouseDown={() => window.drag && window.drag()}
        onDoubleClick={() => window.doubleClick && window.doubleClick()}
      >
        <h1
          className={`${isWindows ? "pl-4" : "pl-24"} flex items-center font-rounded text-md font-medium dark:text-white`}
        >
          {isWindows && (
            <button
              onClick={() => navigate({ to: "/" })}
              className="hover:bg-neutral-100 mr-3 dark:hover:bg-neutral-800 rounded-full p-1.5"
            >
              <ArrowLeft className="w-5 h-5 dark:text-white" />
            </button>
          )}
          Connaissances
        </h1>
        <div className="flex items-center gap-2 pr-3">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="text-sm px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
          >
            + Ajouter
          </button>
          {!isWindows && (
            <button
              onClick={() => navigate({ to: "/" })}
              className="p-1 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-full"
            >
              <X className="w-6 h-6 dark:text-white" />
            </button>
          )}
        </div>
      </header>

      <div
        className="w-full p-6 overflow-y-auto flex-1 overscroll-contain"
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        <div className="max-w-2xl mx-auto">
          {/* LED CPU/GPU indicator */}
          <div className="flex items-center gap-2 mb-4 px-1">
            <div
              className={`w-2 h-2 rounded-full flex-shrink-0 ${
                isGPU ? "bg-green-500" : "bg-orange-500"
              }`}
            />
            <span className="text-xs text-neutral-500 dark:text-neutral-400">
              {isGPU ? `GPU (${gpuName})` : "CPU"} · {embeddingModel}
            </span>
            <span className="text-xs text-neutral-400 dark:text-neutral-600 ml-auto">
              Max {isGPU ? "50 Mo" : "2 Mo"}
            </span>
          </div>

          {/* File size error */}
          {fileSizeError && (
            <div className="mb-4 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 p-3">
              <p className="text-sm text-red-700 dark:text-red-400">
                {fileSizeError}
              </p>
            </div>
          )}

          {/* Drop zone - always visible, compact when documents exist */}
          <div
            className={`rounded-2xl border-2 border-dashed text-center transition-colors mb-6 ${
              documents.length > 0 ? "p-4" : "p-12"
            } ${
              isDragging
                ? "border-blue-400 bg-blue-50 dark:bg-blue-950/20"
                : "border-neutral-300 dark:border-neutral-700"
            }`}
          >
            {documents.length === 0 && (
              <div className="mx-auto w-12 h-12 rounded-full bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center mb-4">
                <svg className="w-6 h-6 text-neutral-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m6.75 12l-3-3m0 0l-3 3m3-3v6m-1.5-15H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                </svg>
              </div>
            )}
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              Glissez des fichiers ici ou cliquez sur "+ Ajouter"
            </p>
            {documents.length === 0 && (
              <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-1">
                PDF, TXT, et autres fichiers texte
              </p>
            )}
          </div>

          {/* Loading */}
          {isLoading && (
            <p className="text-sm text-neutral-500 dark:text-neutral-400 text-center py-8">
              Chargement...
            </p>
          )}

          {/* Document cards */}
          {documents.length > 0 && (
            <div className="space-y-3">
              {documents.map((doc) => (
                <div
                  key={doc.id}
                  className="rounded-xl bg-white dark:bg-neutral-800 p-4 flex items-start gap-4 group"
                >
                  {/* File icon */}
                  <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-neutral-100 dark:bg-neutral-700 flex items-center justify-center">
                    <svg className="w-5 h-5 text-neutral-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                    </svg>
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-neutral-800 dark:text-neutral-200 truncate">
                      {doc.filename}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-neutral-400 dark:text-neutral-500">
                        {formatFileSize(doc.file_size)}
                      </span>
                      <StatusBadge doc={doc} />
                    </div>
                    {doc.status === "processing" && doc.progress_total > 0 && (
                      <ProgressBar doc={doc} />
                    )}
                    {doc.status === "error" && doc.error_message && (
                      <p className="text-xs text-red-500 dark:text-red-400 mt-1 truncate">
                        {doc.error_message}
                      </p>
                    )}
                  </div>

                  {/* Delete */}
                  <button
                    onClick={() => {
                      if (window.confirm(`Supprimer "${doc.filename}" ?`)) {
                        deleteMutation.mutate(doc.id);
                      }
                    }}
                    className="flex-shrink-0 p-2 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-red-50 dark:hover:bg-red-950/30 text-neutral-400 hover:text-red-500 dark:hover:text-red-400 transition-all"
                    title="Supprimer"
                  >
                    <Trash className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.txt,.md,.csv,.json,.xml,.html,.htm,.log,.py,.js,.ts,.go,.java,.c,.cpp,.h,.rs,.rb,.php,.sh,.bat,.yaml,.yml,.toml,.ini,.cfg,.conf,.env,.sql,.r,.m,.swift,.kt,.cs,.vb,.pl,.lua,.scala"
        multiple
        onChange={(e) => {
          if (e.target.files) {
            handleFiles(e.target.files);
            e.target.value = "";
          }
        }}
        className="hidden"
      />
    </main>
  );
}

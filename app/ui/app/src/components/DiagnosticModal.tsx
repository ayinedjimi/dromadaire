import { useState, useEffect } from "react";
import { X, Copy, Check, CircleNotch } from "@phosphor-icons/react";
import { getDiagnostics, type DiagnosticsData } from "@/api";

function formatDiagnostics(d: DiagnosticsData): string {
  const lines: string[] = [];

  lines.push("=== DROMADAIRE — DIAGNOSTIC SYSTEME ===");
  lines.push(`Date: ${new Date().toISOString()}`);
  lines.push("");

  // App
  lines.push("--- Application ---");
  lines.push(`Version: ${d.app_version}`);
  lines.push(`Schema DB: v${d.schema_version}`);
  lines.push(`Mode portable: ${d.portable_mode ? "Oui" : "Non"}`);
  lines.push("");

  // System
  lines.push("--- Systeme ---");
  lines.push(`OS: ${d.os} (${d.arch})`);
  lines.push(`CPU: ${d.cpu_cores} coeurs`);
  lines.push(`RAM: ${d.total_ram_gb} Go`);
  if (d.build_info?.go_version) {
    lines.push(`Go: ${d.build_info.go_version}`);
  }
  lines.push("");

  // GPU
  lines.push("--- GPU ---");
  if (d.gpu_devices && d.gpu_devices.length > 0) {
    for (const gpu of d.gpu_devices) {
      if (gpu.library === "cpu") {
        lines.push(`Mode: CPU uniquement`);
      } else {
        lines.push(`GPU: ${gpu.name || "Inconnu"}`);
        lines.push(`  API: ${gpu.library?.toUpperCase() || "N/A"}`);
        lines.push(`  Variante: ${gpu.variant || "N/A"}`);
        lines.push(`  Compute: ${gpu.compute || "N/A"}`);
        lines.push(`  Driver: ${gpu.driver || "N/A"}`);
        lines.push(`  VRAM: ${gpu.vram || "N/A"}`);
      }
    }
  } else {
    lines.push("Aucun GPU detecte (mode CPU)");
  }
  lines.push("");

  // Performance
  lines.push("--- Performance ---");
  const p = d.performance;
  lines.push(`Threads CPU: ${p.num_thread || "auto"}`);
  lines.push(`Context length: ${p.context_length}`);
  lines.push(`Keep alive: ${p.keep_alive || "auto"}`);
  lines.push(`Modeles simultanes: ${p.max_loaded_models || "auto"}`);
  lines.push(`Cache KV: ${p.kv_cache_type || "auto"}`);
  lines.push(`Batch size: ${p.num_batch || "auto"}`);
  lines.push("");

  // Features
  lines.push("--- Fonctionnalites ---");
  const f = d.features;
  lines.push(`RAG: ${f.rag_enabled ? "Actif" : "Inactif"}`);
  if (f.rag_enabled) {
    lines.push(`  Modele embedding: ${f.embedding_model}`);
    lines.push(`  Citations: ${f.citations_enabled ? "Oui" : "Non"}`);
    lines.push(`  Preview: ${f.preview_enabled ? "Oui" : "Non"}`);
  }
  lines.push(`Artifacts: ${f.artifacts_enabled ? "Actif" : "Inactif"}`);
  lines.push(`Recherche: ${f.search_enabled ? "Actif" : "Inactif"}`);
  lines.push(`Chiffrement: ${f.encryption ? "Actif" : "Inactif"}`);
  lines.push(`Mode avion: ${f.airplane_mode ? "Actif" : "Inactif"}`);
  lines.push(`Theme: ${f.theme || "defaut"}`);
  lines.push("");

  // Dromadaire env
  lines.push("--- Variables Dromadaire ---");
  const env = d.ollama_env;
  if (env && Object.keys(env).length > 0) {
    for (const [key, val] of Object.entries(env).sort()) {
      lines.push(`${key}=${val}`);
    }
  } else {
    lines.push("(aucune variable personnalisee)");
  }
  lines.push("");

  // Server
  lines.push("--- Serveur ---");
  lines.push(`Port interne: ${d.server_port || "N/A"}`);
  lines.push("");

  // Logs (last 100 lines)
  lines.push("--- Derniers logs (100 lignes) ---");
  if (d.logs && d.logs.length > 0) {
    for (const line of d.logs) {
      lines.push(line);
    }
  } else {
    lines.push("(aucun log disponible)");
  }

  return lines.join("\n");
}

export function DiagnosticModal({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<DiagnosticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Load diagnostics on mount
  useEffect(() => {
    getDiagnostics()
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  const formattedText = data ? formatDiagnostics(data) : "";

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(formattedText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      const textarea = document.createElement("textarea");
      textarea.value = formattedText;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-neutral-900 rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-200 dark:border-neutral-700">
          <h2 className="text-lg font-semibold dark:text-white">
            Diagnostic systeme
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              disabled={loading || !!error}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {copied ? (
                <>
                  <Check className="w-4 h-4" />
                  Copie !
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" />
                  Copier tout
                </>
              )}
            </button>
            <button
              onClick={onClose}
              className="p-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg transition-colors"
            >
              <X className="w-5 h-5 dark:text-white" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {loading && (
            <div className="flex items-center justify-center py-12 gap-3 text-neutral-500">
              <CircleNotch className="w-5 h-5 animate-spin" />
              Collecte des informations...
            </div>
          )}
          {error && (
            <div className="text-red-500 text-sm py-4">
              Erreur : {error}
            </div>
          )}
          {data && (
            <pre className="text-xs font-mono text-neutral-700 dark:text-neutral-300 whitespace-pre-wrap break-words leading-relaxed select-text">
              {formattedText}
            </pre>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-neutral-200 dark:border-neutral-700 text-xs text-neutral-400 dark:text-neutral-500">
          Copiez ce rapport et envoyez-le au support technique.
        </div>
      </div>
    </div>
  );
}

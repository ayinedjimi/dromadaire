import { useState, useCallback } from "react";
import { useSelectedModel } from "@/hooks/useSelectedModel";
import { useSettings } from "@/hooks/useSettings";
import { useHealth } from "@/hooks/useHealth";
import { useInferenceCompute } from "@/hooks/useInferenceCompute";
import { useIsStreaming } from "@/hooks/useChats";
import { useLoadedModels, isModelLoaded } from "@/hooks/useLoadedModels";
import { useSystemResources, formatBytes, getMemoryLevel } from "@/hooks/useSystemResources";
import { getModelDisplayName } from "@/utils/modelDisplayName";
import { Model } from "@/gotypes";
import { Eject, CircleNotch, CaretDown } from "@phosphor-icons/react";
import { ModelList } from "./ModelPicker";

interface ModelBarProps {
  chatId?: string;
}

export function ModelBar({ chatId }: ModelBarProps) {
  const { selectedModel, setSettings, models, loading } = useSelectedModel(chatId);
  const { settings } = useSettings();
  const { isHealthy } = useHealth();
  const { isGPU, gpuName } = useInferenceCompute();
  const isStreaming = useIsStreaming(chatId || "new");
  const { data: loadedModels } = useLoadedModels();
  const { data: sysMem } = useSystemResources();
  const currentModelLoaded = isModelLoaded(loadedModels, selectedModel?.model || "");
  const memLevel = sysMem ? getMemoryLevel(sysMem.usedPercent) : "ok";
  const totalModelBytes = loadedModels?.reduce((sum, m) => sum + (m.size || 0), 0) ?? 0;

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [ejecting, setEjecting] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [ramWarning, setRamWarning] = useState<{ model: string; availGB: number } | null>(null);

  const handleModelSelect = useCallback((model: Model) => {
    const prevModel = selectedModel?.model;
    setSettings({ SelectedModel: model.model });
    setDropdownOpen(false);
    setSearchQuery("");

    if (model.model && model.model !== prevModel && model.digest !== undefined) {
      const warmup = async () => {
        try {
          const res = await fetch("/api/v1/system-resources");
          if (res.ok) {
            const mem = await res.json();
            if (mem.availableGB < 2) {
              setRamWarning({ model: model.model, availGB: mem.availableGB });
              return;
            }
          }
        } catch {}
        if (prevModel) {
          try {
            await fetch("/api/generate", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ model: prevModel, keep_alive: 0 }),
            });
          } catch {}
        }
        const opts: Record<string, unknown> = { use_mmap: false };
        if (settings.ContextLength > 0) opts.num_ctx = settings.ContextLength;
        if (settings.NumThread > 0) opts.num_thread = settings.NumThread;
        if (settings.NumBatch > 0) opts.num_batch = settings.NumBatch;
        if (settings.UseMlock) opts.use_mlock = true;
        if (settings.KVCacheType) {
          opts.cache_type_k = settings.KVCacheType;
          opts.cache_type_v = settings.KVCacheType;
        }
        fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: model.model,
            prompt: "",
            keep_alive: "5m",
            options: opts,
          }),
        }).catch(() => {});
      };
      warmup();
    }
  }, [selectedModel, setSettings, settings]);

  const forceLoadModel = useCallback((modelName: string) => {
    setRamWarning(null);
    const prevModel = selectedModel?.model;
    if (prevModel && prevModel !== modelName) {
      fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: prevModel, keep_alive: 0 }),
      }).catch(() => {});
    }
    const opts: Record<string, unknown> = { use_mmap: false };
    if (settings.ContextLength > 0) opts.num_ctx = settings.ContextLength;
    if (settings.NumThread > 0) opts.num_thread = settings.NumThread;
    if (settings.NumBatch > 0) opts.num_batch = settings.NumBatch;
    if (settings.UseMlock) opts.use_mlock = true;
    if (settings.KVCacheType) {
      opts.cache_type_k = settings.KVCacheType;
      opts.cache_type_v = settings.KVCacheType;
    }
    fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: modelName, prompt: "", keep_alive: "5m", options: opts }),
    }).catch(() => {});
  }, [selectedModel, settings]);

  const handleEject = useCallback(async () => {
    if (!selectedModel?.model || ejecting) return;
    setEjecting(true);
    try {
      await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: selectedModel.model, keep_alive: 0 }),
      });
    } catch { /* best-effort */ }
    setTimeout(() => setEjecting(false), 1500);
  }, [selectedModel, ejecting]);

  const filteredModels = searchQuery
    ? models.filter(m => m.model.toLowerCase().includes(searchQuery.toLowerCase()))
    : models;

  return (
    <div className="model-bar">
      <div className="model-bar-inner">
        {/* Model selector */}
        <div className="model-bar-selector">
          <button
            className="model-bar-btn"
            onClick={() => setDropdownOpen(!dropdownOpen)}
            disabled={!isHealthy}
          >
            <span className="model-bar-dot" data-healthy={isHealthy} />
            <span className="model-bar-name">
              {selectedModel?.model
                ? getModelDisplayName(selectedModel.model)
                : loading ? "Chargement..." : "Aucun modèle"}
            </span>
            <CaretDown size={12} weight="bold" className="model-bar-caret" />
          </button>

          {/* Dropdown */}
          {dropdownOpen && (
            <>
              <div className="model-bar-backdrop" onClick={() => { setDropdownOpen(false); setSearchQuery(""); }} />
              <div className="model-bar-dropdown">
                <div className="model-bar-search">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Rechercher un modèle..."
                    autoFocus
                    autoCorrect="off"
                    className="model-bar-search-input"
                  />
                </div>
                <ModelList
                  models={filteredModels}
                  selectedModel={selectedModel}
                  onModelSelect={handleModelSelect}
                  airplaneMode={settings.airplaneMode}
                  isOpen={dropdownOpen}
                />
              </div>
            </>
          )}
        </div>

        {/* Status badges */}
        <div className="model-bar-badges">
          <span className={`model-bar-badge ${isGPU ? "model-bar-badge-gpu" : ""}`}>
            {isGPU ? `GPU · ${gpuName || ""}` : "CPU"}
          </span>
          {sysMem && (
            <span className={`model-bar-badge model-bar-badge-mem model-bar-mem-${memLevel}`} title={`RAM système : ${sysMem.usedGB.toFixed(1)} GB / ${sysMem.totalGB.toFixed(1)} GB`}>
              <span className="model-bar-mem-bar">
                <span className="model-bar-mem-fill" style={{ width: `${Math.min(sysMem.usedPercent, 100)}%` }} />
              </span>
              {sysMem.usedGB.toFixed(1)} / {sysMem.totalGB.toFixed(0)} GB
            </span>
          )}
          {currentModelLoaded && (
            <span className="model-bar-badge model-bar-badge-loaded" title={totalModelBytes > 0 ? `Modèles : ${formatBytes(totalModelBytes)}` : undefined}>
              <span className="model-bar-loaded-dot" />
              {totalModelBytes > 0 ? formatBytes(totalModelBytes) : "En RAM"}
            </span>
          )}
          {loadedModels && loadedModels.length > 1 && (
            <span className="model-bar-badge model-bar-badge-ram" title={loadedModels.map(m => `${m.name || m.model} (${formatBytes(m.size || 0)})`).join(", ")}>
              {loadedModels.length} modèles
            </span>
          )}
          {isStreaming && (
            <span className="model-bar-badge model-bar-badge-streaming">
              <CircleNotch size={12} className="animate-spin" />
              Génération...
            </span>
          )}
          {settings.airplaneMode && (
            <span className="model-bar-badge model-bar-badge-airplane">
              <svg className="inline h-3 w-3" viewBox="0 0 24 24" fill="currentColor">
                <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/>
              </svg>
            </span>
          )}
        </div>

        {/* Eject button */}
        {selectedModel?.model && selectedModel.digest !== undefined && (
          <button
            className="model-bar-eject"
            onClick={handleEject}
            disabled={ejecting || isStreaming}
            title="Décharger le modèle de la RAM"
          >
            {ejecting ? (
              <CircleNotch size={16} className="animate-spin" />
            ) : (
              <Eject size={16} />
            )}
          </button>
        )}
      </div>

      {ramWarning && (
        <div className="model-bar-guardrail">
          <span className="model-bar-guardrail-icon">⚠</span>
          <span className="model-bar-guardrail-text">
            RAM insuffisante ({ramWarning.availGB.toFixed(1)} GB dispo) pour charger <strong>{ramWarning.model}</strong>
          </span>
          <button className="model-bar-guardrail-btn" onClick={() => forceLoadModel(ramWarning.model)}>
            Charger quand même
          </button>
          <button className="model-bar-guardrail-close" onClick={() => setRamWarning(null)}>✕</button>
        </div>
      )}

      <style>{`
        .model-bar {
          display: flex;
          align-items: center;
          padding: 0 12px;
          height: 44px;
          user-select: none;
          -webkit-app-region: no-drag;
        }
        .model-bar-inner {
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
        }
        .model-bar-selector {
          position: relative;
          flex-shrink: 0;
        }
        .model-bar-btn {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 5px 12px;
          border-radius: 9999px;
          background: var(--model-bar-bg, hsl(0 0% 96%));
          border: 1px solid var(--model-bar-border, hsl(0 0% 90%));
          color: var(--model-bar-text, hsl(0 0% 15%));
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: background 150ms, border-color 150ms;
          line-height: 1.4;
        }
        .model-bar-btn:hover:not(:disabled) {
          background: var(--model-bar-bg-hover, hsl(0 0% 93%));
          border-color: var(--model-bar-border-hover, hsl(0 0% 80%));
        }
        .model-bar-btn:disabled {
          opacity: 0.5;
          cursor: default;
        }
        .model-bar-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: hsl(0 60% 50%);
          flex-shrink: 0;
        }
        .model-bar-dot[data-healthy="true"] {
          background: hsl(142 71% 45%);
          box-shadow: 0 0 6px hsl(142 71% 45% / 0.5);
        }
        .model-bar-name {
          max-width: 200px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .model-bar-caret {
          opacity: 0.5;
          flex-shrink: 0;
        }
        .model-bar-backdrop {
          position: fixed;
          inset: 0;
          z-index: 40;
        }
        .model-bar-dropdown {
          position: absolute;
          top: calc(100% + 6px);
          left: 0;
          z-index: 50;
          width: 280px;
          border-radius: 16px;
          overflow: hidden;
          background: var(--model-bar-dropdown-bg, white);
          border: 1px solid var(--model-bar-dropdown-border, hsl(0 0% 92%));
          box-shadow: 0 8px 30px hsl(0 0% 0% / 0.12);
          animation: modelBarDropIn 150ms ease-out;
        }
        @keyframes modelBarDropIn {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .model-bar-search {
          padding: 8px 12px;
          border-bottom: 1px solid var(--model-bar-dropdown-border, hsl(0 0% 92%));
        }
        .model-bar-search-input {
          width: 100%;
          background: transparent;
          border: none;
          outline: none;
          font-size: 13px;
          color: inherit;
        }
        .model-bar-search-input::placeholder {
          color: var(--model-bar-placeholder, hsl(0 0% 60%));
        }
        .model-bar-badges {
          display: flex;
          align-items: center;
          gap: 6px;
          flex: 1;
          min-width: 0;
        }
        .model-bar-badge {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 2px 8px;
          border-radius: 9999px;
          font-size: 11px;
          font-weight: 500;
          color: var(--model-bar-badge-text, hsl(0 0% 45%));
          background: var(--model-bar-badge-bg, hsl(0 0% 96%));
          white-space: nowrap;
        }
        .model-bar-badge-gpu {
          color: hsl(142 60% 35%);
          background: hsl(142 60% 95%);
        }
        .model-bar-badge-streaming {
          color: hsl(217 70% 50%);
          background: hsl(217 70% 95%);
        }
        .model-bar-badge-mem {
          gap: 6px;
          font-variant-numeric: tabular-nums;
        }
        .model-bar-mem-bar {
          width: 48px;
          height: 6px;
          border-radius: 3px;
          background: hsl(0 0% 88%);
          overflow: hidden;
          flex-shrink: 0;
        }
        .model-bar-mem-fill {
          display: block;
          height: 100%;
          border-radius: 3px;
          transition: width 1s ease, background 0.3s;
        }
        .model-bar-mem-ok .model-bar-mem-fill { background: hsl(142 60% 45%); }
        .model-bar-mem-ok { color: hsl(142 50% 35%); background: hsl(142 50% 95%); }
        .model-bar-mem-warning .model-bar-mem-fill { background: hsl(38 90% 50%); }
        .model-bar-mem-warning { color: hsl(38 70% 35%); background: hsl(38 80% 94%); }
        .model-bar-mem-critical .model-bar-mem-fill { background: hsl(0 70% 55%); }
        .model-bar-mem-critical { color: hsl(0 60% 40%); background: hsl(0 60% 95%); }
        .model-bar-badge-loaded {
          color: hsl(142 60% 35%);
          background: hsl(142 60% 95%);
          font-variant-numeric: tabular-nums;
        }
        .model-bar-loaded-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: hsl(142 71% 45%);
          animation: pulse-dot 2s ease-in-out infinite;
        }
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        .model-bar-badge-ram {
          color: hsl(270 50% 45%);
          background: hsl(270 50% 95%);
        }
        .model-bar-badge-airplane {
          color: hsl(35 80% 45%);
          background: hsl(35 80% 95%);
        }
        .model-bar-eject {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          border-radius: 9999px;
          border: none;
          background: transparent;
          color: var(--model-bar-eject-color, hsl(0 0% 50%));
          cursor: pointer;
          transition: background 150ms, color 150ms;
          flex-shrink: 0;
        }
        .model-bar-eject:hover:not(:disabled) {
          background: hsl(0 60% 95%);
          color: hsl(0 60% 50%);
        }
        .model-bar-eject:disabled {
          opacity: 0.3;
          cursor: default;
        }

        .model-bar-guardrail {
          position: absolute;
          top: 100%;
          left: 12px;
          right: 12px;
          z-index: 30;
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 12px;
          border-radius: 10px;
          background: hsl(0 70% 97%);
          border: 1px solid hsl(0 50% 85%);
          box-shadow: 0 4px 12px hsl(0 0% 0% / 0.08);
          font-size: 12px;
          color: hsl(0 50% 30%);
          animation: guardrailSlideIn 200ms ease-out;
        }
        @keyframes guardrailSlideIn {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .model-bar-guardrail-icon { font-size: 14px; flex-shrink: 0; }
        .model-bar-guardrail-text { flex: 1; line-height: 1.4; }
        .model-bar-guardrail-btn {
          flex-shrink: 0;
          padding: 4px 10px;
          border-radius: 6px;
          border: 1px solid hsl(0 40% 75%);
          background: transparent;
          color: hsl(0 50% 40%);
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
          transition: background 150ms;
        }
        .model-bar-guardrail-btn:hover { background: hsl(0 50% 92%); }
        .model-bar-guardrail-close {
          background: none;
          border: none;
          color: hsl(0 30% 60%);
          cursor: pointer;
          font-size: 14px;
          padding: 2px;
          line-height: 1;
        }

        /* Dark mode */
        @media (prefers-color-scheme: dark) {
          .model-bar-btn {
            --model-bar-bg: hsl(0 0% 18%);
            --model-bar-border: hsl(0 0% 25%);
            --model-bar-text: hsl(0 0% 90%);
            --model-bar-bg-hover: hsl(0 0% 22%);
            --model-bar-border-hover: hsl(0 0% 35%);
          }
          .model-bar-dropdown {
            --model-bar-dropdown-bg: hsl(0 0% 15%);
            --model-bar-dropdown-border: hsl(0 0% 22%);
          }
          .model-bar-search-input {
            --model-bar-placeholder: hsl(0 0% 45%);
          }
          .model-bar-badge {
            --model-bar-badge-text: hsl(0 0% 55%);
            --model-bar-badge-bg: hsl(0 0% 18%);
          }
          .model-bar-badge-gpu {
            color: hsl(142 60% 60%);
            background: hsl(142 60% 15%);
          }
          .model-bar-mem-bar { background: hsl(0 0% 25%); }
          .model-bar-mem-ok { color: hsl(142 50% 60%); background: hsl(142 50% 12%); }
          .model-bar-mem-warning { color: hsl(38 80% 65%); background: hsl(38 60% 12%); }
          .model-bar-mem-critical { color: hsl(0 60% 65%); background: hsl(0 50% 12%); }
          .model-bar-badge-loaded {
            color: hsl(142 60% 60%);
            background: hsl(142 60% 15%);
          }
          .model-bar-badge-ram {
            color: hsl(270 50% 65%);
            background: hsl(270 50% 15%);
          }
          .model-bar-badge-streaming {
            color: hsl(217 70% 65%);
            background: hsl(217 70% 15%);
          }
          .model-bar-badge-airplane {
            color: hsl(35 80% 60%);
            background: hsl(35 80% 15%);
          }
          .model-bar-eject {
            --model-bar-eject-color: hsl(0 0% 55%);
          }
          .model-bar-eject:hover:not(:disabled) {
            background: hsl(0 60% 15%);
            color: hsl(0 60% 65%);
          }
          .model-bar-guardrail {
            background: hsl(0 40% 15%);
            border-color: hsl(0 30% 25%);
            color: hsl(0 50% 75%);
            box-shadow: 0 4px 12px hsl(0 0% 0% / 0.3);
          }
          .model-bar-guardrail-btn {
            border-color: hsl(0 30% 35%);
            color: hsl(0 50% 70%);
          }
          .model-bar-guardrail-btn:hover { background: hsl(0 40% 20%); }
          .model-bar-guardrail-close { color: hsl(0 30% 50%); }
        }
        :root[data-theme="dark"] .model-bar-btn {
          --model-bar-bg: hsl(0 0% 18%);
          --model-bar-border: hsl(0 0% 25%);
          --model-bar-text: hsl(0 0% 90%);
          --model-bar-bg-hover: hsl(0 0% 22%);
          --model-bar-border-hover: hsl(0 0% 35%);
        }
        :root[data-theme="dark"] .model-bar-dropdown {
          --model-bar-dropdown-bg: hsl(0 0% 15%);
          --model-bar-dropdown-border: hsl(0 0% 22%);
        }
        :root[data-theme="dark"] .model-bar-badge {
          --model-bar-badge-text: hsl(0 0% 55%);
          --model-bar-badge-bg: hsl(0 0% 18%);
        }
        :root[data-theme="dark"] .model-bar-eject {
          --model-bar-eject-color: hsl(0 0% 55%);
        }
      `}</style>
    </div>
  );
}

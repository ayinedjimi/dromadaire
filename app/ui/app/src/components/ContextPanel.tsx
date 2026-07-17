import { useState, useEffect, useCallback, useRef } from "react";
import { useSettings } from "@/hooks/useSettings";
import { useChat, useIsStreaming } from "@/hooks/useChats";
import { X, Sliders, ChatText, Info, FloppyDisk, CaretDown, CaretRight } from "@phosphor-icons/react";
import { SystemMonitor } from "./SystemMonitor";

interface ContextPanelProps {
  chatId?: string;
  selectedModel?: string;
  onClose: () => void;
}

type Tab = "context" | "model" | "info";

interface ModelParams {
  temperature: number;
  topP: number;
  numPredict: number;
  topK: number;
  minP: number;
  typicalP: number;
  repeatPenalty: number;
  repeatLastN: number;
  frequencyPenalty: number;
  presencePenalty: number;
  seed: number;
  flashAttn: boolean;
  cacheTypeK: string;
  cacheTypeV: string;
  stop: string[];
  numGPU: number;
  numCtx: number;
  numThread: number;
  numBatch: number;
  useMlock: boolean;
  ropeFrequencyBase: number;
  ropeFrequencyScale: number;
  logitBias: string;
}

const DEFAULT_PARAMS: ModelParams = {
  temperature: 0.7,
  topP: 0.9,
  numPredict: -1,
  topK: 40,
  minP: 0,
  typicalP: 1,
  repeatPenalty: 1.1,
  repeatLastN: 64,
  frequencyPenalty: 0,
  presencePenalty: 0,
  seed: -1,
  flashAttn: false,
  cacheTypeK: "",
  cacheTypeV: "",
  stop: [],
  numGPU: -1,
  numCtx: 0,
  numThread: 0,
  numBatch: 0,
  useMlock: false,
  ropeFrequencyBase: 0,
  ropeFrequencyScale: 0,
  logitBias: "",
};

function loadModelParams(): ModelParams {
  try {
    const saved = localStorage.getItem("dromadaire-model-params");
    if (saved) return { ...DEFAULT_PARAMS, ...JSON.parse(saved) };
  } catch {}
  return DEFAULT_PARAMS;
}

function saveModelParams(params: ModelParams) {
  try {
    localStorage.setItem("dromadaire-model-params", JSON.stringify(params));
  } catch {}
}

function presetKey(model: string): string {
  return `dromadaire-preset-${model.replace(/[:/]/g, "_")}`;
}

function loadPreset(model: string): ModelParams | null {
  try {
    const saved = localStorage.getItem(presetKey(model));
    if (saved) return { ...DEFAULT_PARAMS, ...JSON.parse(saved) };
  } catch {}
  return null;
}

function savePreset(model: string, params: ModelParams) {
  try {
    localStorage.setItem(presetKey(model), JSON.stringify(params));
  } catch {}
}

function deletePreset(model: string) {
  try {
    localStorage.removeItem(presetKey(model));
  } catch {}
}

function hasPreset(model: string): boolean {
  try {
    return localStorage.getItem(presetKey(model)) !== null;
  } catch {}
  return false;
}

export function useModelParams(selectedModel?: string) {
  const [params, setParams] = useState(loadModelParams);
  const [presetLoaded, setPresetLoaded] = useState(false);
  const prevModelRef = useRef(selectedModel);

  useEffect(() => {
    if (selectedModel && selectedModel !== prevModelRef.current) {
      prevModelRef.current = selectedModel;
      const preset = loadPreset(selectedModel);
      if (preset) {
        setParams(preset);
        saveModelParams(preset);
        setPresetLoaded(true);
        setTimeout(() => setPresetLoaded(false), 2000);
      }
    }
  }, [selectedModel]);

  const update = useCallback((patch: Partial<ModelParams>) => {
    setParams(prev => {
      const next = { ...prev, ...patch };
      saveModelParams(next);
      return next;
    });
  }, []);

  const saveCurrentAsPreset = useCallback(() => {
    if (selectedModel) {
      savePreset(selectedModel, params);
    }
  }, [selectedModel, params]);

  const deleteCurrentPreset = useCallback(() => {
    if (selectedModel) {
      deletePreset(selectedModel);
    }
  }, [selectedModel]);

  const currentModelHasPreset = selectedModel ? hasPreset(selectedModel) : false;

  return { params, updateParams: update, saveCurrentAsPreset, deleteCurrentPreset, currentModelHasPreset, presetLoaded, selectedModel };
}

export function ContextPanel({ chatId, selectedModel, onClose }: ContextPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>("context");
  const { settings, setSettings } = useSettings();
  const [systemPrompt, setSystemPrompt] = useState(settings.systemPrompt || "");
  const [promptDirty, setPromptDirty] = useState(false);
  const { params, updateParams, saveCurrentAsPreset, deleteCurrentPreset, currentModelHasPreset, presetLoaded } = useModelParams(selectedModel);

  const chatQuery = useChat(chatId && chatId !== "new" ? chatId : "");
  const isStreaming = useIsStreaming(chatId || "new");

  useEffect(() => {
    setSystemPrompt(settings.systemPrompt || "");
    setPromptDirty(false);
  }, [settings.systemPrompt]);

  const handleSavePrompt = useCallback(() => {
    setSettings({ SystemPrompt: systemPrompt });
    setPromptDirty(false);
  }, [systemPrompt, setSettings]);

  const messages = chatQuery?.data?.chat?.messages ?? [];
  const userMsgCount = messages.filter(m => m.role === "user").length;
  const assistantMsgCount = messages.filter(m => m.role === "assistant").length;
  const totalTokensEstimate = messages.reduce((acc, m) => acc + Math.ceil((m.content?.length || 0) / 4), 0);

  const tabs: { key: Tab; label: string; icon: typeof ChatText }[] = [
    { key: "context", label: "Contexte", icon: ChatText },
    { key: "model", label: "Modèle", icon: Sliders },
    { key: "info", label: "Info", icon: Info },
  ];

  return (
    <div className="ctx-panel">
      {/* Header */}
      <div className="ctx-panel-header">
        <div className="ctx-panel-tabs">
          {tabs.map(t => (
            <button
              key={t.key}
              className={`ctx-panel-tab ${activeTab === t.key ? "ctx-panel-tab-active" : ""}`}
              onClick={() => setActiveTab(t.key)}
            >
              <t.icon size={14} weight={activeTab === t.key ? "fill" : "regular"} />
              <span>{t.label}</span>
            </button>
          ))}
        </div>
        <button className="ctx-panel-close" onClick={onClose}>
          <X size={16} />
        </button>
      </div>

      {/* Content */}
      <div className="ctx-panel-body">
        {activeTab === "context" && (
          <div className="ctx-panel-section">
            <label className="ctx-panel-label">System Prompt</label>
            <textarea
              value={systemPrompt}
              onChange={e => { setSystemPrompt(e.target.value); setPromptDirty(true); }}
              placeholder="Ex: Tu es un assistant technique expert en Python..."
              className="ctx-panel-textarea"
              rows={8}
            />
            {promptDirty && (
              <button className="ctx-panel-save-btn" onClick={handleSavePrompt}>
                <FloppyDisk size={14} />
                Sauvegarder
              </button>
            )}
            <div className="ctx-panel-hint">
              Le system prompt est envoyé au début de chaque conversation.
            </div>

            {/* Quick presets */}
            <label className="ctx-panel-label" style={{ marginTop: 16 }}>Presets rapides</label>
            <div className="ctx-panel-presets">
              {PRESETS.map(p => (
                <button
                  key={p.name}
                  className="ctx-panel-preset"
                  onClick={() => { setSystemPrompt(p.prompt); setPromptDirty(true); }}
                  title={p.prompt}
                >
                  {p.name}
                </button>
              ))}
            </div>

            {/* LOT 37: RAG tuning sliders */}
            {settings.ragEnabled && (
              <>
                <label className="ctx-panel-label" style={{ marginTop: 16 }}>RAG — Recherche documentaire</label>
                <div className="ctx-panel-slider-group">
                  <label className="ctx-panel-sublabel">Seuil d'affinité ({settings.ragAffinityThreshold.toFixed(2)})</label>
                  <div className="ctx-panel-slider-row">
                    <input type="range" className="ctx-panel-slider" min={0} max={1} step={0.05}
                      value={settings.ragAffinityThreshold}
                      onChange={e => setSettings({ RAGAffinityThreshold: parseFloat(e.target.value) })} />
                    <span className="ctx-panel-slider-val">{settings.ragAffinityThreshold.toFixed(2)}</span>
                  </div>
                  <div className="ctx-panel-hint">
                    Score minimum de similarité (0 = tout garder, 1 = très strict).
                  </div>

                  <label className="ctx-panel-sublabel" style={{ marginTop: 8 }}>Chunks max ({settings.ragRetrievalLimit})</label>
                  <div className="ctx-panel-slider-row">
                    <input type="range" className="ctx-panel-slider" min={1} max={20} step={1}
                      value={settings.ragRetrievalLimit}
                      onChange={e => setSettings({ RAGRetrievalLimit: parseInt(e.target.value) })} />
                    <span className="ctx-panel-slider-val">{settings.ragRetrievalLimit}</span>
                  </div>
                  <div className="ctx-panel-hint">
                    Nombre maximum de chunks injectés dans le contexte.
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {activeTab === "model" && (
          <ModelTab params={params} updateParams={updateParams}
            selectedModel={selectedModel}
            onSavePreset={saveCurrentAsPreset} onDeletePreset={deleteCurrentPreset}
            hasPreset={currentModelHasPreset} presetLoaded={presetLoaded} />
        )}

        {activeTab === "info" && (
          <div className="ctx-panel-section">
            {chatId && chatId !== "new" ? (
              <>
                <div className="ctx-panel-stat-grid">
                  <StatCard label="Messages envoyés" value={userMsgCount} />
                  <StatCard label="Réponses" value={assistantMsgCount} />
                  <StatCard label="~Tokens totaux" value={totalTokensEstimate.toLocaleString()} />
                  <StatCard label="Modèle" value={messages.length > 0 ? (messages[messages.length - 1].model || "—") : "—"} />
                </div>
                <ContextUsageBar used={totalTokensEstimate} total={settings.contextLength} />
                {isStreaming && (
                  <div className="ctx-panel-streaming-badge">
                    Génération en cours...
                  </div>
                )}
              </>
            ) : (
              <div className="ctx-panel-empty">
                Sélectionnez ou créez une conversation pour voir les statistiques.
              </div>
            )}
            <SystemMonitor />
          </div>
        )}
      </div>

      <style>{`
        .ctx-panel {
          display: flex;
          flex-direction: column;
          height: 100%;
          border-left: 1px solid var(--ctx-border, hsl(0 0% 92%));
          background: var(--ctx-bg, hsl(0 0% 99%));
          width: 100%;
          overflow: hidden;
        }
        .ctx-panel-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 8px 0 8px;
          flex-shrink: 0;
        }
        .ctx-panel-tabs {
          display: flex;
          gap: 2px;
        }
        .ctx-panel-tab {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 5px 10px;
          border-radius: 8px;
          border: none;
          background: transparent;
          color: var(--ctx-tab-text, hsl(0 0% 50%));
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          transition: background 120ms, color 120ms;
        }
        .ctx-panel-tab:hover {
          background: var(--ctx-tab-hover, hsl(0 0% 95%));
        }
        .ctx-panel-tab-active {
          background: var(--ctx-tab-active-bg, hsl(0 0% 92%));
          color: var(--ctx-tab-active-text, hsl(0 0% 10%));
          font-weight: 600;
        }
        .ctx-panel-close {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 28px;
          height: 28px;
          border-radius: 8px;
          border: none;
          background: transparent;
          color: var(--ctx-tab-text, hsl(0 0% 50%));
          cursor: pointer;
        }
        .ctx-panel-close:hover {
          background: var(--ctx-tab-hover, hsl(0 0% 95%));
        }
        .ctx-panel-body {
          flex: 1;
          overflow-y: auto;
          padding: 12px;
        }
        .ctx-panel-section {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .ctx-panel-label {
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: var(--ctx-label, hsl(0 0% 45%));
        }
        .ctx-panel-textarea {
          width: 100%;
          padding: 8px 10px;
          border-radius: 10px;
          border: 1px solid var(--ctx-input-border, hsl(0 0% 88%));
          background: var(--ctx-input-bg, white);
          font-size: 13px;
          line-height: 1.5;
          resize: vertical;
          outline: none;
          color: inherit;
          font-family: inherit;
        }
        .ctx-panel-textarea:focus {
          border-color: hsl(217 70% 60%);
        }
        .ctx-panel-hint {
          font-size: 11px;
          color: var(--ctx-hint, hsl(0 0% 55%));
          line-height: 1.4;
        }
        .ctx-panel-save-btn {
          display: flex;
          align-items: center;
          gap: 4px;
          align-self: flex-start;
          padding: 5px 12px;
          border-radius: 8px;
          border: none;
          background: hsl(217 70% 55%);
          color: white;
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          transition: background 120ms;
        }
        .ctx-panel-save-btn:hover { background: hsl(217 70% 48%); }
        .ctx-panel-presets {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
        }
        .ctx-panel-preset {
          padding: 4px 10px;
          border-radius: 9999px;
          border: 1px solid var(--ctx-input-border, hsl(0 0% 88%));
          background: var(--ctx-input-bg, white);
          font-size: 11px;
          color: var(--ctx-tab-text, hsl(0 0% 50%));
          cursor: pointer;
          transition: background 120ms, color 120ms;
        }
        .ctx-panel-preset:hover {
          background: var(--ctx-tab-hover, hsl(0 0% 95%));
          color: var(--ctx-tab-active-text, hsl(0 0% 10%));
        }
        .ctx-panel-slider-row {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .ctx-panel-slider {
          flex: 1;
          accent-color: hsl(217 70% 55%);
        }
        .ctx-panel-slider-val {
          font-size: 12px;
          font-weight: 600;
          min-width: 42px;
          text-align: right;
          color: var(--ctx-tab-active-text, hsl(0 0% 10%));
          font-variant-numeric: tabular-nums;
        }
        .ctx-panel-reset-btn {
          margin-top: 8px;
          align-self: flex-start;
          padding: 4px 10px;
          border-radius: 8px;
          border: 1px solid var(--ctx-input-border, hsl(0 0% 88%));
          background: transparent;
          font-size: 11px;
          color: var(--ctx-tab-text, hsl(0 0% 50%));
          cursor: pointer;
        }
        .ctx-panel-reset-btn:hover {
          background: var(--ctx-tab-hover, hsl(0 0% 95%));
        }
        .ctx-panel-preset-actions {
          margin-top: 12px;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .ctx-panel-save-preset-btn {
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 5px 10px;
          border-radius: 8px;
          border: 1px solid hsl(210 70% 60%);
          background: hsl(210 70% 96%);
          font-size: 11px;
          font-weight: 500;
          color: hsl(210 70% 40%);
          cursor: pointer;
          align-self: flex-start;
          transition: background 120ms;
        }
        .ctx-panel-save-preset-btn:hover {
          background: hsl(210 70% 92%);
        }
        .ctx-panel-delete-preset-btn {
          align-self: flex-start;
          padding: 3px 8px;
          border-radius: 6px;
          border: none;
          background: transparent;
          font-size: 10px;
          color: hsl(0 60% 50%);
          cursor: pointer;
        }
        .ctx-panel-delete-preset-btn:hover {
          background: hsl(0 60% 96%);
        }
        .ctx-panel-preset-loaded {
          font-size: 11px;
          font-weight: 500;
          color: hsl(140 60% 40%);
          padding: 2px 0;
          animation: preset-fade 2s ease-out forwards;
        }
        @keyframes preset-fade {
          0%, 70% { opacity: 1; }
          100% { opacity: 0; }
        }
        .ctx-panel-advanced-toggle {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-top: 6px;
          padding: 6px 0;
          border: none;
          background: transparent;
          color: var(--ctx-label, hsl(0 0% 45%));
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          cursor: pointer;
        }
        .ctx-panel-advanced-toggle:hover {
          color: var(--ctx-tab-active-text, hsl(0 0% 10%));
        }
        .ctx-panel-modified-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: hsl(217 70% 55%);
          flex-shrink: 0;
        }
        .ctx-panel-toggle-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .ctx-panel-toggle-label {
          font-size: 12px;
          font-weight: 500;
          color: var(--ctx-tab-active-text, hsl(0 0% 10%));
        }
        .ctx-panel-toggle-btn {
          padding: 3px 10px;
          border-radius: 9999px;
          border: 1px solid var(--ctx-input-border, hsl(0 0% 88%));
          background: var(--ctx-input-bg, white);
          font-size: 11px;
          font-weight: 600;
          color: var(--ctx-tab-text, hsl(0 0% 50%));
          cursor: pointer;
          transition: all 120ms;
        }
        .ctx-panel-toggle-on {
          background: hsl(145 60% 45%);
          border-color: hsl(145 60% 45%);
          color: white;
        }
        .ctx-panel-select {
          width: 100%;
          padding: 5px 8px;
          border-radius: 8px;
          border: 1px solid var(--ctx-input-border, hsl(0 0% 88%));
          background: var(--ctx-input-bg, white);
          font-size: 12px;
          color: inherit;
          cursor: pointer;
          outline: none;
        }
        .ctx-panel-select:focus {
          border-color: hsl(217 70% 60%);
        }
        .ctx-panel-slider-group {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .ctx-panel-sublabel {
          font-size: 12px;
          font-weight: 500;
          color: var(--ctx-tab-active-text, hsl(0 0% 10%));
        }
        .ctx-panel-stop-tags {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
          margin-bottom: 4px;
        }
        .ctx-panel-stop-tag {
          display: inline-flex;
          align-items: center;
          gap: 2px;
          padding: 2px 6px;
          border-radius: 4px;
          background: hsl(217 70% 55%);
          color: white;
          font-size: 11px;
        }
        .ctx-panel-stop-tag button {
          background: none;
          border: none;
          color: white;
          cursor: pointer;
          font-size: 13px;
          padding: 0 2px;
          opacity: 0.7;
        }
        .ctx-panel-stop-tag button:hover {
          opacity: 1;
        }
        .ctx-panel-stop-input {
          width: 100%;
          padding: 5px 8px;
          border-radius: 8px;
          border: 1px solid var(--ctx-input-border, hsl(0 0% 88%));
          background: var(--ctx-input-bg, white);
          font-size: 12px;
          color: inherit;
          outline: none;
        }
        .ctx-panel-stop-input:focus {
          border-color: hsl(217 70% 60%);
        }
        .ctx-panel-advanced {
          display: flex;
          flex-direction: column;
          gap: 8px;
          padding: 8px 0 0 0;
          border-top: 1px solid var(--ctx-input-border, hsl(0 0% 88%));
          animation: ctx-slide-in 150ms ease-out;
        }
        @keyframes ctx-slide-in {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .ctx-panel-stat-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
        }
        .ctx-panel-stat {
          padding: 10px;
          border-radius: 10px;
          background: var(--ctx-stat-bg, hsl(0 0% 96%));
        }
        .ctx-panel-stat-label {
          font-size: 10px;
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: 0.3px;
          color: var(--ctx-hint, hsl(0 0% 55%));
          margin-bottom: 2px;
        }
        .ctx-panel-stat-value {
          font-size: 16px;
          font-weight: 700;
          color: var(--ctx-tab-active-text, hsl(0 0% 10%));
        }
        .ctx-panel-streaming-badge {
          margin-top: 8px;
          padding: 6px 12px;
          border-radius: 8px;
          background: hsl(217 70% 95%);
          color: hsl(217 70% 45%);
          font-size: 12px;
          font-weight: 500;
          text-align: center;
        }
        .ctx-panel-empty {
          padding: 24px 12px;
          text-align: center;
          font-size: 13px;
          color: var(--ctx-hint, hsl(0 0% 55%));
        }

        .ctx-usage-bar-container {
          margin-top: 8px;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .ctx-usage-bar-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .ctx-usage-bar-text {
          font-size: 11px;
          font-weight: 500;
          color: var(--ctx-tab-active-text, hsl(0 0% 10%));
          font-variant-numeric: tabular-nums;
        }
        .ctx-usage-bar-track {
          height: 6px;
          border-radius: 3px;
          background: var(--ctx-stat-bg, hsl(0 0% 90%));
          overflow: hidden;
        }
        .ctx-usage-bar-fill {
          height: 100%;
          border-radius: 3px;
          transition: width 300ms ease, background 300ms ease;
        }

        @media (prefers-color-scheme: dark) {
          .ctx-panel {
            --ctx-border: hsl(0 0% 18%);
            --ctx-bg: hsl(0 0% 10%);
          }
          .ctx-panel-tab {
            --ctx-tab-text: hsl(0 0% 50%);
            --ctx-tab-hover: hsl(0 0% 16%);
          }
          .ctx-panel-tab-active {
            --ctx-tab-active-bg: hsl(0 0% 20%);
            --ctx-tab-active-text: hsl(0 0% 92%);
          }
          .ctx-panel-textarea {
            --ctx-input-border: hsl(0 0% 22%);
            --ctx-input-bg: hsl(0 0% 14%);
          }
          .ctx-panel-stat {
            --ctx-stat-bg: hsl(0 0% 15%);
          }
          .ctx-panel-streaming-badge {
            background: hsl(217 70% 15%);
            color: hsl(217 70% 65%);
          }
          .ctx-panel-preset {
            --ctx-input-border: hsl(0 0% 25%);
            --ctx-input-bg: hsl(0 0% 15%);
          }
          .ctx-panel-reset-btn {
            --ctx-input-border: hsl(0 0% 25%);
          }
          .ctx-panel-save-preset-btn {
            border-color: hsl(210 50% 35%);
            background: hsl(210 50% 18%);
            color: hsl(210 60% 75%);
          }
          .ctx-panel-save-preset-btn:hover {
            background: hsl(210 50% 22%);
          }
          .ctx-panel-delete-preset-btn {
            color: hsl(0 50% 65%);
          }
          .ctx-panel-delete-preset-btn:hover {
            background: hsl(0 40% 18%);
          }
          .ctx-panel-preset-loaded {
            color: hsl(140 50% 60%);
          }
        }
        :root[data-theme="dark"] .ctx-panel {
          --ctx-border: hsl(0 0% 18%);
          --ctx-bg: hsl(0 0% 10%);
        }
        :root[data-theme="dark"] .ctx-panel-tab {
          --ctx-tab-text: hsl(0 0% 50%);
          --ctx-tab-hover: hsl(0 0% 16%);
        }
        :root[data-theme="dark"] .ctx-panel-tab-active {
          --ctx-tab-active-bg: hsl(0 0% 20%);
          --ctx-tab-active-text: hsl(0 0% 92%);
        }
        :root[data-theme="dark"] .ctx-panel-save-preset-btn {
          border-color: hsl(210 50% 35%);
          background: hsl(210 50% 18%);
          color: hsl(210 60% 75%);
        }
        :root[data-theme="dark"] .ctx-panel-delete-preset-btn {
          color: hsl(0 50% 65%);
        }
        :root[data-theme="dark"] .ctx-panel-preset-loaded {
          color: hsl(140 50% 60%);
        }
      `}</style>
    </div>
  );
}

function ParamSlider({ label, hint, value, min, max, step, format, onChange }: {
  label: string; hint: string; value: number;
  min: number; max: number; step: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}) {
  const display = format ? format(value) : step < 1 ? value.toFixed(2) : String(value);
  return (
    <>
      <label className="ctx-panel-label">{label}</label>
      <div className="ctx-panel-slider-row">
        <input type="range" min={min} max={max} step={step} value={value}
          onChange={e => onChange(step < 1 ? parseFloat(e.target.value) : parseInt(e.target.value))}
          className="ctx-panel-slider" />
        <span className="ctx-panel-slider-val">{display}</span>
      </div>
      <div className="ctx-panel-hint">{hint}</div>
    </>
  );
}

function ModelTab({ params, updateParams, selectedModel, onSavePreset, onDeletePreset, hasPreset: modelHasPreset, presetLoaded }: {
  params: ModelParams;
  updateParams: (p: Partial<ModelParams>) => void;
  selectedModel?: string;
  onSavePreset: () => void;
  onDeletePreset: () => void;
  hasPreset: boolean;
  presetLoaded: boolean;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [stopInput, setStopInput] = useState("");
  const isAdvancedModified = params.topK !== DEFAULT_PARAMS.topK
    || params.minP !== DEFAULT_PARAMS.minP
    || params.typicalP !== DEFAULT_PARAMS.typicalP
    || params.repeatPenalty !== DEFAULT_PARAMS.repeatPenalty
    || params.repeatLastN !== DEFAULT_PARAMS.repeatLastN
    || params.frequencyPenalty !== DEFAULT_PARAMS.frequencyPenalty
    || params.presencePenalty !== DEFAULT_PARAMS.presencePenalty
    || params.seed !== DEFAULT_PARAMS.seed
    || params.flashAttn !== DEFAULT_PARAMS.flashAttn
    || params.cacheTypeK !== DEFAULT_PARAMS.cacheTypeK
    || params.cacheTypeV !== DEFAULT_PARAMS.cacheTypeV
    || params.stop.length > 0
    || params.numGPU !== DEFAULT_PARAMS.numGPU
    || params.numCtx !== DEFAULT_PARAMS.numCtx
    || params.numThread !== DEFAULT_PARAMS.numThread
    || params.numBatch !== DEFAULT_PARAMS.numBatch
    || params.useMlock !== DEFAULT_PARAMS.useMlock
    || params.ropeFrequencyBase !== DEFAULT_PARAMS.ropeFrequencyBase
    || params.ropeFrequencyScale !== DEFAULT_PARAMS.ropeFrequencyScale
    || params.logitBias !== DEFAULT_PARAMS.logitBias;

  return (
    <div className="ctx-panel-section">
      <ParamSlider label="Température" value={params.temperature} min={0} max={2} step={0.05}
        hint="0 = déterministe, 0.7 = créatif, 2 = très aléatoire"
        onChange={v => updateParams({ temperature: v })} />

      <ParamSlider label="Top P" value={params.topP} min={0} max={1} step={0.05}
        hint="Filtre les tokens les moins probables. 0.9 = bon équilibre."
        onChange={v => updateParams({ topP: v })} />

      <ParamSlider label="Max Tokens" value={params.numPredict} min={-1} max={8192} step={128}
        hint="-1 = illimité. Limite la longueur de la réponse."
        format={v => v === -1 ? "Auto" : String(v)}
        onChange={v => updateParams({ numPredict: v })} />

      {/* Section Avancé — pattern LM Studio hiddenFromScope */}
      <button className="ctx-panel-advanced-toggle" onClick={() => setAdvancedOpen(!advancedOpen)}>
        {advancedOpen ? <CaretDown size={12} /> : <CaretRight size={12} />}
        <span>Avancé</span>
        {isAdvancedModified && <span className="ctx-panel-modified-dot" />}
      </button>

      {advancedOpen && (
        <div className="ctx-panel-advanced">
          <ParamSlider label="Top K" value={params.topK} min={0} max={100} step={1}
            hint="Limite aux K tokens les plus probables. 0 = désactivé, 40 = défaut Ollama."
            onChange={v => updateParams({ topK: v })} />

          <ParamSlider label="Min P" value={params.minP} min={0} max={1} step={0.01}
            hint="Seuil minimum de probabilité. Filtre les tokens en dessous. 0 = désactivé."
            format={v => v.toFixed(2)}
            onChange={v => updateParams({ minP: v })} />

          <ParamSlider label="Repeat Penalty" value={params.repeatPenalty} min={0} max={2} step={0.05}
            hint="Pénalise la répétition. 1.0 = désactivé, 1.1 = défaut."
            onChange={v => updateParams({ repeatPenalty: v })} />

          <ParamSlider label="Frequency Penalty" value={params.frequencyPenalty} min={0} max={2} step={0.05}
            hint="Pénalise les tokens proportionnellement à leur fréquence. 0 = désactivé."
            onChange={v => updateParams({ frequencyPenalty: v })} />

          <ParamSlider label="Presence Penalty" value={params.presencePenalty} min={0} max={2} step={0.05}
            hint="Pénalise les tokens déjà présents. Encourage la diversité. 0 = désactivé."
            onChange={v => updateParams({ presencePenalty: v })} />

          <ParamSlider label="Typical P" value={params.typicalP} min={0} max={1} step={0.05}
            hint="Locally typical sampling. 1.0 = désactivé. 0.2-0.9 = plus cohérent."
            format={v => v === 1 ? "OFF" : v.toFixed(2)}
            onChange={v => updateParams({ typicalP: v })} />

          <ParamSlider label="Repeat Last N" value={params.repeatLastN} min={0} max={256} step={8}
            hint="Fenêtre de contexte pour la pénalité de répétition. 0 = désactivé, 64 = défaut."
            format={v => v === 0 ? "OFF" : String(v)}
            onChange={v => updateParams({ repeatLastN: v })} />

          <ParamSlider label="Seed" value={params.seed} min={-1} max={99999} step={1}
            hint="-1 = aléatoire. Valeur fixe = résultats reproductibles."
            format={v => v === -1 ? "Aléatoire" : String(v)}
            onChange={v => updateParams({ seed: v })} />

          {/* Performance section */}
          <label className="ctx-panel-label" style={{ marginTop: 8 }}>Performance</label>

          <div className="ctx-panel-toggle-row">
            <label className="ctx-panel-toggle-label">Flash Attention</label>
            <button
              className={`ctx-panel-toggle-btn ${params.flashAttn ? "ctx-panel-toggle-on" : ""}`}
              onClick={() => updateParams({ flashAttn: !params.flashAttn })}
            >
              {params.flashAttn ? "ON" : "OFF"}
            </button>
          </div>
          <div className="ctx-panel-hint">Accélère l'attention. Réduit l'usage mémoire.</div>

          <label className="ctx-panel-label">KV Cache (clés)</label>
          <select
            className="ctx-panel-select"
            value={params.cacheTypeK}
            onChange={e => updateParams({ cacheTypeK: e.target.value })}
          >
            <option value="">FP16 (défaut)</option>
            <option value="q8_0">Q8_0 (~50% RAM)</option>
            <option value="q4_0">Q4_0 (~25% RAM)</option>
          </select>

          <label className="ctx-panel-label">KV Cache (valeurs)</label>
          <select
            className="ctx-panel-select"
            value={params.cacheTypeV}
            onChange={e => updateParams({ cacheTypeV: e.target.value })}
          >
            <option value="">FP16 (défaut)</option>
            <option value="q8_0">Q8_0 (~50% RAM)</option>
            <option value="q4_0">Q4_0 (~25% RAM)</option>
          </select>
          <div className="ctx-panel-hint">Quantifie le KV cache pour réduire la RAM. Q8_0 = bon compromis qualité/RAM.</div>

          <ParamSlider label="GPU Offload" value={params.numGPU} min={-1} max={100} step={1}
            hint="-1 = auto. 0 = CPU uniquement. N = N couches sur le GPU (Vulkan)."
            format={v => v === -1 ? "Auto" : v === 0 ? "CPU" : String(v)}
            onChange={v => updateParams({ numGPU: v })} />

          <ParamSlider label="Context Length" value={params.numCtx} min={0} max={8192} step={256}
            hint="0 = utiliser global. Taille du contexte (reload modèle). 2048 recommandé 16GB."
            format={v => v === 0 ? "Global" : String(v)}
            onChange={v => updateParams({ numCtx: v })} />

          <ParamSlider label="Threads" value={params.numThread} min={0} max={16} step={1}
            hint="0 = utiliser global. Nombre de threads CPU pour l'inférence."
            format={v => v === 0 ? "Global" : String(v)}
            onChange={v => updateParams({ numThread: v })} />

          <ParamSlider label="Batch Size" value={params.numBatch} min={0} max={1024} step={64}
            hint="0 = utiliser global. Taille du batch de prompt eval. 512 = défaut Ollama."
            format={v => v === 0 ? "Global" : String(v)}
            onChange={v => updateParams({ numBatch: v })} />

          <div className="ctx-panel-toggle-row">
            <label className="ctx-panel-toggle-label">MLock (verrouiller RAM)</label>
            <button
              className={`ctx-panel-toggle-btn ${params.useMlock ? "ctx-panel-toggle-on" : ""}`}
              onClick={() => updateParams({ useMlock: !params.useMlock })}
            >
              {params.useMlock ? "ON" : "OFF"}
            </button>
          </div>
          <div className="ctx-panel-hint">Empêche Windows de pager le modèle sur disque. Élimine les stalls sous pression RAM. Reload requis.</div>

          <ParamSlider label="RoPE Freq Base" value={params.ropeFrequencyBase} min={0} max={1000000} step={1000}
            hint="0 = auto (modèle décide). Étend le contexte. 10000 = standard, 500000 = long context."
            format={v => v === 0 ? "Auto" : v >= 1000 ? `${(v/1000).toFixed(0)}K` : String(v)}
            onChange={v => updateParams({ ropeFrequencyBase: v })} />

          <ParamSlider label="RoPE Freq Scale" value={params.ropeFrequencyScale} min={0} max={2} step={0.1}
            hint="0 = auto. 1.0 = pas de scaling. <1 = extension du contexte (ex: 0.5 = 2× contexte)."
            format={v => v === 0 ? "Auto" : v.toFixed(1)}
            onChange={v => updateParams({ ropeFrequencyScale: v })} />

          {/* Stop Strings */}
          <label className="ctx-panel-label" style={{ marginTop: 8 }}>Stop Strings</label>
          <div className="ctx-panel-stop-tags">
            {params.stop.map((s, i) => (
              <span key={i} className="ctx-panel-stop-tag">
                {s}
                <button onClick={() => updateParams({ stop: params.stop.filter((_, j) => j !== i) })}>&times;</button>
              </span>
            ))}
          </div>
          <input
            className="ctx-panel-stop-input"
            type="text"
            placeholder="Entrer et appuyer Entrée"
            value={stopInput}
            onChange={e => setStopInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && stopInput.trim()) {
                updateParams({ stop: [...params.stop, stopInput.trim()] });
                setStopInput("");
              }
            }}
          />
          <div className="ctx-panel-hint">Séquences qui arrêtent la génération.</div>

          {/* Logit Bias */}
          <label className="ctx-panel-label" style={{ marginTop: 8 }}>Logit Bias</label>
          <textarea
            className="ctx-panel-stop-input"
            style={{ minHeight: 48, resize: "vertical", fontFamily: "monospace", fontSize: 11 }}
            placeholder="token_id:bias, ...  ex: 128:0.5, 256:-1.0"
            value={params.logitBias}
            onChange={e => updateParams({ logitBias: e.target.value })}
            onKeyDown={e => e.stopPropagation()}
            rows={2}
          />
          <div className="ctx-panel-hint">
            Paires token_id:bias séparées par des virgules. Positif = favorise, négatif = pénalise.
          </div>
        </div>
      )}

      {selectedModel && (
        <div className="ctx-panel-preset-actions">
          {presetLoaded && (
            <div className="ctx-panel-preset-loaded">Preset chargé</div>
          )}
          <button className="ctx-panel-save-preset-btn" onClick={onSavePreset}>
            <FloppyDisk size={13} />
            {modelHasPreset ? "Mettre à jour le preset" : "Mémoriser pour ce modèle"}
          </button>
          {modelHasPreset && (
            <button className="ctx-panel-delete-preset-btn" onClick={onDeletePreset}>
              Oublier ce preset
            </button>
          )}
          <div className="ctx-panel-hint" style={{ marginTop: 2 }}>
            Les paramètres seront automatiquement chargés quand vous sélectionnerez ce modèle.
          </div>
        </div>
      )}

      <button className="ctx-panel-reset-btn" onClick={() => updateParams(DEFAULT_PARAMS)}>
        Réinitialiser tout
      </button>
    </div>
  );
}

function ContextUsageBar({ used, total }: { used: number; total: number }) {
  const safeTotal = total > 0 ? total : 4096;
  const percent = Math.min(Math.round((used / safeTotal) * 100), 100);
  const barColor = percent > 80 ? "hsl(0 70% 55%)" : percent > 50 ? "hsl(40 85% 50%)" : "hsl(140 60% 45%)";

  return (
    <div className="ctx-usage-bar-container">
      <div className="ctx-usage-bar-header">
        <span className="ctx-panel-sublabel">Contexte utilisé</span>
        <span className="ctx-usage-bar-text">~{used.toLocaleString()} / {safeTotal.toLocaleString()} tokens ({percent}%)</span>
      </div>
      <div className="ctx-usage-bar-track">
        <div className="ctx-usage-bar-fill" style={{ width: `${percent}%`, background: barColor }} />
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="ctx-panel-stat">
      <div className="ctx-panel-stat-label">{label}</div>
      <div className="ctx-panel-stat-value">{value}</div>
    </div>
  );
}

const PRESETS = [
  { name: "Assistant technique", prompt: "Tu es un assistant technique expert. Réponds de manière précise et structurée avec des exemples de code quand c'est pertinent." },
  { name: "Rédacteur", prompt: "Tu es un rédacteur professionnel. Écris de manière claire, élégante et concise. Adapte le ton au contexte demandé." },
  { name: "Tuteur", prompt: "Tu es un tuteur pédagogue. Explique les concepts étape par étape, avec des analogies simples. Pose des questions pour vérifier la compréhension." },
  { name: "Analyste", prompt: "Tu es un analyste rigoureux. Examine les données et arguments de manière critique. Identifie les forces, faiblesses et biais potentiels." },
  { name: "Créatif", prompt: "Tu es un assistant créatif. Propose des idées originales et inattendues. N'hésite pas à sortir des sentiers battus." },
];

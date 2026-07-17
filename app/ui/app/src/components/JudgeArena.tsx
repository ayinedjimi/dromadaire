import { useState, useCallback, useRef, useEffect } from "react";
import { X, Scales, Play, ArrowClockwise, Trophy, Lightning, Timer, CircleNotch } from "@phosphor-icons/react";
import { useModels } from "@/hooks/useModels";
import { useLoadedModels, isModelLoaded } from "@/hooks/useLoadedModels";
import { useModelParams } from "./ContextPanel";
import { API_BASE } from "@/lib/config";
import ReactMarkdown from "react-markdown";

interface JudgeArenaProps {
  onClose: () => void;
}

type Phase = "setup" | "running" | "results";
type RunStep = "idle" | "loading-a" | "generating-a" | "unloading-a" | "loading-b" | "generating-b" | "unloading-b" | "loading-judge" | "judging" | "done";

interface ArenaResult {
  responseA: string;
  responseB: string;
  verdict: string;
  winner: "A" | "B" | "tie" | "";
  tokPerSecA: number;
  tokPerSecB: number;
  timeA: number;
  timeB: number;
}

const JUDGE_SYSTEM_PROMPT = `Tu es un juge. Compare les réponses A et B au prompt donné.

Critères : pertinence, exactitude, clarté, complétude.

Format OBLIGATOIRE de ta réponse :
1. Une phrase sur la réponse A
2. Une phrase sur la réponse B
3. La ligne finale : GAGNANT: A ou GAGNANT: B ou GAGNANT: EGAL

Tu DOIS terminer par GAGNANT: suivi de A, B ou EGAL. Pas d'autre format.`;

export function JudgeArena({ onClose }: JudgeArenaProps) {
  const { data: models = [] } = useModels();
  const { data: loadedModels } = useLoadedModels();
  const { params: modelParams } = useModelParams();

  const [phase, setPhase] = useState<Phase>("setup");
  const [step, setStep] = useState<RunStep>("idle");
  const [prompt, setPrompt] = useState("");
  const [modelA, setModelA] = useState("");
  const [modelB, setModelB] = useState("");
  const [judgeModel, setJudgeModel] = useState("");
  const [result, setResult] = useState<ArenaResult | null>(null);
  const [error, setError] = useState("");
  const [streamA, setStreamA] = useState("");
  const [streamB, setStreamB] = useState("");
  const [streamJudge, setStreamJudge] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const modelSize = (name: string): number => {
    const m = name.match(/:(\d+(?:\.\d+)?)b/i) || name.match(/(\d+(?:\.\d+)?)b/i);
    return m ? parseFloat(m[1]) : 99;
  };

  const isCodeModel = (name: string): boolean => {
    const n = name.toLowerCase();
    return n.includes("starcoder") || n.includes("deepseek-coder") || n.includes("codellama") || n.includes("codegemma");
  };

  const chatModels = models.filter(m => {
    const name = m.model.toLowerCase();
    return !name.includes("embed") && !name.includes("arctic") && !name.includes("minilm") && !name.includes("nomic");
  }).sort((a, b) => modelSize(a.model) - modelSize(b.model));

  const judgeModels = chatModels.filter(m => !isCodeModel(m.model)).sort((a, b) => modelSize(b.model) - modelSize(a.model));

  useEffect(() => {
    if (!judgeModel && judgeModels.length > 0) {
      setJudgeModel(judgeModels[0].model);
    }
  }, [judgeModels.length]);

  const handleClose = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
    const modelsToUnload = [modelA, modelB, judgeModel].filter(Boolean);
    for (const m of modelsToUnload) {
      fetch(`${API_BASE}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: m, keep_alive: 0 }),
      }).catch(() => {});
    }
    onClose();
  }, [modelA, modelB, judgeModel, onClose]);

  useEffect(() => {
    return () => { if (abortRef.current) abortRef.current.abort(); };
  }, []);

  const runArena = useCallback(async () => {
    if (!prompt.trim() || !modelA || !modelB || !judgeModel) return;

    setPhase("running");
    setError("");
    setStreamA("");
    setStreamB("");
    setStreamJudge("");
    setResult(null);

    const controller = new AbortController();
    abortRef.current = controller;

    const options: Record<string, unknown> = {
      use_mmap: false,
      num_ctx: modelParams.numCtx > 0 ? modelParams.numCtx : 2048,
      num_predict: 512,
      temperature: modelParams.temperature,
      top_p: modelParams.topP,
    };
    if (modelParams.typicalP < 1) options.typical_p = modelParams.typicalP;
    if (modelParams.repeatLastN > 0) options.repeat_last_n = modelParams.repeatLastN;
    if (modelParams.cacheTypeK) options.cache_type_k = modelParams.cacheTypeK;
    if (modelParams.cacheTypeV) options.cache_type_v = modelParams.cacheTypeV;
    if (modelParams.numThread > 0) options.num_thread = modelParams.numThread;
    if (modelParams.numBatch > 0) options.num_batch = modelParams.numBatch;

    async function streamGenerate(
      model: string,
      promptText: string,
      opts: Record<string, unknown>,
      signal: AbortSignal,
      onChunk: (text: string) => void,
      system?: string,
    ): Promise<{ fullText: string; tokPerSec: number }> {
      const resp = await fetch(`${API_BASE}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, prompt: promptText, stream: true, think: false, options: opts, ...(system ? { system } : {}) }),
        signal,
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let full = "";
      let tokPerSec = 0;
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const j = JSON.parse(line);
            if (j.response) { full += j.response; onChunk(full); }
            if (j.done && j.eval_count && j.eval_duration) {
              tokPerSec = Math.round((j.eval_count / (j.eval_duration / 1e9)) * 100) / 100;
            }
          } catch {}
        }
      }
      return { fullText: full, tokPerSec };
    }

    async function unloadAndWait(model: string, signal: AbortSignal) {
      try {
        await fetch(`${API_BASE}/api/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model, keep_alive: 0 }),
        });
      } catch {}
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        if (signal.aborted) return;
        try {
          const resp = await fetch(`${API_BASE}/api/ps`);
          if (!resp.ok) break;
          const ct = resp.headers.get("content-type") || "";
          if (!ct.includes("json")) break;
          const data = await resp.json();
          const still = data.models?.some((m: { name: string; model: string }) => m.name === model || m.model === model);
          if (!still) return;
        } catch { break; }
        await new Promise(r => setTimeout(r, 500));
      }
      await new Promise(r => setTimeout(r, 2000));
    }

    try {
      setStep("generating-a");
      const startA = performance.now();
      const resultA = await streamGenerate(modelA, prompt, options, controller.signal, t => setStreamA(t));
      const timeA = Math.round((performance.now() - startA) / 1000 * 10) / 10;

      setStep("unloading-a");
      await unloadAndWait(modelA, controller.signal);

      setStep("generating-b");
      const startB = performance.now();
      const resultB = await streamGenerate(modelB, prompt, options, controller.signal, t => setStreamB(t));
      const timeB = Math.round((performance.now() - startB) / 1000 * 10) / 10;

      setStep("unloading-b");
      await unloadAndWait(modelB, controller.signal);

      setStep("judging");
      const judgePrompt = `PROMPT UTILISATEUR:\n${prompt}\n\nRÉPONSE A (${modelA}):\n${resultA.fullText}\n\nRÉPONSE B (${modelB}):\n${resultB.fullText}\n\nÉvalue les deux réponses et donne ton verdict.`;
      const judgeOpts = { use_mmap: false, num_ctx: 2048, num_predict: 512, temperature: 0.3 };
      const judgeResult = await streamGenerate(judgeModel, judgePrompt, judgeOpts, controller.signal, t => setStreamJudge(t), JUDGE_SYSTEM_PROMPT);

      let winner: "A" | "B" | "tie" | "" = "";
      const winnerMatch = judgeResult.fullText.match(/GAGNANT\s*:\s*(A|B|EGAL)/i);
      if (winnerMatch) {
        const w = winnerMatch[1].toUpperCase();
        winner = w === "A" ? "A" : w === "B" ? "B" : "tie";
      }

      try { await fetch(`${API_BASE}/api/generate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: judgeModel, keep_alive: 0 }) }); } catch {}

      setResult({
        responseA: resultA.fullText,
        responseB: resultB.fullText,
        verdict: judgeResult.fullText,
        winner,
        tokPerSecA: resultA.tokPerSec,
        tokPerSecB: resultB.tokPerSec,
        timeA,
        timeB,
      });
      setStep("done");
      setPhase("results");
    } catch (err: unknown) {
      if (err instanceof Error && err.message === "Annulé") {
        setError("Évaluation annulée.");
      } else {
        setError(String(err));
      }
      setPhase("setup");
      setStep("idle");
    }
  }, [prompt, modelA, modelB, judgeModel, modelParams]);

  const handleCancel = useCallback(() => { abortRef.current?.abort(); }, []);

  const handleReset = useCallback(() => {
    setPhase("setup");
    setStep("idle");
    setResult(null);
    setStreamA("");
    setStreamB("");
    setStreamJudge("");
    setError("");
  }, []);

  const stepLabels: Record<RunStep, string> = {
    "idle": "",
    "loading-a": `Chargement ${modelA}…`,
    "generating-a": `${modelA} génère…`,
    "unloading-a": `Libération mémoire…`,
    "loading-b": `Chargement ${modelB}…`,
    "generating-b": `${modelB} génère…`,
    "unloading-b": `Libération mémoire…`,
    "loading-judge": `Chargement juge…`,
    "judging": `Le juge délibère…`,
    "done": "Terminé",
  };

  const stepProgress: Record<RunStep, number> = {
    "idle": 0, "loading-a": 10, "generating-a": 25, "unloading-a": 35,
    "loading-b": 40, "generating-b": 55, "unloading-b": 65,
    "loading-judge": 70, "judging": 85, "done": 100,
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={handleClose}
    >
      <div
        className="relative flex flex-col w-[min(960px,95vw)] max-h-[90vh] rounded-2xl border border-neutral-200 dark:border-neutral-700/60 bg-white dark:bg-neutral-900 shadow-2xl shadow-black/20 dark:shadow-black/50 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-neutral-100 dark:border-neutral-800 bg-neutral-50/80 dark:bg-neutral-800/40">
          <div className="flex items-center gap-2.5">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-indigo-500/10 dark:bg-indigo-400/10">
              <Scales size={18} weight="bold" className="text-indigo-600 dark:text-indigo-400" />
            </div>
            <div>
              <h2 className="text-[15px] font-semibold text-neutral-800 dark:text-neutral-100">Arena</h2>
              <p className="text-[11px] text-neutral-400 dark:text-neutral-500">LLM-as-Judge · Comparaison séquentielle</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-700/60 text-neutral-400 dark:text-neutral-500 transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {/* Setup phase */}
          {phase === "setup" && (
            <div className="p-5 flex flex-col gap-4">
              {/* Model selectors */}
              <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-3 sm:gap-4">
                <ModelSelect label="Modèle A" value={modelA} models={chatModels.map(m => m.model)} onChange={setModelA} loaded={isModelLoaded(loadedModels, modelA)} color="blue" />
                <span className="pb-2.5 text-lg font-black text-neutral-300 dark:text-neutral-600 select-none">VS</span>
                <ModelSelect label="Modèle B" value={modelB} models={chatModels.map(m => m.model)} onChange={setModelB} loaded={isModelLoaded(loadedModels, modelB)} color="amber" />
              </div>

              <ModelSelect label="Modèle Juge" value={judgeModel} models={judgeModels.map(m => m.model)} onChange={setJudgeModel} loaded={isModelLoaded(loadedModels, judgeModel)} color="violet" />

              <p className="text-[11px] text-neutral-400 dark:text-neutral-500 -mt-1">
                Le modèle le plus gros est auto-sélectionné comme juge. Les modèles de code sont exclus.
              </p>

              {loadedModels && loadedModels.length > 0 && (
                <div className="flex items-center gap-2 text-[11px] text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200/60 dark:border-emerald-800/40 px-3 py-2 rounded-lg">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  En RAM : {loadedModels.map(m => m.name || m.model).join(", ")}
                </div>
              )}

              {/* Prompt input */}
              <div className="relative">
                <textarea
                  value={prompt}
                  onChange={e => setPrompt(e.target.value)}
                  placeholder="Entrez le prompt à envoyer aux deux modèles…"
                  rows={4}
                  className="w-full px-4 py-3 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800/60 text-[14px] leading-relaxed text-neutral-800 dark:text-neutral-200 placeholder:text-neutral-400 dark:placeholder:text-neutral-600 resize-y outline-none focus:border-indigo-400 dark:focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10 transition-all"
                />
              </div>

              {error && (
                <div className="px-3 py-2 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200/60 dark:border-red-800/40 text-[13px] text-red-600 dark:text-red-400">
                  {error}
                </div>
              )}

              <button
                disabled={!prompt.trim() || !modelA || !modelB || !judgeModel}
                onClick={runArena}
                className="flex items-center justify-center gap-2 py-2.5 px-5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-[14px] font-medium transition-colors cursor-pointer shadow-sm shadow-indigo-600/20"
              >
                <Play size={15} weight="fill" />
                Lancer l'évaluation
              </button>
            </div>
          )}

          {/* Running phase */}
          {phase === "running" && (
            <div className="p-5 flex flex-col gap-4">
              {/* Progress */}
              <div className="flex flex-col gap-2">
                <div className="h-1.5 rounded-full bg-neutral-100 dark:bg-neutral-800 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all duration-500 ease-out"
                    style={{ width: `${stepProgress[step]}%` }}
                  />
                </div>
                <div className="flex items-center justify-center gap-2 text-[13px] font-medium text-neutral-500 dark:text-neutral-400">
                  <CircleNotch size={14} className="animate-spin" />
                  {stepLabels[step]}
                </div>
              </div>

              {/* Side by side streaming */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <StreamBox
                  label="A"
                  model={modelA}
                  content={streamA}
                  active={step === "generating-a"}
                  pending={!streamA && step !== "generating-a"}
                  color="blue"
                />
                <StreamBox
                  label="B"
                  model={modelB}
                  content={streamB}
                  active={step === "generating-b"}
                  pending={!streamB && step !== "generating-b"}
                  color="amber"
                />
              </div>

              {/* Judge stream */}
              {(step === "judging" || streamJudge) && (
                <div className="border border-violet-200 dark:border-violet-800/40 rounded-xl overflow-hidden">
                  <div className="flex items-center gap-2 px-3 py-2 text-[12px] font-semibold bg-violet-50 dark:bg-violet-950/30 text-violet-700 dark:text-violet-300 border-b border-violet-200 dark:border-violet-800/40">
                    <Scales size={13} />
                    Juge : {judgeModel}
                  </div>
                  <div className="p-3 text-[13px] leading-relaxed text-neutral-700 dark:text-neutral-300 max-h-40 overflow-y-auto whitespace-pre-wrap">
                    {streamJudge || "…"}
                  </div>
                </div>
              )}

              <button
                onClick={handleCancel}
                className="self-center px-4 py-1.5 rounded-lg border border-neutral-200 dark:border-neutral-700 text-[13px] text-neutral-500 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
              >
                Annuler
              </button>
            </div>
          )}

          {/* Results phase */}
          {phase === "results" && result && (
            <div className="p-5 flex flex-col gap-4">
              {/* Winner banner */}
              <WinnerBanner winner={result.winner} modelA={modelA} modelB={modelB} />

              {/* Side by side responses */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <ResponseCard
                  label="A"
                  model={modelA}
                  content={result.responseA}
                  tokPerSec={result.tokPerSecA}
                  time={result.timeA}
                  isWinner={result.winner === "A"}
                  color="blue"
                />
                <ResponseCard
                  label="B"
                  model={modelB}
                  content={result.responseB}
                  tokPerSec={result.tokPerSecB}
                  time={result.timeB}
                  isWinner={result.winner === "B"}
                  color="amber"
                />
              </div>

              {/* Judge verdict */}
              <div className="border border-violet-200/80 dark:border-violet-700/40 rounded-xl overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2.5 text-[13px] font-semibold bg-violet-50/80 dark:bg-violet-950/30 text-violet-700 dark:text-violet-300 border-b border-violet-200/80 dark:border-violet-700/40">
                  <Scales size={14} />
                  Verdict — {judgeModel}
                </div>
                <div className="p-4 text-[13px] leading-relaxed text-neutral-700 dark:text-neutral-300 prose prose-sm dark:prose-invert max-w-none">
                  <ReactMarkdown>{result.verdict}</ReactMarkdown>
                </div>
              </div>

              <button
                onClick={handleReset}
                className="flex items-center justify-center gap-2 py-2.5 px-5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-[14px] font-medium transition-colors cursor-pointer shadow-sm shadow-indigo-600/20"
              >
                <ArrowClockwise size={15} />
                Nouvelle évaluation
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ModelSelect({ label, value, models, onChange, loaded, color }: {
  label: string;
  value: string;
  models: string[];
  onChange: (v: string) => void;
  loaded?: boolean;
  color: "blue" | "amber" | "violet";
}) {
  const borderColors = {
    blue: "border-blue-400 dark:border-blue-500",
    amber: "border-amber-400 dark:border-amber-500",
    violet: "border-violet-400 dark:border-violet-500",
  };

  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
        {label}
        {loaded && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" title="En RAM" />}
      </label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className={`px-3 py-2 rounded-lg border text-[13px] bg-white dark:bg-neutral-800 text-neutral-800 dark:text-neutral-200 outline-none cursor-pointer transition-colors ${
          loaded ? borderColors[color] : "border-neutral-200 dark:border-neutral-700"
        } focus:border-indigo-400 dark:focus:border-indigo-500`}
      >
        <option value="">Choisir…</option>
        {models.map(m => <option key={m} value={m}>{m}</option>)}
      </select>
    </div>
  );
}

function StreamBox({ label, model, content, active, pending, color }: {
  label: string;
  model: string;
  content: string;
  active: boolean;
  pending: boolean;
  color: "blue" | "amber";
}) {
  const badgeColors = {
    blue: "bg-blue-600 dark:bg-blue-500",
    amber: "bg-amber-600 dark:bg-amber-500",
  };
  const borderActive = {
    blue: "border-blue-300 dark:border-blue-700",
    amber: "border-amber-300 dark:border-amber-700",
  };

  return (
    <div className={`rounded-xl border overflow-hidden transition-all ${
      active ? borderActive[color] : "border-neutral-200 dark:border-neutral-700/60"
    } ${pending ? "opacity-50" : ""}`}>
      <div className="flex items-center gap-2 px-3 py-2 bg-neutral-50 dark:bg-neutral-800/60 border-b border-neutral-100 dark:border-neutral-700/60">
        <span className={`flex items-center justify-center w-5 h-5 rounded-md text-[10px] font-bold text-white ${badgeColors[color]}`}>
          {label}
        </span>
        <span className="text-[12px] font-medium text-neutral-600 dark:text-neutral-300 truncate">{model}</span>
        {active && <CircleNotch size={12} className="ml-auto text-neutral-400 animate-spin" />}
      </div>
      <div className="p-3 text-[13px] leading-relaxed text-neutral-700 dark:text-neutral-300 max-h-52 overflow-y-auto whitespace-pre-wrap min-h-[60px]">
        {content || (active ? "…" : "En attente…")}
      </div>
    </div>
  );
}

function ResponseCard({ label, model, content, tokPerSec, time, isWinner, color }: {
  label: string;
  model: string;
  content: string;
  tokPerSec: number;
  time: number;
  isWinner: boolean;
  color: "blue" | "amber";
}) {
  const badgeColors = {
    blue: "bg-blue-600 dark:bg-blue-500",
    amber: "bg-amber-600 dark:bg-amber-500",
  };
  const winnerBorder = "ring-2 ring-emerald-400 dark:ring-emerald-500 border-emerald-300 dark:border-emerald-600";

  return (
    <div className={`rounded-xl border border-neutral-200 dark:border-neutral-700/60 overflow-hidden transition-all ${isWinner ? winnerBorder : ""}`}>
      <div className="flex items-center gap-2 px-3 py-2.5 bg-neutral-50 dark:bg-neutral-800/60 border-b border-neutral-100 dark:border-neutral-700/60">
        <span className={`flex items-center justify-center w-5 h-5 rounded-md text-[10px] font-bold text-white ${badgeColors[color]}`}>
          {label}
        </span>
        <span className="text-[13px] font-medium text-neutral-700 dark:text-neutral-200 truncate">{model}</span>
        {isWinner && <Trophy size={14} weight="fill" className="text-emerald-500 ml-1" />}
        <div className="ml-auto flex items-center gap-2.5 text-[11px] text-neutral-400 dark:text-neutral-500 tabular-nums">
          <span className="flex items-center gap-1"><Lightning size={11} weight="fill" />{tokPerSec} tok/s</span>
          <span className="flex items-center gap-1"><Timer size={11} />{time}s</span>
        </div>
      </div>
      <div className="p-4 text-[13.5px] leading-relaxed text-neutral-800 dark:text-neutral-200 max-h-80 overflow-y-auto prose prose-sm dark:prose-invert prose-p:my-1.5 prose-headings:mt-3 prose-headings:mb-1.5 max-w-none">
        <ReactMarkdown>{content}</ReactMarkdown>
      </div>
    </div>
  );
}

function WinnerBanner({ winner, modelA, modelB }: { winner: "A" | "B" | "tie" | ""; modelA: string; modelB: string }) {
  if (winner === "A" || winner === "B") {
    const winnerModel = winner === "A" ? modelA : modelB;
    return (
      <div className="flex items-center justify-center gap-2.5 py-3 px-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200/60 dark:border-emerald-700/40">
        <Trophy size={20} weight="fill" className="text-emerald-600 dark:text-emerald-400" />
        <span className="text-[15px] font-semibold text-emerald-700 dark:text-emerald-300">
          Gagnant : <span className="font-bold">{winnerModel}</span>
          <span className="ml-2 text-[12px] font-normal text-emerald-500 dark:text-emerald-400/70">(Modèle {winner})</span>
        </span>
      </div>
    );
  }
  if (winner === "tie") {
    return (
      <div className="flex items-center justify-center gap-2.5 py-3 px-4 rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-700/40">
        <Scales size={20} weight="fill" className="text-amber-600 dark:text-amber-400" />
        <span className="text-[15px] font-semibold text-amber-700 dark:text-amber-300">Égalité</span>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-center gap-2.5 py-3 px-4 rounded-xl bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700">
      <span className="text-[14px] text-neutral-500">Verdict indéterminé</span>
    </div>
  );
}

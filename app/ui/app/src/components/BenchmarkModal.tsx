import { useState, useEffect, useRef, useCallback } from "react";
import { X, Cpu, Memory, Lightning, GraphicsCard, CircleNotch, Gauge } from "@phosphor-icons/react";
import { runBenchmark } from "@/api";

type Phase = "idle" | "cpu" | "memory" | "inference" | "gpu" | "done";

interface SubScore {
  score: number; // -1 = N/A, 1.0 - 9.9
  detail: string;
  durationMs: number;
}

function scoreColor(score: number): string {
  if (score < 0) return "text-neutral-400 dark:text-neutral-500";
  if (score < 3) return "text-red-500";
  if (score < 5) return "text-amber-500";
  if (score < 7) return "text-green-500";
  return "text-blue-500";
}

function scoreBarColor(score: number): string {
  if (score < 0) return "bg-neutral-200 dark:bg-neutral-700";
  if (score < 3) return "bg-red-500";
  if (score < 5) return "bg-amber-500";
  if (score < 7) return "bg-green-500";
  return "bg-blue-500";
}

function scoreBgColor(score: number): string {
  if (score < 0) return "bg-neutral-100 dark:bg-neutral-800";
  if (score < 3) return "bg-red-50 dark:bg-red-950";
  if (score < 5) return "bg-amber-50 dark:bg-amber-950";
  if (score < 7) return "bg-green-50 dark:bg-green-950";
  return "bg-blue-50 dark:bg-blue-950";
}

function scoreLabel(score: number): string {
  if (score < 0) return "N/A";
  return score.toFixed(1);
}

function ScoreRow({
  icon,
  label,
  result,
  isActive,
}: {
  icon: React.ReactNode;
  label: string;
  result: SubScore | null;
  isActive: boolean;
}) {
  return (
    <div className="flex items-center gap-3 py-3">
      <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-neutral-100 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400 flex-shrink-0">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-sm font-medium dark:text-white">{label}</span>
          <div className="flex items-center gap-2">
            {isActive && !result && (
              <CircleNotch className="w-4 h-4 animate-spin text-blue-500" />
            )}
            {result && (
              <span
                className={`text-lg font-bold tabular-nums ${scoreColor(result.score)}`}
              >
                {scoreLabel(result.score)}
              </span>
            )}
          </div>
        </div>
        {/* Progress bar */}
        <div className="h-2 rounded-full bg-neutral-100 dark:bg-neutral-800 overflow-hidden">
          {result && result.score >= 1 ? (
            <div
              className={`h-full rounded-full transition-all duration-700 ease-out ${scoreBarColor(result.score)}`}
              style={{ width: `${(result.score / 9.9) * 100}%` }}
            />
          ) : result && result.score < 0 ? (
            <div className="h-full rounded-full bg-neutral-300 dark:bg-neutral-600 w-full opacity-30" />
          ) : null}
        </div>
        {result && (
          <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-1">
            {result.detail}
          </p>
        )}
      </div>
    </div>
  );
}

export function BenchmarkModal({ onClose }: { onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState("");
  const [cpuResult, setCpuResult] = useState<SubScore | null>(null);
  const [memoryResult, setMemoryResult] = useState<SubScore | null>(null);
  const [inferResult, setInferResult] = useState<SubScore | null>(null);
  const [gpuResult, setGpuResult] = useState<SubScore | null>(null);
  const [overallScore, setOverallScore] = useState<number | null>(null);
  const [totalDuration, setTotalDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const startBenchmark = useCallback(async () => {
    setPhase("cpu");
    setError(null);
    setCpuResult(null);
    setMemoryResult(null);
    setInferResult(null);
    setGpuResult(null);
    setOverallScore(null);
    setTotalDuration(0);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      for await (const event of runBenchmark(controller.signal)) {
        switch (event.event) {
          case "progress":
            setPhase(event.phase as Phase);
            setMessage(event.message);
            break;
          case "result": {
            const sub: SubScore = {
              score: event.score,
              detail: event.detail,
              durationMs: event.duration_ms,
            };
            switch (event.phase) {
              case "cpu":
                setCpuResult(sub);
                break;
              case "memory":
                setMemoryResult(sub);
                break;
              case "inference":
                setInferResult(sub);
                break;
              case "gpu":
                setGpuResult(sub);
                break;
            }
            break;
          }
          case "complete":
            setOverallScore(event.overall_score);
            setTotalDuration(event.total_duration_ms);
            setPhase("done");
            break;
        }
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        setError(err.message);
        setPhase("done");
      }
    }
  }, []);

  // Auto-start on mount
  useEffect(() => {
    startBenchmark();
    return () => {
      abortRef.current?.abort();
    };
  }, [startBenchmark]);

  const isRunning = phase !== "idle" && phase !== "done";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-neutral-900 rounded-xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-200 dark:border-neutral-700">
          <div className="flex items-center gap-2">
            <Gauge className="w-5 h-5 text-blue-500" weight="fill" />
            <h2 className="text-lg font-semibold dark:text-white">
              Indice de performance
            </h2>
          </div>
          <button
            onClick={() => {
              abortRef.current?.abort();
              onClose();
            }}
            className="p-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 dark:text-white" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {/* Overall Score — big centered display */}
          {phase === "done" && overallScore !== null && (
            <div className="text-center py-5 mb-4">
              <div
                className={`inline-flex flex-col items-center justify-center w-32 h-32 rounded-2xl ${scoreBgColor(overallScore)}`}
              >
                <span
                  className={`text-5xl font-bold tabular-nums ${scoreColor(overallScore)}`}
                >
                  {scoreLabel(overallScore)}
                </span>
                <span className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
                  Score global
                </span>
              </div>
              <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-3">
                Base sur le composant le plus faible
              </p>
            </div>
          )}

          {/* Progress message when running */}
          {isRunning && (
            <div className="flex items-center justify-center gap-2 text-sm text-blue-500 mb-4 py-3">
              <CircleNotch className="w-5 h-5 animate-spin" />
              <span>{message}</span>
            </div>
          )}

          {/* Score rows */}
          <div className="space-y-1 divide-y divide-neutral-100 dark:divide-neutral-800">
            <ScoreRow
              icon={<Cpu className="w-5 h-5" weight="duotone" />}
              label="Processeur (CPU)"
              result={cpuResult}
              isActive={phase === "cpu"}
            />
            <ScoreRow
              icon={<Memory className="w-5 h-5" weight="duotone" />}
              label="Memoire (RAM)"
              result={memoryResult}
              isActive={phase === "memory"}
            />
            <ScoreRow
              icon={<Lightning className="w-5 h-5" weight="duotone" />}
              label="Inference IA"
              result={inferResult}
              isActive={phase === "inference"}
            />
            <ScoreRow
              icon={<GraphicsCard className="w-5 h-5" weight="duotone" />}
              label="Carte graphique"
              result={gpuResult}
              isActive={phase === "gpu"}
            />
          </div>

          {error && (
            <div className="text-red-500 text-sm py-3 mt-2">Erreur : {error}</div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-neutral-200 dark:border-neutral-700 flex items-center justify-between">
          <span className="text-xs text-neutral-400 dark:text-neutral-500">
            {phase === "done" && totalDuration > 0
              ? `Evalue en ${(totalDuration / 1000).toFixed(1)}s`
              : "Echelle 1.0 — 9.9"}
          </span>
          {phase === "done" && (
            <button
              onClick={startBenchmark}
              className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
            >
              Relancer
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

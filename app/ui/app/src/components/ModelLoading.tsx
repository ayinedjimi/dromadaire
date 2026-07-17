import { useEffect, useState, useRef } from "react";

const STORAGE_KEY_PREFIX = "dromadaire_load_ms_";

/** Read last known load duration (ms) for a model from localStorage */
export function getStoredLoadDuration(modelName: string): number | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY_PREFIX + modelName);
    return v ? Number(v) : null;
  } catch { return null; }
}

/** Store load duration (ms) for a model in localStorage */
export function storeLoadDuration(modelName: string, durationMs: number): void {
  try {
    localStorage.setItem(STORAGE_KEY_PREFIX + modelName, String(Math.round(durationMs)));
  } catch { /* quota exceeded — ignore */ }
}

interface ModelLoadingProps {
  modelName?: string;
}

export default function ModelLoading({ modelName }: ModelLoadingProps) {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(Date.now());
  const expectedMs = modelName ? getStoredLoadDuration(modelName) : null;

  useEffect(() => {
    startRef.current = Date.now();
    setElapsed(0);
    const interval = setInterval(() => {
      setElapsed(Date.now() - startRef.current);
    }, 100);
    return () => clearInterval(interval);
  }, []);

  const elapsedSec = (elapsed / 1000).toFixed(1);

  // Calibrated mode: real historical data → linear interpolation
  // Estimated mode: no history → asymptotic curve (fast start, slows down)
  const hasHistory = expectedMs !== null && expectedMs > 0;
  const progress = hasHistory
    ? Math.min(95, (elapsed / expectedMs) * 100)
    : Math.min(90, 90 * (1 - Math.exp(-elapsed / 8000)));

  return (
    <div className="my-4 rounded-xl max-w-xs">
      <div className="flex flex-col mb-2 text-[hsl(var(--text-100))]">
        <div className="flex items-center mb-0.5">
          <svg
            className="w-3.5 absolute fill-current animate-pulse"
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path d="M2 17h2v-7H2v7zm4 0h2V4H6v13zm4 0h2v-4h-2v4zm4 0h2V7h-2v10zm4 0h2v-6h-2v6z" />
          </svg>
          <div className="ml-6">Chargement du modèle en mémoire...</div>
        </div>
        <div className="text-sm text-[hsl(var(--text-300))] ml-6">
          {hasHistory
            ? `${Math.floor(progress)}% · ${elapsedSec}s`
            : `~${Math.floor(progress)}% · ${elapsedSec}s`
          }
        </div>
      </div>
      <div className="relative h-1.5 bg-[hsl(var(--bg-200))] rounded-full overflow-hidden ml-6">
        <div
          className="absolute left-0 top-0 h-full bg-[hsl(var(--accent-000))] rounded-full transition-all duration-200 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}

import { useSyncExternalStore } from "react";

interface RunStat {
  runs: number;
  lastRun: number;
}

interface UsageStats {
  agents: Record<string, RunStat>;
  workflows: Record<string, RunStat>;
}

const STORAGE_KEY = "dromadaire-usage-stats";
const listeners = new Set<() => void>();

let cache: UsageStats | null = null;

function read(): UsageStats {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    cache = raw ? (JSON.parse(raw) as UsageStats) : { agents: {}, workflows: {} };
  } catch {
    cache = { agents: {}, workflows: {} };
  }
  return cache;
}

function write(stats: UsageStats) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
  cache = stats;
  listeners.forEach((l) => l());
}

function record(kind: "agents" | "workflows", id: string) {
  const stats = read();
  const prev = stats[kind][id] ?? { runs: 0, lastRun: 0 };
  write({
    ...stats,
    [kind]: { ...stats[kind], [id]: { runs: prev.runs + 1, lastRun: Date.now() } },
  });
}

export function recordAgentRun(id: string) {
  record("agents", id);
}

export function recordWorkflowRun(id: string) {
  record("workflows", id);
}

function subscribe(callback: () => void) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

const EMPTY_STATS: UsageStats = { agents: {}, workflows: {} };

export function useUsageStats(): UsageStats {
  return useSyncExternalStore(subscribe, read, () => EMPTY_STATS);
}

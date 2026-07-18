import { useCallback, useSyncExternalStore } from "react";

export interface Agent {
  id: string;
  name: string;
  emoji: string;
  color: string;
  model: string;
  systemPrompt: string;
  webSearch: boolean;
  rag: boolean;
  ragDocumentIds: string[];
  taskExecution: boolean;
}

const STORAGE_KEY = "dromadaire-agents";

const listeners = new Set<() => void>();

// useSyncExternalStore requires getSnapshot to return a referentially stable
// value between calls unless the data actually changed — cache the parsed
// result so repeated renders don't create a new array every time (which
// would otherwise trigger an infinite re-render loop).
let cache: Agent[] | null = null;

function readAgents(): Agent[] {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    cache = raw ? (JSON.parse(raw) as Agent[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}

function writeAgents(agents: Agent[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(agents));
  cache = agents;
  listeners.forEach((l) => l());
}

function subscribe(callback: () => void) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export function useAgents() {
  const agents = useSyncExternalStore(subscribe, readAgents, () => []);

  const createAgent = useCallback((agent: Omit<Agent, "id">) => {
    const newAgent: Agent = { ...agent, id: crypto.randomUUID() };
    writeAgents([...readAgents(), newAgent]);
    return newAgent;
  }, []);

  const deleteAgent = useCallback((id: string) => {
    writeAgents(readAgents().filter((a) => a.id !== id));
  }, []);

  const updateAgent = useCallback((id: string, updates: Partial<Agent>) => {
    writeAgents(readAgents().map((a) => (a.id === id ? { ...a, ...updates } : a)));
  }, []);

  return { agents, createAgent, deleteAgent, updateAgent };
}

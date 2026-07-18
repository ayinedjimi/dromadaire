import { useCallback, useSyncExternalStore } from "react";

export interface WorkflowNodeData {
  id: string;
  kind?: "agent" | "condition"; // default "agent" when absent
  agentId: string; // unused when kind === "condition"
  // condition node: routes to the "true" or "false" outgoing edge depending
  // on whether matchText is found in the predecessor's output
  matchText?: string;
  // agent node: optional template composing the input from predecessors,
  // e.g. "Corrige ce texte : {{Redacteur.output}}". Empty = auto-concatenate.
  promptTemplate?: string;
  position: { x: number; y: number };
}

export interface WorkflowEdgeData {
  id: string;
  source: string;
  target: string;
  sourceHandle?: "true" | "false"; // set when the source is a condition node
}

export interface Workflow {
  id: string;
  name: string;
  nodes: WorkflowNodeData[];
  edges: WorkflowEdgeData[];
}

const STORAGE_KEY = "dromadaire-workflows";

const listeners = new Set<() => void>();

// See useAgents.ts for why this cache is required: useSyncExternalStore
// needs a referentially stable snapshot between calls or it re-renders forever.
let cache: Workflow[] | null = null;

function readWorkflows(): Workflow[] {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    cache = raw ? (JSON.parse(raw) as Workflow[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}

function writeWorkflows(workflows: Workflow[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(workflows));
  cache = workflows;
  listeners.forEach((l) => l());
}

function subscribe(callback: () => void) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export function useWorkflows() {
  const workflows = useSyncExternalStore(subscribe, readWorkflows, () => []);

  const createWorkflow = useCallback((name: string) => {
    const workflow: Workflow = { id: crypto.randomUUID(), name, nodes: [], edges: [] };
    writeWorkflows([...readWorkflows(), workflow]);
    return workflow;
  }, []);

  const deleteWorkflow = useCallback((id: string) => {
    writeWorkflows(readWorkflows().filter((w) => w.id !== id));
  }, []);

  const saveWorkflow = useCallback((id: string, nodes: WorkflowNodeData[], edges: WorkflowEdgeData[]) => {
    writeWorkflows(readWorkflows().map((w) => (w.id === id ? { ...w, nodes, edges } : w)));
  }, []);

  const renameWorkflow = useCallback((id: string, name: string) => {
    writeWorkflows(readWorkflows().map((w) => (w.id === id ? { ...w, name } : w)));
  }, []);

  return { workflows, createWorkflow, deleteWorkflow, saveWorkflow, renameWorkflow };
}

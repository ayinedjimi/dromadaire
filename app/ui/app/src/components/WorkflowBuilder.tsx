import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { motion, AnimatePresence } from "framer-motion";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  Handle,
  Position,
  type Node,
  type Edge,
  type Connection,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ArrowLeft, Play, Stop, FloppyDisk, GitBranch, ArrowCounterClockwise, ArrowClockwise, SquaresFour, ArrowsClockwise, Warning, Robot, Plus, CircleNotch } from "@phosphor-icons/react";
import { useWorkflows, type WorkflowNodeData, type WorkflowEdgeData } from "@/hooks/useWorkflows";
import { useAgents, type Agent } from "@/hooks/useAgents";
import { useSettings } from "@/hooks/useSettings";
import { runWorkflow, detectCycle, type NodeStatus } from "@/lib/workflowRunner";
import { recordWorkflowRun } from "@/hooks/useUsageStats";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface AgentNodeData extends Record<string, unknown> {
  agent?: Agent;
  status: NodeStatus;
  promptTemplate?: string;
}

interface ConditionNodeData extends Record<string, unknown> {
  matchText: string;
  status: NodeStatus;
}

const STATUS_COLOR: Record<NodeStatus, string> = {
  idle: "#a1a1aa", loading: "#f59e0b", running: "#3b82f6", done: "#22c55e", error: "#ef4444", skipped: "#d4d4d8",
};

function IndeterminateBar() {
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-amber-500/15">
      <div className="animate-indeterminate-bar h-full w-1/3 rounded-full bg-amber-500" />
    </div>
  );
}

function StatusDot({ status }: { status: NodeStatus }) {
  const pulsing = status === "running" || status === "loading";
  return (
    <span className="relative flex h-2 w-2 shrink-0">
      {pulsing && <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: STATUS_COLOR[status] }} />}
      <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: STATUS_COLOR[status] }} />
    </span>
  );
}

function AgentNode({ id, data }: NodeProps<Node<AgentNodeData>>) {
  const { agent, status, promptTemplate } = data;
  return (
    <div className="flex min-w-44 items-center gap-2.5 rounded-xl border-2 bg-white px-3 py-2.5 shadow-sm dark:bg-zinc-800" style={{ borderColor: agent?.color ?? "#a1a1aa" }}>
      <Handle type="target" position={Position.Left} />
      <StatusDot status={status} />
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-base" style={{ background: `${agent?.color ?? "#a1a1aa"}1f` }}>
        {agent?.emoji ?? "❓"}
      </div>
      <div className="min-w-0">
        <div className="truncate text-xs font-semibold text-zinc-900 dark:text-zinc-100">{agent?.name ?? "Agent supprimé"}</div>
        <div className="truncate font-mono text-[10px] text-zinc-500 dark:text-zinc-400">{agent?.model}</div>
        {status === "loading" && <div className="text-[9px] font-medium text-amber-600 dark:text-amber-400">⏳ chargement du modèle...</div>}
        {promptTemplate && status !== "loading" && <div className="text-[9px] text-zinc-400 dark:text-zinc-500">✎ template</div>}
      </div>
      <Handle type="source" position={Position.Right} id={id} />
    </div>
  );
}

function ConditionNode({ data }: NodeProps<Node<ConditionNodeData>>) {
  const { matchText, status } = data;
  return (
    <div className="relative flex min-h-20 min-w-44 items-center gap-2.5 rounded-xl border-2 border-orange-500 bg-white px-3 py-3 shadow-sm dark:bg-zinc-800">
      <Handle type="target" position={Position.Left} />
      <StatusDot status={status} />
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-orange-500/15 text-orange-600 dark:text-orange-400">
        <GitBranch size={16} />
      </div>
      <div className="min-w-0">
        <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">Condition</div>
        <div className="truncate font-mono text-[10px] text-zinc-500 dark:text-zinc-400">{matchText ? `contient "${matchText}"` : "(vide)"}</div>
      </div>
      <Handle type="source" position={Position.Right} id="true" style={{ top: "20%" }} className="!bg-green-500" />
      <Handle type="source" position={Position.Right} id="false" style={{ top: "80%" }} className="!bg-red-500" />
      <span className="absolute -right-9 top-[13%] text-[9px] font-medium text-green-600 dark:text-green-400">vrai</span>
      <span className="absolute -right-9 top-[73%] text-[9px] font-medium text-red-500">faux</span>
    </div>
  );
}

const nodeTypes = { agentNode: AgentNode, conditionNode: ConditionNode };

type FlowNode = Node<AgentNodeData | ConditionNodeData>;
type Snapshot = { nodes: FlowNode[]; edges: Edge[] };

function toWorkflowNodes(nodes: FlowNode[]): WorkflowNodeData[] {
  return nodes.map((n) => {
    if (n.type === "conditionNode") {
      const d = n.data as ConditionNodeData;
      return { id: n.id, kind: "condition", agentId: "", matchText: d.matchText, position: n.position };
    }
    const d = n.data as AgentNodeData;
    return { id: n.id, kind: "agent", agentId: d.agent?.id ?? "", promptTemplate: d.promptTemplate, position: n.position };
  });
}

function toWorkflowEdges(edges: Edge[]): WorkflowEdgeData[] {
  return edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    ...(e.sourceHandle === "true" || e.sourceHandle === "false" ? { sourceHandle: e.sourceHandle } : {}),
  }));
}

function ToolbarButton({ onClick, title, icon, danger }: { onClick: () => void; title: string; icon: React.ReactNode; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
        danger
          ? "text-amber-600 hover:bg-amber-500/10 dark:text-amber-400"
          : "text-zinc-500 hover:bg-zinc-950/5 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-zinc-100"
      }`}
    >
      {icon}
    </button>
  );
}

export default function WorkflowBuilder() {
  const { workflowId } = useParams({ from: "/workflows/$workflowId" });
  const { workflows, saveWorkflow } = useWorkflows();
  const { agents } = useAgents();
  const { setSettings } = useSettings();
  const navigate = useNavigate();

  const workflow = workflows.find((w) => w.id === workflowId);
  const agentsById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);

  const initialNodes: FlowNode[] = useMemo(
    () =>
      (workflow?.nodes ?? []).map((n) =>
        n.kind === "condition"
          ? { id: n.id, type: "conditionNode", position: n.position, data: { matchText: n.matchText ?? "", status: "idle" } }
          : { id: n.id, type: "agentNode", position: n.position, data: { agent: agentsById.get(n.agentId), status: "idle", promptTemplate: n.promptTemplate } },
      ),
    [workflow?.nodes, agentsById],
  );
  const initialEdges: Edge[] = useMemo(
    () => (workflow?.edges ?? []).map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle, animated: false })),
    [workflow?.edges],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [running, setRunning] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [showPalette, setShowPalette] = useState(false);
  const [transcript, setTranscript] = useState<Record<string, string>>({});
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const [hasError, setHasError] = useState(false);
  const [lastOutputs, setLastOutputs] = useState<Map<string, string> | null>(null);
  const activeNode = nodes.find((n) => n.id === activeNodeId);

  const history = useRef<Snapshot[]>([]);
  const future = useRef<Snapshot[]>([]);
  const runAbortRef = useRef<AbortController | null>(null);

  const pushHistory = useCallback(() => {
    history.current.push({ nodes, edges });
    if (history.current.length > 50) history.current.shift();
    future.current = [];
  }, [nodes, edges]);

  const undo = useCallback(() => {
    const prev = history.current.pop();
    if (!prev) return;
    future.current.push({ nodes, edges });
    setNodes(prev.nodes);
    setEdges(prev.edges);
  }, [nodes, edges, setNodes, setEdges]);

  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next) return;
    history.current.push({ nodes, edges });
    setNodes(next.nodes);
    setEdges(next.edges);
  }, [nodes, edges, setNodes, setEdges]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (e.key === "y" || (e.key === "z" && e.shiftKey)) { e.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo, redo]);

  const onConnect = useCallback(
    (connection: Connection) => { pushHistory(); setEdges((eds) => addEdge({ ...connection, animated: false }, eds)); },
    [setEdges, pushHistory],
  );

  const addAgentNode = useCallback((agent: Agent) => {
    pushHistory();
    const newNode: FlowNode = {
      id: crypto.randomUUID(),
      type: "agentNode",
      position: { x: 80 + Math.random() * 60, y: 80 + nodes.length * 110 },
      data: { agent, status: "idle" },
    };
    setNodes((nds) => [...nds, newNode]);
    setShowPalette(false);
  }, [nodes.length, setNodes, pushHistory]);

  const addConditionNode = useCallback(() => {
    pushHistory();
    const newNode: FlowNode = {
      id: crypto.randomUUID(),
      type: "conditionNode",
      position: { x: 80 + Math.random() * 60, y: 80 + nodes.length * 110 },
      data: { matchText: "", status: "idle" },
    };
    setNodes((nds) => [...nds, newNode]);
  }, [nodes.length, setNodes, pushHistory]);

  const deleteSelection = useCallback(() => {
    pushHistory();
    setNodes((nds) => nds.filter((n) => !n.selected));
    setEdges((eds) => eds.filter((e) => !e.selected));
  }, [setNodes, setEdges, pushHistory]);

  const autoLayout = useCallback(() => {
    const incoming = new Map<string, string[]>();
    nodes.forEach((n) => incoming.set(n.id, []));
    edges.forEach((e) => incoming.get(e.target)?.push(e.source));

    const depth = new Map<string, number>();
    const queue = nodes.filter((n) => (incoming.get(n.id)?.length ?? 0) === 0).map((n) => n.id);
    queue.forEach((id) => depth.set(id, 0));
    const outgoing = new Map<string, string[]>();
    nodes.forEach((n) => outgoing.set(n.id, []));
    edges.forEach((e) => outgoing.get(e.source)?.push(e.target));

    while (queue.length > 0) {
      const id = queue.shift()!;
      const d = depth.get(id) ?? 0;
      for (const next of outgoing.get(id) ?? []) {
        if (!depth.has(next) || (depth.get(next) ?? 0) < d + 1) {
          depth.set(next, d + 1);
          queue.push(next);
        }
      }
    }

    const perLayerCount = new Map<number, number>();
    pushHistory();
    setNodes((nds) =>
      nds.map((n) => {
        const d = depth.get(n.id) ?? 0;
        const idx = perLayerCount.get(d) ?? 0;
        perLayerCount.set(d, idx + 1);
        return { ...n, position: { x: 60 + d * 240, y: 60 + idx * 130 } };
      }),
    );
  }, [nodes, edges, setNodes, pushHistory]);

  const persist = useCallback(() => {
    if (!workflow) return;
    saveWorkflow(workflow.id, toWorkflowNodes(nodes), toWorkflowEdges(edges));
  }, [workflow, nodes, edges, saveWorkflow]);

  const setNodeStatus = useCallback((nodeId: string, status: NodeStatus, output?: string) => {
    setNodes((nds) => nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, status } } : n)));
    setActiveNodeId(status === "running" || status === "loading" ? nodeId : (prev) => (prev === nodeId ? null : prev));
    if (status === "error") {
      setHasError(true);
      // No streaming delta ever fires for a failed call — write the error
      // message directly so the transcript panel isn't left blank.
      setTranscript((t) => ({ ...t, [nodeId]: `⚠ ${output ?? "Échec de l'étape."}` }));
    }
  }, [setNodes]);

  const runFrom = useCallback(async (seedOutputs?: Map<string, string>, skipNodeIds?: Set<string>) => {
    if (!workflow || running) return;
    persist();

    const runnableWorkflow = { ...workflow, nodes: toWorkflowNodes(nodes), edges: toWorkflowEdges(edges) };
    if (detectCycle(runnableWorkflow)) {
      window.alert("Ce workflow contient une boucle (cycle) — impossible de le lancer. Vérifie les connexions entre les nœuds.");
      return;
    }

    setRunning(true);
    setHasError(false);
    setTranscript({});
    if (!skipNodeIds) {
      setNodes((nds) => nds.map((n) => ({ ...n, data: { ...n.data, status: "idle" } })));
    }

    const abortController = new AbortController();
    runAbortRef.current = abortController;

    try {
      const outputs = await runWorkflow(runnableWorkflow, agentsById, prompt, setSettings, {
        onNodeStatus: setNodeStatus,
        onNodeDelta: (nodeId, delta) => setTranscript((t) => ({ ...t, [nodeId]: (t[nodeId] ?? "") + delta })),
      }, { seedOutputs, skipNodeIds, signal: abortController.signal });
      setLastOutputs(outputs);
      recordWorkflowRun(workflow.id);
    } finally {
      runAbortRef.current = null;
      setRunning(false);
      setActiveNodeId(null);
    }
  }, [workflow, running, persist, nodes, edges, agentsById, prompt, setSettings, setNodeStatus]);

  const launch = useCallback(() => runFrom(), [runFrom]);
  const stopRun = useCallback(() => runAbortRef.current?.abort(), []);

  const retryFromErrors = useCallback(() => {
    if (!lastOutputs) return;
    const skip = new Set<string>();
    nodes.forEach((n) => {
      if ((n.data as { status: NodeStatus }).status === "done") skip.add(n.id);
    });
    runFrom(lastOutputs, skip);
  }, [lastOutputs, nodes, runFrom]);

  if (!workflow) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 text-zinc-500">
        <p>Workflow introuvable.</p>
        <Button outline onClick={() => navigate({ to: "/agents" })}><ArrowLeft size={14} /> Retour</Button>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-white dark:bg-zinc-900">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-zinc-950/8 px-4 py-2.5 dark:border-white/10">
        <button onClick={() => navigate({ to: "/agents" })} className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-950/5 dark:text-zinc-400 dark:hover:bg-white/10">
          <ArrowLeft size={16} />
        </button>
        <h1 className="mr-2 whitespace-nowrap text-sm font-bold text-zinc-950 dark:text-white">{workflow.name}</h1>
        <div className="min-w-40 flex-1">
          <Input value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Message initial du workflow..." />
        </div>

        <div className="flex items-center gap-0.5 rounded-lg bg-zinc-950/3 p-0.5 dark:bg-white/5">
          <ToolbarButton onClick={undo} title="Annuler (Ctrl+Z)" icon={<ArrowCounterClockwise size={15} />} />
          <ToolbarButton onClick={redo} title="Rétablir (Ctrl+Y)" icon={<ArrowClockwise size={15} />} />
          <ToolbarButton onClick={autoLayout} title="Ranger automatiquement" icon={<SquaresFour size={15} />} />
        </div>

        <Button outline onClick={() => setShowPalette((v) => !v)}><Plus size={14} /> Agent</Button>
        <Button outline onClick={addConditionNode}><GitBranch size={14} /> Condition</Button>
        <Button plain onClick={persist} title="Sauvegarder"><FloppyDisk size={14} /></Button>

        {hasError && !running && (
          <Button color="amber" onClick={retryFromErrors} title="Relancer uniquement les étapes échouées/non exécutées">
            <ArrowsClockwise size={14} /> Reprendre
          </Button>
        )}
        {running ? (
          <Button color="red" onClick={stopRun}>
            <Stop size={14} weight="fill" /> Stop
          </Button>
        ) : (
          <Button color="blue" onClick={launch} disabled={nodes.length === 0}>
            <Play size={14} weight="fill" /> Lancer
          </Button>
        )}
      </div>

      <AnimatePresence>
        {showPalette && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.12 }}
            className="absolute right-4 top-14 z-20 flex max-h-64 w-56 flex-col gap-0.5 overflow-y-auto rounded-xl border border-zinc-950/10 bg-white p-1.5 shadow-xl dark:border-white/10 dark:bg-zinc-800"
          >
            {agents.length === 0 && <div className="max-w-52 p-2 text-xs text-zinc-500 dark:text-zinc-400">Aucun agent créé. Crée d'abord des agents dans la galerie.</div>}
            {agents.map((a) => (
              <button
                key={a.id}
                onClick={() => addAgentNode(a)}
                className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-zinc-700 hover:bg-zinc-950/5 dark:text-zinc-200 dark:hover:bg-white/10"
              >
                <span>{a.emoji}</span> {a.name}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="relative flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeDragStop={pushHistory}
            onNodeClick={(_, n) => setActiveNodeId(n.id)}
            nodeTypes={nodeTypes}
            deleteKeyCode={["Backspace", "Delete"]}
            onNodesDelete={pushHistory}
            onEdgesDelete={pushHistory}
            fitView
          >
            <Background />
            <Controls />
            <MiniMap className="!bg-white dark:!bg-zinc-800" maskColor="rgb(0 0 0 / 0.08)" />
          </ReactFlow>

          {nodes.length === 0 && (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 text-zinc-400 dark:text-zinc-600">
              <Robot size={36} />
              <p className="text-sm">Ajoute un agent pour commencer</p>
            </div>
          )}
        </div>

        <AnimatePresence>
          {(running || Object.keys(transcript).length > 0) && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 320, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="flex flex-col overflow-hidden border-l border-zinc-950/8 dark:border-white/10"
            >
              <div className="flex items-center gap-1.5 border-b border-zinc-950/8 px-3 py-2.5 text-xs font-semibold text-zinc-500 dark:border-white/10 dark:text-zinc-400">
                {running && <CircleNotch size={12} className="animate-spin" />}
                Sortie {activeNodeId ? "en cours" : "du dernier nœud actif"}
              </div>
              <div className="flex-1 overflow-y-auto whitespace-pre-wrap p-3 text-xs leading-relaxed text-zinc-700 dark:text-zinc-300">
                {activeNodeId && transcript[activeNodeId]
                  ? transcript[activeNodeId]
                  : Object.values(transcript)[Object.values(transcript).length - 1] || (
                    running ? (
                      activeNode?.data.status === "loading" ? (
                        <div className="flex flex-col gap-2.5">
                          <span className="flex items-center gap-2 text-zinc-400 dark:text-zinc-500">
                            <CircleNotch size={14} className="animate-spin" />
                            ⏳ Chargement du modèle en mémoire... (peut prendre plusieurs minutes sur CPU la première fois)
                          </span>
                          <IndeterminateBar />
                        </div>
                      ) : (
                        <span className="flex items-center gap-2 text-zinc-400 dark:text-zinc-500">
                          <CircleNotch size={14} className="animate-spin" />
                          Le modèle réfléchit... (peut prendre plusieurs minutes sur CPU)
                        </span>
                      )
                    ) : "En attente de contenu..."
                  )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {hasError && (
        <div className="flex items-center gap-2 border-t border-red-500/20 bg-red-500/5 px-4 py-2 text-xs text-red-600 dark:text-red-400">
          <Warning size={14} /> Une ou plusieurs étapes ont échoué. Utilise "Reprendre" pour relancer uniquement celles-ci.
        </div>
      )}

      <button
        onClick={deleteSelection}
        title="Supprimer la sélection"
        className="absolute bottom-3 left-3 z-10 rounded-lg border border-zinc-950/10 bg-white px-2.5 py-1.5 text-xs text-zinc-500 opacity-70 hover:opacity-100 dark:border-white/10 dark:bg-zinc-800 dark:text-zinc-400"
      >
        Supprimer la sélection
      </button>
    </div>
  );
}

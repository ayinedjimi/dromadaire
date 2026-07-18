import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
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
import { ArrowLeft, Play, FloppyDisk, GitBranch, ArrowCounterClockwise, ArrowClockwise, SquaresFour, ArrowsClockwise, Warning } from "@phosphor-icons/react";
import { useWorkflows, type WorkflowNodeData, type WorkflowEdgeData } from "@/hooks/useWorkflows";
import { useAgents, type Agent } from "@/hooks/useAgents";
import { useSettings } from "@/hooks/useSettings";
import { runWorkflow, detectCycle, type NodeStatus } from "@/lib/workflowRunner";
import { recordWorkflowRun } from "@/hooks/useUsageStats";

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
  idle: "#94a3b8", running: "#3b82f6", done: "#22c55e", error: "#ef4444", skipped: "#c4c4c4",
};

function AgentNode({ id, data }: NodeProps<Node<AgentNodeData>>) {
  const { agent, status, promptTemplate } = data;
  return (
    <div className="workflow-node" style={{ borderColor: agent?.color ?? "#94a3b8" }}>
      <Handle type="target" position={Position.Left} />
      <div className="workflow-node-status" style={{ background: STATUS_COLOR[status] }} />
      <div className="workflow-node-emoji">{agent?.emoji ?? "❓"}</div>
      <div className="workflow-node-body">
        <div className="workflow-node-name">{agent?.name ?? "Agent supprimé"}</div>
        <div className="workflow-node-model">{agent?.model}</div>
        {promptTemplate && <div className="workflow-node-template" title={promptTemplate}>✎ template</div>}
      </div>
      <Handle type="source" position={Position.Right} id={id} />
    </div>
  );
}

function ConditionNode({ data }: NodeProps<Node<ConditionNodeData>>) {
  const { matchText, status } = data;
  return (
    <div className="workflow-node workflow-node-condition">
      <Handle type="target" position={Position.Left} />
      <div className="workflow-node-status" style={{ background: STATUS_COLOR[status] }} />
      <GitBranch size={16} />
      <div className="workflow-node-body">
        <div className="workflow-node-name">Condition</div>
        <div className="workflow-node-model">{matchText ? `contient "${matchText}"` : "(vide)"}</div>
      </div>
      <Handle type="source" position={Position.Right} id="true" style={{ top: "35%" }} />
      <Handle type="source" position={Position.Right} id="false" style={{ top: "65%" }} />
      <span className="workflow-node-handle-label workflow-node-handle-true">vrai</span>
      <span className="workflow-node-handle-label workflow-node-handle-false">faux</span>
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

  // T1: undo/redo history
  const history = useRef<Snapshot[]>([]);
  const future = useRef<Snapshot[]>([]);

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
    (connection: Connection) => {
      pushHistory();
      setEdges((eds) => addEdge({ ...connection, animated: false }, eds));
    },
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

  // W4: layer nodes by BFS depth from sources, position each layer as a column
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

  const setNodeStatus = useCallback((nodeId: string, status: NodeStatus) => {
    setNodes((nds) => nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, status } } : n)));
    setActiveNodeId(status === "running" ? nodeId : (prev) => (prev === nodeId ? null : prev));
    if (status === "error") setHasError(true);
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

    try {
      const outputs = await runWorkflow(runnableWorkflow, agentsById, prompt, setSettings, {
        onNodeStatus: setNodeStatus,
        onNodeDelta: (nodeId, delta) => setTranscript((t) => ({ ...t, [nodeId]: (t[nodeId] ?? "") + delta })),
      }, { seedOutputs, skipNodeIds });
      setLastOutputs(outputs);
      recordWorkflowRun(workflow.id);
    } finally {
      setRunning(false);
      setActiveNodeId(null);
    }
  }, [workflow, running, persist, nodes, edges, agentsById, prompt, setSettings, setNodeStatus]);

  const launch = useCallback(() => runFrom(), [runFrom]);

  // W5: resume — reuse outputs already captured for nodes that finished ok,
  // only re-run nodes that errored or never ran
  const retryFromErrors = useCallback(() => {
    if (!lastOutputs) return;
    const skip = new Set<string>();
    nodes.forEach((n) => {
      if ((n.data as { status: NodeStatus }).status === "done") skip.add(n.id);
    });
    runFrom(lastOutputs, skip);
  }, [lastOutputs, nodes, runFrom]);

  if (!workflow) {
    return <div className="workflow-missing">Workflow introuvable. <button onClick={() => navigate({ to: "/agents" })}>Retour</button></div>;
  }

  return (
    <div className="workflow-page">
      <div className="workflow-header">
        <button className="agents-back" onClick={() => navigate({ to: "/agents" })}><ArrowLeft size={16} /></button>
        <h1 className="workflow-title">{workflow.name}</h1>
        <input
          className="workflow-prompt-input"
          placeholder="Message initial du workflow..."
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <button className="agent-btn-secondary" onClick={undo} title="Annuler (Ctrl+Z)"><ArrowCounterClockwise size={14} /></button>
        <button className="agent-btn-secondary" onClick={redo} title="Rétablir (Ctrl+Y)"><ArrowClockwise size={14} /></button>
        <button className="agent-btn-secondary" onClick={autoLayout} title="Ranger automatiquement"><SquaresFour size={14} /></button>
        <button className="agent-btn-secondary" onClick={() => setShowPalette((v) => !v)}>+ Agent</button>
        <button className="agent-btn-secondary" onClick={addConditionNode} title="Ajouter une condition"><GitBranch size={14} /></button>
        <button className="agent-btn-secondary" onClick={persist}><FloppyDisk size={14} /> Sauver</button>
        {hasError && !running && (
          <button className="agent-btn-secondary workflow-retry-btn" onClick={retryFromErrors} title="Relancer uniquement les étapes échouées/non exécutées">
            <ArrowsClockwise size={14} /> Reprendre
          </button>
        )}
        <button className="agent-btn-primary" onClick={launch} disabled={running || nodes.length === 0}>
          <Play size={14} weight="fill" /> {running ? "En cours..." : "Lancer"}
        </button>
      </div>

      {showPalette && (
        <div className="workflow-palette">
          {agents.length === 0 && <div className="workflow-palette-empty">Aucun agent créé. Crée d'abord des agents dans la galerie.</div>}
          {agents.map((a) => (
            <button key={a.id} className="workflow-palette-item" onClick={() => addAgentNode(a)}>
              <span>{a.emoji}</span> {a.name}
            </button>
          ))}
        </div>
      )}

      <div className="workflow-body">
        <div className="workflow-canvas">
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
            <MiniMap />
          </ReactFlow>
        </div>

        {(running || Object.keys(transcript).length > 0) && (
          <div className="workflow-transcript">
            <div className="workflow-transcript-header">
              <span>Sortie {activeNodeId ? "en cours" : "du dernier nœud actif"}</span>
            </div>
            <div className="workflow-transcript-body">
              {activeNodeId && transcript[activeNodeId]
                ? transcript[activeNodeId]
                : Object.values(transcript)[Object.values(transcript).length - 1] || "En attente de contenu..."}
            </div>
          </div>
        )}
      </div>

      {hasError && (
        <div className="workflow-error-banner"><Warning size={14} /> Une ou plusieurs étapes ont échoué. Utilise "Reprendre" pour relancer uniquement celles-ci.</div>
      )}

      <button className="workflow-delete-hint agent-btn-secondary" onClick={deleteSelection} title="Supprimer la sélection">
        Supprimer la sélection
      </button>

      <style>{`
        .workflow-page { display: flex; flex-direction: column; height: 100vh; position: relative; }
        .workflow-header { display: flex; align-items: center; gap: 6px; padding: 12px 16px; border-bottom: 1px solid hsl(0 0% 88%); flex-wrap: wrap; }
        .workflow-title { font-size: 15px; font-weight: 700; margin-right: 8px; white-space: nowrap; }
        .workflow-prompt-input { flex: 1; min-width: 160px; padding: 7px 10px; border-radius: 8px; border: 1px solid hsl(0 0% 85%); font-size: 13px; background: hsl(0 0% 100%); color: inherit; }
        .workflow-body { flex: 1; min-height: 0; display: flex; }
        .workflow-canvas { flex: 1; min-height: 0; }
        .workflow-transcript { width: 320px; border-left: 1px solid hsl(0 0% 88%); display: flex; flex-direction: column; }
        .workflow-transcript-header { padding: 10px 12px; font-size: 12px; font-weight: 600; opacity: 0.7; border-bottom: 1px solid hsl(0 0% 92%); }
        .workflow-transcript-body { flex: 1; overflow-y: auto; padding: 12px; font-size: 12px; white-space: pre-wrap; line-height: 1.5; }
        .workflow-error-banner { display: flex; align-items: center; gap: 6px; padding: 8px 16px; background: hsl(0 70% 96%); color: hsl(0 60% 40%); font-size: 12px; }
        .workflow-delete-hint { position: absolute; bottom: 12px; left: 12px; z-index: 5; opacity: 0.7; }
        .workflow-retry-btn { color: hsl(38 80% 40%); border-color: hsl(38 60% 60%); }
        .workflow-palette { position: absolute; top: 56px; right: 16px; z-index: 20; background: hsl(0 0% 100%); border: 1px solid hsl(0 0% 85%); border-radius: 10px; padding: 8px; display: flex; flex-direction: column; gap: 4px; max-height: 260px; overflow-y: auto; box-shadow: 0 6px 20px hsl(0 0% 0% / 0.12); }
        .workflow-palette-item { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 6px; border: none; background: transparent; cursor: pointer; font-size: 13px; text-align: left; color: inherit; }
        .workflow-palette-item:hover { background: hsl(0 0% 94%); }
        .workflow-palette-empty { font-size: 12px; opacity: 0.6; padding: 6px 10px; max-width: 200px; }
        .workflow-node { position: relative; display: flex; align-items: center; gap: 8px; background: hsl(0 0% 100%); border: 2px solid; border-radius: 12px; padding: 8px 12px; min-width: 170px; box-shadow: 0 2px 8px hsl(0 0% 0% / 0.08); }
        .workflow-node-condition { border-color: #f97316; }
        .workflow-node-status { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
        .workflow-node-emoji { font-size: 18px; }
        .workflow-node-name { font-size: 12px; font-weight: 600; }
        .workflow-node-model { font-size: 10px; opacity: 0.55; font-family: monospace; }
        .workflow-node-template { font-size: 9px; opacity: 0.5; margin-top: 2px; }
        .workflow-node-handle-label { position: absolute; right: -32px; font-size: 9px; opacity: 0.6; }
        .workflow-node-handle-true { top: 28%; }
        .workflow-node-handle-false { top: 60%; }
        .workflow-missing { padding: 40px; text-align: center; }
        @media (prefers-color-scheme: dark) {
          .workflow-header { border-color: hsl(0 0% 24%); }
          .workflow-prompt-input { background: hsl(0 0% 18%); border-color: hsl(0 0% 30%); }
          .workflow-palette { background: hsl(0 0% 16%); border-color: hsl(0 0% 28%); }
          .workflow-palette-item:hover { background: hsl(0 0% 24%); }
          .workflow-node { background: hsl(0 0% 16%); }
          .workflow-transcript { border-color: hsl(0 0% 24%); }
          .workflow-transcript-header { border-color: hsl(0 0% 22%); }
          .workflow-error-banner { background: hsl(0 40% 16%); color: hsl(0 60% 75%); }
        }
        :root[data-theme="dark"] .workflow-header { border-color: hsl(0 0% 24%); }
        :root[data-theme="dark"] .workflow-prompt-input { background: hsl(0 0% 18%); border-color: hsl(0 0% 30%); }
        :root[data-theme="dark"] .workflow-palette { background: hsl(0 0% 16%); border-color: hsl(0 0% 28%); }
        :root[data-theme="dark"] .workflow-node { background: hsl(0 0% 16%); }
        :root[data-theme="dark"] .workflow-transcript { border-color: hsl(0 0% 24%); }
      `}</style>
    </div>
  );
}

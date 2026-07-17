import { useCallback, useMemo, useState } from "react";
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
import { ArrowLeft, Play, FloppyDisk } from "@phosphor-icons/react";
import { useWorkflows } from "@/hooks/useWorkflows";
import { useAgents, type Agent } from "@/hooks/useAgents";
import { useSettings } from "@/hooks/useSettings";
import { runWorkflow, type NodeStatus } from "@/lib/workflowRunner";

interface AgentNodeData extends Record<string, unknown> {
  agent?: Agent;
  status: NodeStatus;
}

function AgentNode({ data }: NodeProps<Node<AgentNodeData>>) {
  const { agent, status } = data;
  const statusColor = { idle: "#94a3b8", running: "#3b82f6", done: "#22c55e", error: "#ef4444" }[status];

  return (
    <div className="workflow-node" style={{ borderColor: agent?.color ?? "#94a3b8" }}>
      <Handle type="target" position={Position.Left} />
      <div className="workflow-node-status" style={{ background: statusColor }} />
      <div className="workflow-node-emoji">{agent?.emoji ?? "❓"}</div>
      <div className="workflow-node-body">
        <div className="workflow-node-name">{agent?.name ?? "Agent supprimé"}</div>
        <div className="workflow-node-model">{agent?.model}</div>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

const nodeTypes = { agentNode: AgentNode };

export default function WorkflowBuilder() {
  const { workflowId } = useParams({ from: "/workflows/$workflowId" });
  const { workflows, saveWorkflow } = useWorkflows();
  const { agents } = useAgents();
  const { setSettings } = useSettings();
  const navigate = useNavigate();

  const workflow = workflows.find((w) => w.id === workflowId);
  const agentsById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);

  const initialNodes: Node<AgentNodeData>[] = useMemo(
    () =>
      (workflow?.nodes ?? []).map((n) => ({
        id: n.id,
        type: "agentNode",
        position: n.position,
        data: { agent: agentsById.get(n.agentId), status: "idle" },
      })),
    [workflow?.nodes, agentsById],
  );
  const initialEdges: Edge[] = useMemo(
    () => (workflow?.edges ?? []).map((e) => ({ id: e.id, source: e.source, target: e.target, animated: false })),
    [workflow?.edges],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [running, setRunning] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [showPalette, setShowPalette] = useState(false);

  const onConnect = useCallback(
    (connection: Connection) => setEdges((eds) => addEdge({ ...connection, animated: false }, eds)),
    [setEdges],
  );

  const nodeIdToAgentId = useMemo(() => {
    const map: Record<string, string> = {};
    // node.data.agent may become stale after agents change; store via node id lookup at add-time
    return map;
  }, []);
  void nodeIdToAgentId;

  const addAgentNode = useCallback((agent: Agent) => {
    const newNode: Node<AgentNodeData> = {
      id: crypto.randomUUID(),
      type: "agentNode",
      position: { x: 80 + Math.random() * 60, y: 80 + nodes.length * 110 },
      data: { agent, status: "idle" },
    };
    setNodes((nds) => [...nds, newNode]);
    setShowPalette(false);
  }, [nodes.length, setNodes]);

  const persist = useCallback(() => {
    if (!workflow) return;
    saveWorkflow(
      workflow.id,
      nodes.map((n) => ({ id: n.id, agentId: (n.data.agent as Agent | undefined)?.id ?? "", position: n.position })),
      edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
    );
  }, [workflow, nodes, edges, saveWorkflow]);

  const setNodeStatus = useCallback((nodeId: string, status: NodeStatus) => {
    setNodes((nds) => nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, status } } : n)));
  }, [setNodes]);

  const launch = useCallback(async () => {
    if (!workflow || running) return;
    persist();
    setRunning(true);
    setNodes((nds) => nds.map((n) => ({ ...n, data: { ...n.data, status: "idle" } })));

    const runnableWorkflow = {
      ...workflow,
      nodes: nodes.map((n) => ({ id: n.id, agentId: (n.data.agent as Agent | undefined)?.id ?? "", position: n.position })),
      edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
    };

    try {
      await runWorkflow(runnableWorkflow, agentsById, prompt, setSettings, {
        onNodeStatus: (nodeId, status) => setNodeStatus(nodeId, status),
      });
    } finally {
      setRunning(false);
    }
  }, [workflow, running, persist, nodes, edges, agentsById, prompt, setSettings, setNodes, setNodeStatus]);

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
        <button className="agent-btn-secondary" onClick={() => setShowPalette((v) => !v)}>+ Agent</button>
        <button className="agent-btn-secondary" onClick={persist}><FloppyDisk size={14} /> Sauver</button>
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

      <div className="workflow-canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          fitView
        >
          <Background />
          <Controls />
          <MiniMap />
        </ReactFlow>
      </div>

      <style>{`
        .workflow-page { display: flex; flex-direction: column; height: 100vh; }
        .workflow-header { display: flex; align-items: center; gap: 8px; padding: 12px 16px; border-bottom: 1px solid hsl(0 0% 88%); }
        .workflow-title { font-size: 15px; font-weight: 700; margin-right: 8px; white-space: nowrap; }
        .workflow-prompt-input { flex: 1; padding: 7px 10px; border-radius: 8px; border: 1px solid hsl(0 0% 85%); font-size: 13px; background: hsl(0 0% 100%); color: inherit; }
        .workflow-canvas { flex: 1; min-height: 0; }
        .workflow-palette { position: absolute; top: 56px; right: 16px; z-index: 20; background: hsl(0 0% 100%); border: 1px solid hsl(0 0% 85%); border-radius: 10px; padding: 8px; display: flex; flex-direction: column; gap: 4px; max-height: 260px; overflow-y: auto; box-shadow: 0 6px 20px hsl(0 0% 0% / 0.12); }
        .workflow-palette-item { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 6px; border: none; background: transparent; cursor: pointer; font-size: 13px; text-align: left; color: inherit; }
        .workflow-palette-item:hover { background: hsl(0 0% 94%); }
        .workflow-palette-empty { font-size: 12px; opacity: 0.6; padding: 6px 10px; max-width: 200px; }
        .workflow-node { display: flex; align-items: center; gap: 8px; background: hsl(0 0% 100%); border: 2px solid; border-radius: 12px; padding: 8px 12px; min-width: 170px; box-shadow: 0 2px 8px hsl(0 0% 0% / 0.08); }
        .workflow-node-status { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
        .workflow-node-emoji { font-size: 18px; }
        .workflow-node-name { font-size: 12px; font-weight: 600; }
        .workflow-node-model { font-size: 10px; opacity: 0.55; font-family: monospace; }
        .workflow-missing { padding: 40px; text-align: center; }
        @media (prefers-color-scheme: dark) {
          .workflow-header { border-color: hsl(0 0% 24%); }
          .workflow-prompt-input { background: hsl(0 0% 18%); border-color: hsl(0 0% 30%); }
          .workflow-palette { background: hsl(0 0% 16%); border-color: hsl(0 0% 28%); }
          .workflow-palette-item:hover { background: hsl(0 0% 24%); }
          .workflow-node { background: hsl(0 0% 16%); }
        }
        :root[data-theme="dark"] .workflow-header { border-color: hsl(0 0% 24%); }
        :root[data-theme="dark"] .workflow-prompt-input { background: hsl(0 0% 18%); border-color: hsl(0 0% 30%); }
        :root[data-theme="dark"] .workflow-palette { background: hsl(0 0% 16%); border-color: hsl(0 0% 28%); }
        :root[data-theme="dark"] .workflow-node { background: hsl(0 0% 16%); }
      `}</style>
    </div>
  );
}

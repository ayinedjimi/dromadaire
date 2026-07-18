import { sendMessage } from "@/api";
import { Model } from "@/gotypes";
import type { Agent } from "@/hooks/useAgents";
import type { Workflow, WorkflowNodeData } from "@/hooks/useWorkflows";

export type NodeStatus = "idle" | "running" | "done" | "error" | "skipped";

export interface WorkflowRunCallbacks {
  onNodeStatus: (nodeId: string, status: NodeStatus, output?: string) => void;
  onNodeDelta?: (nodeId: string, deltaText: string) => void;
}

function buildGraph(workflow: Workflow) {
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, { target: string; handle?: "true" | "false" }[]>();

  for (const node of workflow.nodes) {
    incoming.set(node.id, []);
    outgoing.set(node.id, []);
  }
  for (const edge of workflow.edges) {
    incoming.get(edge.target)?.push(edge.source);
    outgoing.get(edge.source)?.push({ target: edge.target, handle: edge.sourceHandle });
  }
  return { incoming, outgoing };
}

// W1: a workflow has a cycle if Kahn's algorithm can't reach every node
// (some nodes never reach in-degree 0 because they depend on each other).
export function detectCycle(workflow: Workflow): boolean {
  const { incoming, outgoing } = buildGraph(workflow);
  const inDegree = new Map<string, number>();
  for (const node of workflow.nodes) inDegree.set(node.id, incoming.get(node.id)?.length ?? 0);

  let ready = workflow.nodes.filter((n) => (inDegree.get(n.id) ?? 0) === 0).map((n) => n.id);
  const visited = new Set<string>();
  while (ready.length > 0) {
    const id = ready.shift()!;
    visited.add(id);
    for (const { target } of outgoing.get(id) ?? []) {
      const remaining = (inDegree.get(target) ?? 0) - 1;
      inDegree.set(target, remaining);
      if (remaining === 0) ready.push(target);
    }
  }
  return visited.size < workflow.nodes.length;
}

// W3: replace {{AgentName.output}} with that predecessor's output. Falls
// back to concatenating all predecessor outputs when no placeholder is used.
function resolveInput(template: string, preds: string[], outputs: Map<string, string>, nodeById: Map<string, WorkflowNodeData>, agentsById: Map<string, Agent>): string {
  const hasPlaceholder = /\{\{[^}]+\.output\}\}/.test(template);
  if (!hasPlaceholder) {
    return preds.map((p) => outputs.get(p) ?? "").filter(Boolean).join("\n\n---\n\n");
  }
  return template.replace(/\{\{([^}]+)\.output\}\}/g, (match, varName: string) => {
    const name = varName.trim();
    for (const predId of preds) {
      const predNode = nodeById.get(predId);
      const predAgent = predNode ? agentsById.get(predNode.agentId) : undefined;
      if (predAgent?.name === name) return outputs.get(predId) ?? "";
    }
    return match; // unresolved placeholder — leave as-is so the issue is visible
  });
}

async function runAgentStep(
  agent: Agent,
  input: string,
  nodeId: string,
  onDelta?: (nodeId: string, deltaText: string) => void,
): Promise<{ chatId: string; text: string }> {
  const model = new Model({ model: agent.model });
  let chatId = "new";
  let text = "";

  for await (const event of sendMessage(
    "new",
    input,
    model,
    undefined,
    undefined,
    undefined,
    agent.webSearch,
    false,
    undefined,
    undefined,
    false,
  )) {
    if (event.eventName === "chat_created" && event.chatId) {
      chatId = event.chatId;
    } else if (event.eventName === "chat" && event.content) {
      text += event.content;
      onDelta?.(nodeId, event.content);
    }
  }

  return { chatId, text };
}

export interface RunWorkflowOptions {
  // W5: resume a previous run — skip these nodes and use their recorded outputs
  seedOutputs?: Map<string, string>;
  skipNodeIds?: Set<string>;
}

// Executes a workflow's DAG: nodes with no predecessors receive `initialPrompt`,
// downstream nodes receive their predecessors' outputs (joined, or via {{Name.output}}
// interpolation) as input. Condition nodes route to only the matching branch.
export async function runWorkflow(
  workflow: Workflow,
  agentsById: Map<string, Agent>,
  initialPrompt: string,
  setSettings: (updates: Record<string, unknown>) => Promise<void>,
  callbacks: WorkflowRunCallbacks,
  options: RunWorkflowOptions = {},
): Promise<Map<string, string>> {
  const { incoming, outgoing } = buildGraph(workflow);
  const nodeById = new Map(workflow.nodes.map((n) => [n.id, n]));
  const outputs = new Map<string, string>(options.seedOutputs ?? []);
  const skip = options.skipNodeIds ?? new Set<string>();

  const inDegree = new Map<string, number>();
  for (const node of workflow.nodes) inDegree.set(node.id, incoming.get(node.id)?.length ?? 0);

  let ready = workflow.nodes.filter((n) => (inDegree.get(n.id) ?? 0) === 0).map((n) => n.id);
  const done = new Set<string>(skip);

  const propagate = (nodeId: string, allowedHandle?: "true" | "false") => {
    for (const { target, handle } of outgoing.get(nodeId) ?? []) {
      if (allowedHandle && handle && handle !== allowedHandle) {
        // condition branch not taken — mark this side of the graph as skipped
        if (!done.has(target)) {
          callbacks.onNodeStatus(target, "skipped");
          done.add(target);
          propagate(target);
        }
        continue;
      }
      const remaining = (inDegree.get(target) ?? 0) - 1;
      inDegree.set(target, remaining);
      if (remaining === 0 && !done.has(target)) ready.push(target);
    }
  };

  while (ready.length > 0) {
    const nodeId = ready.shift()!;
    if (skip.has(nodeId)) {
      propagate(nodeId);
      continue;
    }
    const node = nodeById.get(nodeId);
    const preds = incoming.get(nodeId) ?? [];

    if (node?.kind === "condition") {
      callbacks.onNodeStatus(nodeId, "running");
      const combinedInput = preds.map((p) => outputs.get(p) ?? "").join("\n\n");
      const matched = (node.matchText ?? "") !== "" && combinedInput.includes(node.matchText ?? "");
      outputs.set(nodeId, combinedInput);
      callbacks.onNodeStatus(nodeId, "done", combinedInput);
      done.add(nodeId);
      propagate(nodeId, matched ? "true" : "false");
      continue;
    }

    const agent = node ? agentsById.get(node.agentId) : undefined;
    if (!agent) {
      callbacks.onNodeStatus(nodeId, "error");
      done.add(nodeId);
      propagate(nodeId);
      continue;
    }

    callbacks.onNodeStatus(nodeId, "running");
    const template = node?.promptTemplate ?? "";
    const input = template
      ? resolveInput(template, preds, outputs, nodeById, agentsById)
      : preds.length > 0
        ? preds.map((p) => outputs.get(p) ?? "").filter(Boolean).join("\n\n---\n\n")
        : initialPrompt;

    try {
      await setSettings({
        SelectedModel: agent.model,
        SystemPrompt: agent.systemPrompt,
        WebSearchEnabled: agent.webSearch,
        RAGEnabled: agent.rag,
        Agent: agent.taskExecution,
      });
      const { text } = await runAgentStep(agent, input, nodeId, callbacks.onNodeDelta);
      outputs.set(nodeId, text);
      callbacks.onNodeStatus(nodeId, "done", text);
    } catch {
      callbacks.onNodeStatus(nodeId, "error");
    }
    done.add(nodeId);
    propagate(nodeId);
  }

  return outputs;
}

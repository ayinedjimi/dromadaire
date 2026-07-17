import { sendMessage } from "@/api";
import { Model } from "@/gotypes";
import type { Agent } from "@/hooks/useAgents";
import type { Workflow } from "@/hooks/useWorkflows";

export type NodeStatus = "idle" | "running" | "done" | "error";

export interface WorkflowRunCallbacks {
  onNodeStatus: (nodeId: string, status: NodeStatus, output?: string) => void;
}

async function runAgentStep(agent: Agent, input: string): Promise<{ chatId: string; text: string }> {
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
    }
  }

  return { chatId, text };
}

// Executes a workflow's DAG: nodes with no predecessors receive `initialPrompt`,
// downstream nodes receive their predecessors' outputs (joined) as input.
export async function runWorkflow(
  workflow: Workflow,
  agentsById: Map<string, Agent>,
  initialPrompt: string,
  setSettings: (updates: Record<string, unknown>) => Promise<void>,
  callbacks: WorkflowRunCallbacks,
): Promise<Map<string, string>> {
  const outputs = new Map<string, string>();
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();

  for (const node of workflow.nodes) {
    incoming.set(node.id, []);
    outgoing.set(node.id, []);
  }
  for (const edge of workflow.edges) {
    incoming.get(edge.target)?.push(edge.source);
    outgoing.get(edge.source)?.push(edge.target);
  }

  const inDegree = new Map<string, number>();
  for (const node of workflow.nodes) {
    inDegree.set(node.id, incoming.get(node.id)?.length ?? 0);
  }

  let ready = workflow.nodes.filter((n) => (inDegree.get(n.id) ?? 0) === 0).map((n) => n.id);
  const done = new Set<string>();

  while (ready.length > 0) {
    const nodeId = ready.shift()!;
    const node = workflow.nodes.find((n) => n.id === nodeId);
    const agent = node ? agentsById.get(node.agentId) : undefined;

    if (!agent) {
      callbacks.onNodeStatus(nodeId, "error");
      done.add(nodeId);
    } else {
      callbacks.onNodeStatus(nodeId, "running");
      const preds = incoming.get(nodeId) ?? [];
      const input = preds.length > 0
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
        const { text } = await runAgentStep(agent, input);
        outputs.set(nodeId, text);
        callbacks.onNodeStatus(nodeId, "done", text);
      } catch {
        callbacks.onNodeStatus(nodeId, "error");
      }
      done.add(nodeId);
    }

    for (const nextId of outgoing.get(nodeId) ?? []) {
      const remaining = (inDegree.get(nextId) ?? 0) - 1;
      inDegree.set(nextId, remaining);
      if (remaining === 0 && !done.has(nextId)) {
        ready.push(nextId);
      }
    }
  }

  return outputs;
}

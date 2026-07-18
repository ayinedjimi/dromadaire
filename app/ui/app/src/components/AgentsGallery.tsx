import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Plus, Trash, Robot, ArrowLeft, FlowArrow, PencilSimple, Warning, DownloadSimple, UploadSimple } from "@phosphor-icons/react";
import { useAgents, type Agent } from "@/hooks/useAgents";
import { useWorkflows } from "@/hooks/useWorkflows";
import { useModels } from "@/hooks/useModels";
import { useSettings } from "@/hooks/useSettings";
import { getRAGDocuments, setActiveAgentRAGDocumentIds, type RAGDocument } from "@/api";
import { recordAgentRun, useUsageStats } from "@/hooks/useUsageStats";

const COLORS = [
  { label: "Bleu", value: "#3b82f6" },
  { label: "Vert", value: "#22c55e" },
  { label: "Rose", value: "#ec4899" },
  { label: "Violet", value: "#a855f7" },
  { label: "Orange", value: "#f97316" },
  { label: "Ambre", value: "#eab308" },
];

const EMOJIS = ["🤖", "🎓", "📊", "⚖️", "🩺", "💼", "🛠️", "🔬", "✍️", "📚"];

function AgentForm({ editing, onClose }: { editing?: Agent; onClose: () => void }) {
  const { createAgent, updateAgent } = useAgents();
  const { data: models = [] } = useModels();
  const [ragDocs, setRagDocs] = useState<RAGDocument[]>([]);

  const [name, setName] = useState(editing?.name ?? "");
  const [emoji, setEmoji] = useState(editing?.emoji ?? EMOJIS[0]);
  const [color, setColor] = useState(editing?.color ?? COLORS[0].value);
  const [model, setModel] = useState(editing?.model ?? "");
  const [systemPrompt, setSystemPrompt] = useState(editing?.systemPrompt ?? "");
  const [webSearch, setWebSearch] = useState(editing?.webSearch ?? false);
  const [rag, setRag] = useState(editing?.rag ?? false);
  const [ragDocumentIds, setRagDocumentIds] = useState<string[]>(editing?.ragDocumentIds ?? []);
  const [taskExecution, setTaskExecution] = useState(editing?.taskExecution ?? false);

  useEffect(() => {
    if (!rag) return;
    getRAGDocuments().then(setRagDocs).catch(() => setRagDocs([]));
  }, [rag]);

  const toggleDoc = (id: string) => {
    setRagDocumentIds((prev) => (prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id]));
  };

  const canSave = name.trim() !== "" && model !== "";

  const save = () => {
    const payload = { name: name.trim(), emoji, color, model, systemPrompt, webSearch, rag, ragDocumentIds, taskExecution };
    if (editing) {
      updateAgent(editing.id, payload);
    } else {
      createAgent(payload);
    }
    onClose();
  };

  return (
    <div className="agent-modal-backdrop" onClick={onClose}>
      <div className="agent-modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="agent-modal-title">{editing ? "Modifier l'agent" : "Nouvel agent"}</h2>

        <label className="agent-form-label">Nom</label>
        <input
          className="agent-form-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ex: Expert juridique"
          autoFocus
        />

        <label className="agent-form-label">Icône</label>
        <div className="agent-emoji-picker">
          {EMOJIS.map((e) => (
            <button
              key={e}
              type="button"
              className={`agent-emoji-btn ${emoji === e ? "agent-emoji-btn-active" : ""}`}
              onClick={() => setEmoji(e)}
            >
              {e}
            </button>
          ))}
        </div>

        <label className="agent-form-label">Couleur</label>
        <div className="agent-color-picker">
          {COLORS.map((c) => (
            <button
              key={c.value}
              type="button"
              title={c.label}
              className={`agent-color-btn ${color === c.value ? "agent-color-btn-active" : ""}`}
              style={{ background: c.value }}
              onClick={() => setColor(c.value)}
            />
          ))}
        </div>

        <label className="agent-form-label">Modèle</label>
        <select className="agent-form-input" value={model} onChange={(e) => setModel(e.target.value)}>
          <option value="">Choisir un modèle...</option>
          {models.map((m) => (
            <option key={m.model} value={m.model}>{m.model}</option>
          ))}
        </select>

        <label className="agent-form-label">Instructions (prompt système)</label>
        <textarea
          className="agent-form-input agent-form-textarea"
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          placeholder="Décris le rôle, l'expertise et le style de réponse de cet agent..."
          rows={5}
        />

        <label className="agent-form-label">Outils</label>
        <div className="agent-tools-list">
          <label className="agent-tool-toggle">
            <input type="checkbox" checked={webSearch} onChange={(e) => setWebSearch(e.target.checked)} />
            Recherche web
          </label>
          <label className="agent-tool-toggle">
            <input type="checkbox" checked={rag} onChange={(e) => setRag(e.target.checked)} />
            Base de connaissances (RAG)
          </label>
          <label className="agent-tool-toggle">
            <input type="checkbox" checked={taskExecution} onChange={(e) => setTaskExecution(e.target.checked)} />
            Exécution de tâches (commandes, approbation requise à chaque appel)
          </label>
        </div>

        {rag && (
          <>
            <label className="agent-form-label">Documents RAG (aucun coché = toute la base)</label>
            {ragDocs.length === 0 ? (
              <div className="agent-rag-empty">Aucun document dans la base de connaissances.</div>
            ) : (
              <div className="agent-rag-doc-list">
                {ragDocs.map((d) => (
                  <label key={d.id} className="agent-tool-toggle">
                    <input type="checkbox" checked={ragDocumentIds.includes(d.id)} onChange={() => toggleDoc(d.id)} />
                    {d.filename}
                  </label>
                ))}
              </div>
            )}
          </>
        )}

        <div className="agent-modal-actions">
          <button type="button" className="agent-btn-secondary" onClick={onClose}>Annuler</button>
          <button type="button" className="agent-btn-primary" disabled={!canSave} onClick={save}>
            {editing ? "Enregistrer" : "Créer l'agent"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AgentCard({ agent, modelMissing, onLaunch, onEdit, onDelete }: {
  agent: Agent;
  modelMissing: boolean;
  onLaunch: (a: Agent) => void;
  onEdit: (a: Agent) => void;
  onDelete: (id: string, name: string) => void;
}) {
  return (
    <div className="agent-card" style={{ borderTopColor: agent.color }} onClick={() => onLaunch(agent)}>
      <div className="agent-card-actions">
        <button className="agent-card-icon-btn" onClick={(e) => { e.stopPropagation(); onEdit(agent); }} title="Modifier">
          <PencilSimple size={14} />
        </button>
        <button className="agent-card-icon-btn agent-card-icon-btn-danger" onClick={(e) => { e.stopPropagation(); onDelete(agent.id, agent.name); }} title="Supprimer">
          <Trash size={14} />
        </button>
      </div>
      <div className="agent-card-emoji" style={{ background: `${agent.color}22` }}>{agent.emoji}</div>
      <div className="agent-card-name">
        {agent.name}
        {modelMissing && <Warning size={13} className="agent-card-warning" />}
      </div>
      <div className="agent-card-model">{modelMissing ? `${agent.model} (introuvable)` : agent.model}</div>
      {agent.systemPrompt && <div className="agent-card-desc">{agent.systemPrompt}</div>}
      <div className="agent-card-tools">
        {agent.webSearch && <span className="agent-card-tag">Recherche web</span>}
        {agent.rag && <span className="agent-card-tag">RAG{agent.ragDocumentIds?.length ? ` (${agent.ragDocumentIds.length})` : ""}</span>}
        {agent.taskExecution && <span className="agent-card-tag">Tâches</span>}
      </div>
    </div>
  );
}

export default function AgentsGallery() {
  const { agents, createAgent, deleteAgent } = useAgents();
  const { workflows, createWorkflow, deleteWorkflow } = useWorkflows();
  const { setSettings } = useSettings();
  const { data: models = [] } = useModels();
  const stats = useUsageStats();
  const navigate = useNavigate();
  const [showForm, setShowForm] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | undefined>(undefined);

  const knownModelNames = new Set(models.map((m) => m.model.split(":")[0]));

  const launchAgent = async (agent: Agent) => {
    setActiveAgentRAGDocumentIds(agent.rag ? agent.ragDocumentIds ?? [] : []);
    recordAgentRun(agent.id);
    await setSettings({
      SelectedModel: agent.model,
      SystemPrompt: agent.systemPrompt,
      WebSearchEnabled: agent.webSearch,
      RAGEnabled: agent.rag,
      Agent: agent.taskExecution,
    });
    navigate({ to: "/" });
  };

  const confirmDeleteAgent = (id: string, name: string) => {
    if (window.confirm(`Supprimer l'agent "${name}" ?`)) deleteAgent(id);
  };

  const confirmDeleteWorkflow = (id: string, name: string) => {
    if (window.confirm(`Supprimer le workflow "${name}" ?`)) deleteWorkflow(id);
  };

  const newWorkflow = () => {
    const workflow = createWorkflow(`Workflow ${workflows.length + 1}`);
    navigate({ to: "/workflows/$workflowId", params: { workflowId: workflow.id } });
  };

  const exportAgents = () => {
    const blob = new Blob([JSON.stringify(agents, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "dromadaire-agents.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const importAgents = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const parsed = JSON.parse(await file.text()) as Agent[];
        let imported = 0;
        for (const a of parsed) {
          if (a.name && a.model) {
            createAgent({
              name: a.name,
              emoji: a.emoji ?? EMOJIS[0],
              color: a.color ?? COLORS[0].value,
              model: a.model,
              systemPrompt: a.systemPrompt ?? "",
              webSearch: a.webSearch ?? false,
              rag: a.rag ?? false,
              ragDocumentIds: a.ragDocumentIds ?? [],
              taskExecution: a.taskExecution ?? false,
            });
            imported++;
          }
        }
        window.alert(`${imported} agent(s) importé(s).`);
      } catch {
        window.alert("Fichier invalide.");
      }
    };
    input.click();
  };

  return (
    <div className="agents-page">
      <div className="agents-header">
        <button className="agents-back" onClick={() => navigate({ to: "/" })}>
          <ArrowLeft size={16} />
        </button>
        <Robot size={20} />
        <h1 className="agents-title">Agents</h1>
        <button className="agent-btn-secondary" onClick={exportAgents} title="Exporter les agents en JSON">
          <DownloadSimple size={14} />
        </button>
        <button className="agent-btn-secondary" onClick={importAgents} title="Importer des agents depuis un JSON">
          <UploadSimple size={14} />
        </button>
        <button className="agent-btn-primary agents-new-btn" onClick={() => { setEditingAgent(undefined); setShowForm(true); }}>
          <Plus size={14} weight="bold" />
          Nouvel agent
        </button>
      </div>

      {agents.length === 0 ? (
        <div className="agents-empty">
          <Robot size={40} />
          <p>Aucun agent pour l'instant.</p>
          <p className="agents-empty-sub">Crée un agent avec un modèle, des instructions et des outils dédiés, puis lance une conversation pré-configurée en un clic.</p>
        </div>
      ) : (
        <div className="agents-grid">
          {agents.map((a) => (
            <AgentCard
              key={a.id}
              agent={a}
              modelMissing={models.length > 0 && !knownModelNames.has(a.model.split(":")[0])}
              onLaunch={launchAgent}
              onEdit={(agent) => { setEditingAgent(agent); setShowForm(true); }}
              onDelete={confirmDeleteAgent}
            />
          ))}
        </div>
      )}

      <div className="agents-section-header">
        <FlowArrow size={18} />
        <h2 className="agents-section-title">Workflows</h2>
        <button className="agent-btn-secondary agents-new-btn" onClick={newWorkflow}>
          <Plus size={14} weight="bold" />
          Nouveau workflow
        </button>
      </div>

      {workflows.length === 0 ? (
        <div className="agents-empty">
          <FlowArrow size={32} />
          <p className="agents-empty-sub">Enchaîne plusieurs agents dans un canevas visuel : la sortie de l'un devient l'entrée du suivant.</p>
        </div>
      ) : (
        <div className="agents-grid">
          {workflows.map((w) => (
            <div
              key={w.id}
              className="agent-card workflow-card"
              onClick={() => navigate({ to: "/workflows/$workflowId", params: { workflowId: w.id } })}
            >
              <div className="agent-card-actions">
                <button
                  className="agent-card-icon-btn agent-card-icon-btn-danger"
                  onClick={(e) => { e.stopPropagation(); confirmDeleteWorkflow(w.id, w.name); }}
                  title="Supprimer le workflow"
                >
                  <Trash size={14} />
                </button>
              </div>
              <div className="agent-card-emoji">🔀</div>
              <div className="agent-card-name">{w.name}</div>
              <div className="agent-card-model">
                {w.nodes.length} étape(s)
                {stats.workflows[w.id] ? ` · ${stats.workflows[w.id].runs} lancement(s)` : ""}
              </div>
            </div>
          ))}
        </div>
      )}

      {(agents.length > 0 || workflows.length > 0) && (
        <div className="agents-section-header">
          <h2 className="agents-section-title">Utilisation</h2>
        </div>
      )}
      {agents.length > 0 && (
        <div className="agents-stats-list">
          {agents.map((a) => (
            <div key={a.id} className="agents-stats-row">
              <span>{a.emoji} {a.name}</span>
              <span className="agents-stats-value">
                {stats.agents[a.id]?.runs ?? 0} lancement(s)
                {stats.agents[a.id]?.lastRun ? ` · dernier : ${new Date(stats.agents[a.id].lastRun).toLocaleString("fr-FR")}` : ""}
              </span>
            </div>
          ))}
        </div>
      )}

      {showForm && <AgentForm editing={editingAgent} onClose={() => setShowForm(false)} />}

      <style>{`
        .agents-section-header { display: flex; align-items: center; gap: 10px; margin: 32px 0 16px; }
        .agents-section-title { font-size: 16px; font-weight: 700; flex: 1; }
        .agents-page { padding: 24px 32px; max-width: 960px; margin: 0 auto; }
        .agents-header { display: flex; align-items: center; gap: 10px; margin-bottom: 24px; }
        .agents-back { background: transparent; border: none; cursor: pointer; padding: 6px; border-radius: 8px; color: inherit; opacity: 0.7; }
        .agents-back:hover { opacity: 1; background: hsl(0 0% 90%); }
        .agents-title { font-size: 20px; font-weight: 700; flex: 1; }
        .agents-new-btn { margin-left: 4px; }
        .agents-empty { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 64px 16px; opacity: 0.6; text-align: center; }
        .agents-empty-sub { font-size: 13px; max-width: 360px; }
        .agents-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; }
        .agents-stats-list { display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
        .agents-stats-row { display: flex; justify-content: space-between; padding: 6px 10px; border-radius: 8px; background: hsl(0 0% 96%); }
        .agents-stats-value { opacity: 0.6; }
        .agent-card {
          position: relative;
          border: 1px solid hsl(0 0% 88%);
          border-top: 3px solid;
          border-radius: 14px;
          padding: 16px;
          cursor: pointer;
          background: hsl(0 0% 100%);
          transition: transform 120ms, box-shadow 120ms;
        }
        .agent-card:hover { transform: translateY(-2px); box-shadow: 0 8px 20px hsl(0 0% 0% / 0.08); }
        .agent-card-actions { position: absolute; top: 10px; right: 10px; display: flex; gap: 2px; opacity: 0; transition: opacity 120ms; }
        .agent-card:hover .agent-card-actions { opacity: 0.8; }
        .agent-card-icon-btn { background: transparent; border: none; cursor: pointer; padding: 4px; border-radius: 6px; color: hsl(0 0% 40%); }
        .agent-card-icon-btn:hover { opacity: 1 !important; background: hsl(0 0% 90%); }
        .agent-card-icon-btn-danger { color: hsl(0 60% 50%); }
        .agent-card-icon-btn-danger:hover { background: hsl(0 60% 95%); }
        .agent-card-warning { color: hsl(38 90% 50%); margin-left: 4px; vertical-align: middle; }
        .agent-card-emoji { width: 44px; height: 44px; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 22px; margin-bottom: 10px; }
        .agent-card-name { font-weight: 600; font-size: 14px; margin-bottom: 2px; }
        .agent-card-model { font-size: 11px; opacity: 0.5; font-family: monospace; margin-bottom: 8px; }
        .agent-card-desc { font-size: 12px; opacity: 0.7; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; margin-bottom: 8px; }
        .agent-card-tools { display: flex; gap: 6px; flex-wrap: wrap; }
        .agent-card-tag { font-size: 10px; padding: 2px 8px; border-radius: 9999px; background: hsl(0 0% 94%); opacity: 0.8; }

        .agent-modal-backdrop { position: fixed; inset: 0; background: hsl(0 0% 0% / 0.4); z-index: 100; display: flex; align-items: center; justify-content: center; }
        .agent-modal { background: hsl(0 0% 100%); border-radius: 16px; padding: 24px; width: 460px; max-width: 90vw; max-height: 85vh; overflow-y: auto; }
        .agent-modal-title { font-size: 17px; font-weight: 700; margin-bottom: 16px; }
        .agent-form-label { display: block; font-size: 12px; font-weight: 600; opacity: 0.7; margin: 14px 0 6px; }
        .agent-form-input { width: 100%; padding: 8px 10px; border-radius: 8px; border: 1px solid hsl(0 0% 85%); font-size: 13px; background: hsl(0 0% 100%); color: inherit; }
        .agent-form-textarea { resize: vertical; font-family: inherit; }
        .agent-emoji-picker { display: flex; gap: 6px; flex-wrap: wrap; }
        .agent-emoji-btn { font-size: 18px; padding: 6px 8px; border-radius: 8px; border: 1px solid transparent; background: hsl(0 0% 95%); cursor: pointer; }
        .agent-emoji-btn-active { border-color: hsl(217 70% 55%); background: hsl(217 70% 95%); }
        .agent-color-picker { display: flex; gap: 8px; }
        .agent-color-btn { width: 26px; height: 26px; border-radius: 50%; border: 2px solid transparent; cursor: pointer; }
        .agent-color-btn-active { border-color: hsl(0 0% 20%); }
        .agent-tools-list { display: flex; flex-direction: column; gap: 6px; }
        .agent-tool-toggle { display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer; }
        .agent-rag-doc-list { display: flex; flex-direction: column; gap: 4px; max-height: 140px; overflow-y: auto; padding: 8px; border-radius: 8px; background: hsl(0 0% 96%); }
        .agent-rag-empty { font-size: 12px; opacity: 0.6; }
        .agent-modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
        .agent-btn-primary { display: flex; align-items: center; gap: 6px; background: hsl(217 70% 55%); color: white; border: none; padding: 8px 14px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; }
        .agent-btn-primary:disabled { opacity: 0.4; cursor: default; }
        .agent-btn-secondary { display: flex; align-items: center; gap: 6px; background: transparent; border: 1px solid hsl(0 0% 80%); padding: 8px 14px; border-radius: 8px; font-size: 13px; cursor: pointer; color: inherit; }

        @media (prefers-color-scheme: dark) {
          .agent-card { background: hsl(0 0% 14%); border-color: hsl(0 0% 24%); }
          .agent-card-tag { background: hsl(0 0% 22%); }
          .agents-stats-row { background: hsl(0 0% 18%); }
          .agent-rag-doc-list { background: hsl(0 0% 20%); }
          .agent-modal { background: hsl(0 0% 16%); }
          .agent-form-input { background: hsl(0 0% 20%); border-color: hsl(0 0% 30%); }
          .agent-emoji-btn { background: hsl(0 0% 22%); }
          .agents-back:hover { background: hsl(0 0% 22%); }
          .agent-card-icon-btn:hover { background: hsl(0 0% 26%); }
        }
        :root[data-theme="dark"] .agent-card { background: hsl(0 0% 14%); border-color: hsl(0 0% 24%); }
        :root[data-theme="dark"] .agent-modal { background: hsl(0 0% 16%); }
        :root[data-theme="dark"] .agent-form-input { background: hsl(0 0% 20%); border-color: hsl(0 0% 30%); }
      `}</style>
    </div>
  );
}

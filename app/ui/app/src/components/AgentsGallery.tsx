import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus, Trash, Robot, ArrowLeft, FlowArrow, PencilSimple, Warning,
  DownloadSimple, UploadSimple, MagnifyingGlass, Globe, BookOpen, Terminal, X,
} from "@phosphor-icons/react";
import { useAgents, type Agent } from "@/hooks/useAgents";
import { useWorkflows } from "@/hooks/useWorkflows";
import { useModels } from "@/hooks/useModels";
import { useSettings } from "@/hooks/useSettings";
import { getRAGDocuments, setActiveAgentRAGDocumentIds, getSandboxStatus, type RAGDocument } from "@/api";
import { recordAgentRun, useUsageStats } from "@/hooks/useUsageStats";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

const COLORS = [
  { label: "Bleu", value: "#3b82f6" },
  { label: "Vert", value: "#22c55e" },
  { label: "Rose", value: "#ec4899" },
  { label: "Violet", value: "#a855f7" },
  { label: "Orange", value: "#f97316" },
  { label: "Ambre", value: "#eab308" },
];

const EMOJIS = ["🤖", "🎓", "📊", "⚖️", "🩺", "💼", "🛠️", "🔬", "✍️", "📚"];

const fieldLabel = "block text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-1.5 mt-5 first:mt-0";
const textareaClass =
  "block w-full rounded-lg border border-zinc-950/10 bg-transparent px-3.5 py-2.5 text-sm text-zinc-950 placeholder:text-zinc-500 focus:outline-hidden focus:ring-2 focus:ring-blue-500 dark:border-white/10 dark:bg-white/5 dark:text-white resize-y font-sans";
const selectClass =
  "block w-full rounded-lg border border-zinc-950/10 bg-transparent px-3.5 py-2.5 text-sm text-zinc-950 focus:outline-hidden focus:ring-2 focus:ring-blue-500 dark:border-white/10 dark:bg-white/5 dark:text-white";

function AgentForm({ editing, onClose }: { editing?: Agent; onClose: () => void }) {
  const { createAgent, updateAgent } = useAgents();
  const { data: models = [] } = useModels();
  const [ragDocs, setRagDocs] = useState<RAGDocument[]>([]);
  const [denoAvailable, setDenoAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    getSandboxStatus().then((s) => setDenoAvailable(s.denoAvailable)).catch(() => setDenoAvailable(false));
  }, []);

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
    if (editing) updateAgent(editing.id, payload);
    else createAgent(payload);
    onClose();
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-100 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.98 }}
        transition={{ duration: 0.18, ease: [0.165, 0.85, 0.45, 1] }}
        className="w-full max-w-md max-h-[85vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-bold text-zinc-950 dark:text-white">{editing ? "Modifier l'agent" : "Nouvel agent"}</h2>
          <button onClick={onClose} className="rounded-full p-1.5 text-zinc-400 hover:bg-zinc-950/5 hover:text-zinc-700 dark:hover:bg-white/10 dark:hover:text-zinc-200">
            <X size={16} />
          </button>
        </div>

        <label className={fieldLabel}>Nom</label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Expert juridique" autoFocus />

        <label className={fieldLabel}>Icône</label>
        <div className="flex flex-wrap gap-1.5">
          {EMOJIS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => setEmoji(e)}
              className={`flex h-9 w-9 items-center justify-center rounded-lg text-lg transition-colors ${
                emoji === e ? "bg-blue-500/15 ring-2 ring-blue-500" : "bg-zinc-950/5 hover:bg-zinc-950/10 dark:bg-white/5 dark:hover:bg-white/10"
              }`}
            >
              {e}
            </button>
          ))}
        </div>

        <label className={fieldLabel}>Couleur</label>
        <div className="flex gap-2">
          {COLORS.map((c) => (
            <button
              key={c.value}
              type="button"
              title={c.label}
              onClick={() => setColor(c.value)}
              className="h-7 w-7 rounded-full ring-offset-2 ring-offset-white transition-all dark:ring-offset-zinc-900"
              style={{ background: c.value, boxShadow: color === c.value ? `0 0 0 2px ${c.value}` : "none" }}
            />
          ))}
        </div>

        <label className={fieldLabel}>Modèle</label>
        <select className={selectClass} value={model} onChange={(e) => setModel(e.target.value)}>
          <option value="">Choisir un modèle...</option>
          {models.map((m) => (
            <option key={m.model} value={m.model}>{m.model}</option>
          ))}
        </select>

        <label className={fieldLabel}>Instructions (prompt système)</label>
        <textarea
          className={textareaClass}
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          placeholder="Décris le rôle, l'expertise et le style de réponse de cet agent..."
          rows={4}
        />

        <label className={fieldLabel}>Outils</label>
        <div className="space-y-2">
          <ToolToggle icon={<Globe size={16} />} label="Recherche web" checked={webSearch} onChange={setWebSearch} />
          <ToolToggle icon={<BookOpen size={16} />} label="Base de connaissances (RAG)" checked={rag} onChange={setRag} />
          <ToolToggle icon={<Terminal size={16} />} label="Exécution de tâches" sublabel="commandes shell, approbation requise à chaque appel" checked={taskExecution} onChange={setTaskExecution} />
          {taskExecution && (
            <p className="pl-1 text-xs text-zinc-500 dark:text-zinc-400">
              {denoAvailable === null
                ? "Vérification du bac à sable JavaScript..."
                : denoAvailable
                  ? "✓ Bac à sable JavaScript (Deno) aussi disponible — sans réseau/fichiers hors dossier, sans approbation requise."
                  : "Bac à sable JavaScript indisponible (Deno non détecté) — seules les commandes shell (avec approbation) seront proposées."}
            </p>
          )}
        </div>

        <AnimatePresence>
          {rag && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
              <label className={fieldLabel}>Documents RAG (aucun coché = toute la base)</label>
              {ragDocs.length === 0 ? (
                <div className="text-xs text-zinc-500 dark:text-zinc-400">Aucun document dans la base de connaissances.</div>
              ) : (
                <div className="flex flex-col gap-1 max-h-36 overflow-y-auto rounded-lg bg-zinc-950/5 p-2 dark:bg-white/5">
                  {ragDocs.map((d) => (
                    <label key={d.id} className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300 cursor-pointer">
                      <input type="checkbox" checked={ragDocumentIds.includes(d.id)} onChange={() => toggleDoc(d.id)} className="rounded" />
                      {d.filename}
                    </label>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex justify-end gap-2 mt-6">
          <Button plain onClick={onClose}>Annuler</Button>
          <Button color="blue" disabled={!canSave} onClick={save}>{editing ? "Enregistrer" : "Créer l'agent"}</Button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function ToolToggle({ icon, label, sublabel, checked, onChange }: { icon: React.ReactNode; label: string; sublabel?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start gap-2.5 rounded-lg border border-zinc-950/10 p-2.5 cursor-pointer hover:bg-zinc-950/2.5 dark:border-white/10 dark:hover:bg-white/5">
      <span className="mt-0.5 text-zinc-500 dark:text-zinc-400">{icon}</span>
      <span className="flex-1">
        <span className="block text-sm text-zinc-800 dark:text-zinc-200">{label}</span>
        {sublabel && <span className="block text-xs text-zinc-500 dark:text-zinc-400">{sublabel}</span>}
      </span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-1 rounded" />
    </label>
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
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      whileHover={{ y: -3 }}
      transition={{ duration: 0.15 }}
      className="group relative cursor-pointer rounded-2xl border border-zinc-950/8 bg-white p-4 shadow-sm hover:shadow-lg dark:border-white/10 dark:bg-zinc-800/60"
      style={{ borderTopWidth: 3, borderTopColor: agent.color }}
      onClick={() => onLaunch(agent)}
    >
      <div className="absolute right-2.5 top-2.5 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <button onClick={(e) => { e.stopPropagation(); onEdit(agent); }} title="Modifier" className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-950/5 hover:text-zinc-700 dark:hover:bg-white/10 dark:hover:text-zinc-200">
          <PencilSimple size={14} />
        </button>
        <button onClick={(e) => { e.stopPropagation(); onDelete(agent.id, agent.name); }} title="Supprimer" className="rounded-md p-1.5 text-red-400 hover:bg-red-500/10 hover:text-red-600">
          <Trash size={14} />
        </button>
      </div>

      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl text-xl" style={{ background: `${agent.color}1f` }}>
        {agent.emoji}
      </div>
      <div className="flex items-center gap-1.5 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
        {agent.name}
        {modelMissing && <Warning size={13} className="text-amber-500" />}
      </div>
      <div className="mb-2 truncate font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
        {modelMissing ? `${agent.model} (introuvable)` : agent.model}
      </div>
      {agent.systemPrompt && (
        <div className="mb-2 line-clamp-2 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">{agent.systemPrompt}</div>
      )}
      <div className="flex flex-wrap gap-1.5">
        {agent.webSearch && <Badge color="blue">Recherche web</Badge>}
        {agent.rag && <Badge color="purple">RAG{agent.ragDocumentIds?.length ? ` (${agent.ragDocumentIds.length})` : ""}</Badge>}
        {agent.taskExecution && <Badge color="orange">Tâches</Badge>}
      </div>
    </motion.div>
  );
}

function SectionHeader({ icon, title, action }: { icon: React.ReactNode; title: string; action?: React.ReactNode }) {
  return (
    <div className="mb-4 mt-8 flex items-center gap-2 first:mt-0">
      <span className="text-zinc-400 dark:text-zinc-500">{icon}</span>
      <h2 className="flex-1 text-base font-bold text-zinc-900 dark:text-zinc-100">{title}</h2>
      {action}
    </div>
  );
}

function EmptyState({ icon, title, sub }: { icon: React.ReactNode; title?: string; sub: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-zinc-950/10 py-14 px-6 text-center dark:border-white/10">
      <span className="text-zinc-300 dark:text-zinc-600">{icon}</span>
      {title && <p className="text-sm font-medium text-zinc-600 dark:text-zinc-300">{title}</p>}
      <p className="max-w-sm text-xs text-zinc-500 dark:text-zinc-400">{sub}</p>
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
  const [search, setSearch] = useState("");

  const knownModelNames = new Set(models.map((m) => m.model.split(":")[0]));
  const filteredAgents = search.trim()
    ? agents.filter((a) => a.name.toLowerCase().includes(search.toLowerCase()) || a.model.toLowerCase().includes(search.toLowerCase()))
    : agents;

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
              name: a.name, emoji: a.emoji ?? EMOJIS[0], color: a.color ?? COLORS[0].value, model: a.model,
              systemPrompt: a.systemPrompt ?? "", webSearch: a.webSearch ?? false, rag: a.rag ?? false,
              ragDocumentIds: a.ragDocumentIds ?? [], taskExecution: a.taskExecution ?? false,
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
    <div className="mx-auto max-w-4xl px-6 py-6 sm:px-8">
      <div className="mb-6 flex items-center gap-3">
        <button onClick={() => navigate({ to: "/" })} className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-950/5 dark:text-zinc-400 dark:hover:bg-white/10">
          <ArrowLeft size={16} />
        </button>
        <Robot size={20} className="text-zinc-400 dark:text-zinc-500" />
        <h1 className="flex-1 text-xl font-bold text-zinc-950 dark:text-white">Agents</h1>
        <Button plain onClick={exportAgents} title="Exporter les agents"><DownloadSimple size={15} /></Button>
        <Button plain onClick={importAgents} title="Importer des agents"><UploadSimple size={15} /></Button>
        <Button color="blue" onClick={() => { setEditingAgent(undefined); setShowForm(true); }}>
          <Plus size={14} weight="bold" /> Nouvel agent
        </Button>
      </div>

      {agents.length > 3 && (
        <div className="mb-4">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher un agent..."
          />
        </div>
      )}

      {agents.length === 0 ? (
        <EmptyState icon={<Robot size={40} />} title="Aucun agent pour l'instant" sub="Crée un agent avec un modèle, des instructions et des outils dédiés, puis lance une conversation pré-configurée en un clic." />
      ) : (
        <motion.div layout className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
          <AnimatePresence mode="popLayout">
            {filteredAgents.map((a) => (
              <AgentCard
                key={a.id}
                agent={a}
                modelMissing={models.length > 0 && !knownModelNames.has(a.model.split(":")[0])}
                onLaunch={launchAgent}
                onEdit={(agent) => { setEditingAgent(agent); setShowForm(true); }}
                onDelete={confirmDeleteAgent}
              />
            ))}
          </AnimatePresence>
        </motion.div>
      )}
      {agents.length > 3 && filteredAgents.length === 0 && (
        <EmptyState icon={<MagnifyingGlass size={32} />} sub={`Aucun agent ne correspond à "${search}".`} />
      )}

      <SectionHeader
        icon={<FlowArrow size={18} />}
        title="Workflows"
        action={<Button outline onClick={newWorkflow}><Plus size={14} weight="bold" /> Nouveau workflow</Button>}
      />

      {workflows.length === 0 ? (
        <EmptyState icon={<FlowArrow size={32} />} sub="Enchaîne plusieurs agents dans un canevas visuel : la sortie de l'un devient l'entrée du suivant." />
      ) : (
        <motion.div layout className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
          <AnimatePresence mode="popLayout">
            {workflows.map((w) => (
              <motion.div
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96 }}
                whileHover={{ y: -3 }}
                key={w.id}
                className="group relative cursor-pointer rounded-2xl border border-zinc-950/8 bg-white p-4 shadow-sm hover:shadow-lg dark:border-white/10 dark:bg-zinc-800/60"
                onClick={() => navigate({ to: "/workflows/$workflowId", params: { workflowId: w.id } })}
              >
                <button
                  onClick={(e) => { e.stopPropagation(); confirmDeleteWorkflow(w.id, w.name); }}
                  className="absolute right-2.5 top-2.5 rounded-md p-1.5 text-red-400 opacity-0 transition-opacity hover:bg-red-500/10 hover:text-red-600 group-hover:opacity-100"
                  title="Supprimer le workflow"
                >
                  <Trash size={14} />
                </button>
                <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-orange-500/15 text-xl">🔀</div>
                <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{w.name}</div>
                <div className="font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
                  {w.nodes.length} étape(s){stats.workflows[w.id] ? ` · ${stats.workflows[w.id].runs} lancement(s)` : ""}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>
      )}

      {(agents.length > 0 || workflows.length > 0) && (
        <>
          <SectionHeader icon={undefined} title="Utilisation" />
          <div className="flex flex-col gap-1">
            {agents.map((a) => (
              <div key={a.id} className="flex items-center justify-between rounded-lg bg-zinc-950/3 px-3 py-2 text-xs dark:bg-white/5">
                <span className="text-zinc-700 dark:text-zinc-300">{a.emoji} {a.name}</span>
                <span className="text-zinc-500 dark:text-zinc-400">
                  {stats.agents[a.id]?.runs ?? 0} lancement(s)
                  {stats.agents[a.id]?.lastRun ? ` · dernier : ${new Date(stats.agents[a.id].lastRun).toLocaleString("fr-FR")}` : ""}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      <AnimatePresence>
        {showForm && <AgentForm key="agent-form" editing={editingAgent} onClose={() => setShowForm(false)} />}
      </AnimatePresence>
    </div>
  );
}

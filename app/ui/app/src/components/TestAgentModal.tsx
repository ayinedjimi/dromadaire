import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { CircleNotch, PaperPlaneRight, Warning, X } from "@phosphor-icons/react";
import { sendMessage } from "@/api";
import { Model } from "@/gotypes";
import type { Agent } from "@/hooks/useAgents";
import { useSettings } from "@/hooks/useSettings";
import { Button } from "@/components/ui/button";

// Dromadaire: quick inline agent test — sends one incognito message using the
// agent's model/prompt/tools without navigating to the main chat or touching
// chat history. System prompt has no per-message override (see api.ts's
// ChatRequest), so we swap Settings in for the duration of the call and
// restore whatever was active before, same pattern as workflowRunner.ts.
export function TestAgentModal({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const { settingsData, setSettings } = useSettings();
  const [prompt, setPrompt] = useState("");
  const [output, setOutput] = useState("");
  const [running, setRunning] = useState(false);
  const [loadingModel, setLoadingModel] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const run = async () => {
    if (!prompt.trim() || running) return;
    setRunning(true);
    setLoadingModel(false);
    setOutput("");
    setError(null);
    const abortController = new AbortController();
    abortRef.current = abortController;

    const previous = settingsData;
    try {
      await setSettings({
        SelectedModel: agent.model,
        SystemPrompt: agent.systemPrompt,
        WebSearchEnabled: agent.webSearch,
        RAGEnabled: agent.rag,
        Agent: agent.taskExecution,
      });

      const model = new Model({ model: agent.model });
      for await (const event of sendMessage(
        "new",
        prompt,
        model,
        undefined,
        abortController.signal,
        undefined,
        agent.webSearch,
        false,
        undefined,
        undefined,
        true, // incognito — never written to chat history
      )) {
        if (event.eventName === "loading") {
          // Backend sends this right before loading the model into RAM —
          // can take seconds to minutes on CPU. Distinct from generating.
          setLoadingModel(true);
        } else if (event.eventName === "chat" && event.content) {
          setLoadingModel(false);
          setOutput((prev) => prev + event.content);
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        setError("Annulé.");
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (previous) {
        await setSettings({
          SelectedModel: previous.SelectedModel,
          SystemPrompt: previous.SystemPrompt,
          WebSearchEnabled: previous.WebSearchEnabled,
          RAGEnabled: previous.RAGEnabled,
          Agent: previous.Agent,
        });
      }
      setRunning(false);
    }
  };

  const close = () => {
    abortRef.current?.abort();
    onClose();
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-100 flex items-center justify-center bg-black/40 p-4"
      onClick={close}
    >
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.98 }}
        transition={{ duration: 0.18, ease: [0.165, 0.85, 0.45, 1] }}
        className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 border-b border-zinc-950/8 px-5 py-4 dark:border-white/10">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-lg" style={{ background: `${agent.color}1f` }}>
            {agent.emoji}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">Tester {agent.name}</div>
            <div className="truncate font-mono text-[11px] text-zinc-500 dark:text-zinc-400">{agent.model}</div>
          </div>
          <button onClick={close} className="rounded-full p-1.5 text-zinc-400 hover:bg-zinc-950/5 hover:text-zinc-700 dark:hover:bg-white/10 dark:hover:text-zinc-200">
            <X size={16} />
          </button>
        </div>

        <p className="border-b border-zinc-950/8 px-5 py-2.5 text-xs text-zinc-500 dark:border-white/10 dark:text-zinc-400">
          N'affecte ni ton historique ni tes réglages actuels. Peut prendre 1 à 2 minutes sur CPU selon le modèle.
        </p>

        <div className="min-h-32 flex-1 overflow-y-auto whitespace-pre-wrap px-5 py-4 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
          {error ? (
            <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-xs text-red-600 dark:text-red-400">
              <Warning size={14} className="mt-0.5 shrink-0" /> {error}
            </div>
          ) : output ? (
            output
          ) : running && loadingModel ? (
            <div className="flex flex-col gap-2.5">
              <span className="flex items-center gap-2 text-zinc-400 dark:text-zinc-500">
                <CircleNotch size={14} className="animate-spin" />
                ⏳ Chargement du modèle en mémoire... (peut prendre plusieurs minutes sur CPU la première fois)
              </span>
              <div className="h-1 w-full overflow-hidden rounded-full bg-amber-500/15">
                <div className="animate-indeterminate-bar h-full w-1/3 rounded-full bg-amber-500" />
              </div>
            </div>
          ) : running ? (
            <span className="flex items-center gap-2 text-zinc-400 dark:text-zinc-500">
              <CircleNotch size={14} className="animate-spin" />
              Le modèle réfléchit... (peut prendre plusieurs minutes sur CPU)
            </span>
          ) : (
            <span className="text-zinc-400 dark:text-zinc-500">Écris un message ci-dessous pour tester cet agent.</span>
          )}
        </div>

        <div className="flex items-end gap-2 border-t border-zinc-950/8 p-3 dark:border-white/10">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                run();
              }
            }}
            placeholder="Message de test..."
            rows={2}
            autoFocus
            className="block w-full resize-none rounded-lg border border-zinc-950/10 bg-transparent px-3.5 py-2.5 text-sm text-zinc-950 placeholder:text-zinc-500 focus:outline-hidden focus:ring-2 focus:ring-blue-500 dark:border-white/10 dark:bg-white/5 dark:text-white"
          />
          {running ? (
            <Button color="amber" onClick={() => abortRef.current?.abort()}>Annuler</Button>
          ) : (
            <Button color="blue" disabled={!prompt.trim()} onClick={run}>
              <PaperPlaneRight size={14} weight="fill" />
            </Button>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

import { useState, useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import {
  MagnifyingGlass, Download, Check, CircleNotch, WifiHigh,
  ShieldCheck, ArrowLeft, HardDrive, Warning, ArrowsClockwise,
  Trash, CaretDown, CaretUp, Globe, Star, Cpu, Memory
} from "@phosphor-icons/react";
import { API_BASE } from "@/lib/config";
import { useSystemResources } from "@/hooks/useSystemResources";

interface ModelEntry {
  name: string;
  displayName: string;
  params: string;
  description: string;
  arch: string;
  tags: string[];
  sizeBytes?: number;
  author?: string;
  downloads?: number;
  hfId?: string;
}

const CURATED_MODELS: ModelEntry[] = [
  // === Légers (1-4B) — idéal 8-16GB RAM ===
  { name: "phi4-mini", displayName: "Phi-4 Mini", params: "3.8B", description: "Microsoft. Compact et performant. Excellent rapport qualité/taille pour CPU.", arch: "Phi", tags: ["chat", "code", "rapide"] },
  { name: "llama3.2:3b", displayName: "Llama 3.2", params: "3B", description: "Meta AI. Très bon en français et en raisonnement pour sa taille.", arch: "Llama", tags: ["chat", "multilingue"] },
  { name: "llama3.2:1b", displayName: "Llama 3.2", params: "1B", description: "Meta AI ultra-léger. Réponses instantanées, idéal 8GB RAM.", arch: "Llama", tags: ["chat", "léger"] },
  { name: "gemma3:4b", displayName: "Gemma 3", params: "4B", description: "Google DeepMind. Excellent en multilingue et instruction following.", arch: "Gemma", tags: ["chat", "multilingue"] },
  { name: "gemma3:1b", displayName: "Gemma 3", params: "1B", description: "Google DeepMind. Ultra-léger, bon pour test rapide.", arch: "Gemma", tags: ["chat", "léger"] },
  { name: "qwen3:4b", displayName: "Qwen 3", params: "4B", description: "Alibaba. Très fort en raisonnement et en code.", arch: "Qwen", tags: ["chat", "code", "raisonnement"] },
  { name: "qwen3:1.7b", displayName: "Qwen 3", params: "1.7B", description: "Alibaba compact. Rapide avec un bon niveau pour sa taille.", arch: "Qwen", tags: ["chat", "rapide"] },
  { name: "qwen3:0.6b", displayName: "Qwen 3", params: "0.6B", description: "Alibaba nano. Le plus petit modèle Qwen.", arch: "Qwen", tags: ["chat", "léger"] },
  { name: "deepseek-r1:1.5b", displayName: "DeepSeek R1", params: "1.5B", description: "DeepSeek compact avec raisonnement. Ultra-rapide sur CPU.", arch: "DeepSeek", tags: ["raisonnement", "léger"] },
  { name: "smollm2:1.7b", displayName: "SmolLM 2", params: "1.7B", description: "HuggingFace. Petit mais capable. Bon en instruction following.", arch: "SmolLM", tags: ["chat", "léger"] },
  { name: "tinyllama", displayName: "TinyLlama", params: "1.1B", description: "Entraîné sur 3T tokens. Le plus léger des Llama.", arch: "Llama", tags: ["chat", "léger"] },
  { name: "granite3.1-dense:2b", displayName: "Granite 3.1", params: "2B", description: "IBM. Modèle entreprise compact. Bon en instruction.", arch: "Granite", tags: ["chat", "code"] },
  { name: "stablelm2:1.6b", displayName: "StableLM 2", params: "1.6B", description: "Stability AI. Bon en conversation générale.", arch: "StableLM", tags: ["chat", "léger"] },
  // === Moyens (7-8B) — 16GB RAM recommandé ===
  { name: "mistral:7b", displayName: "Mistral", params: "7B", description: "Mistral AI (France). Excellent en français. Nécessite 8GB+ libres.", arch: "Mistral", tags: ["chat", "français"] },
  { name: "llama3.1:8b", displayName: "Llama 3.1", params: "8B", description: "Meta AI. Version améliorée avec long context (128K).", arch: "Llama", tags: ["chat", "multilingue"] },
  { name: "gemma3:12b", displayName: "Gemma 3", params: "12B", description: "Google. Vision + texte. Le meilleur rapport qualité/taille en multimodal.", arch: "Gemma", tags: ["chat", "vision", "multilingue"] },
  { name: "qwen3:8b", displayName: "Qwen 3", params: "8B", description: "Alibaba. Excellent en raisonnement et code. Support tool calling.", arch: "Qwen", tags: ["chat", "code", "raisonnement"] },
  { name: "deepseek-r1:7b", displayName: "DeepSeek R1", params: "7B", description: "DeepSeek. Chain-of-thought intégré, raisonnement avancé.", arch: "DeepSeek", tags: ["raisonnement", "code"] },
  { name: "mistral-nemo", displayName: "Mistral Nemo", params: "12B", description: "Mistral + NVIDIA. 128K contexte, excellent en multilingue.", arch: "Mistral", tags: ["chat", "multilingue"] },
  { name: "phi4:14b", displayName: "Phi-4", params: "14B", description: "Microsoft. Très bon en maths et raisonnement scientifique.", arch: "Phi", tags: ["chat", "raisonnement", "maths"] },
  { name: "granite3.1-dense:8b", displayName: "Granite 3.1", params: "8B", description: "IBM. Modèle entreprise, bon en résumé et extraction.", arch: "Granite", tags: ["chat", "code"] },
  { name: "yi:9b", displayName: "Yi 1.5", params: "9B", description: "01.AI. Fort en chinois et anglais. Bon raisonnement.", arch: "Yi", tags: ["chat", "multilingue"] },
  { name: "solar:10.7b", displayName: "Solar", params: "10.7B", description: "Upstage. Modèle coréen, fort en instruction following.", arch: "Solar", tags: ["chat", "multilingue"] },
  { name: "internlm2:7b", displayName: "InternLM 2", params: "7B", description: "Shanghai AI Lab. Bon en chinois/anglais, tool calling.", arch: "InternLM", tags: ["chat", "code"] },
  { name: "vicuna:7b", displayName: "Vicuna", params: "7B", description: "LMSYS. Fine-tuné sur conversations. Classique fiable.", arch: "Llama", tags: ["chat"] },
  { name: "neural-chat:7b", displayName: "Neural Chat", params: "7B", description: "Intel. Optimisé pour les conversations naturelles.", arch: "Mistral", tags: ["chat"] },
  { name: "openchat:7b", displayName: "OpenChat 3.5", params: "7B", description: "OpenChat. Fine-tuning C-RLFT sur Mistral. Très bon.", arch: "Mistral", tags: ["chat"] },
  { name: "zephyr:7b", displayName: "Zephyr", params: "7B", description: "HuggingFace. DPO-tuned Mistral. Bon en instruction.", arch: "Mistral", tags: ["chat"] },
  // === Code ===
  { name: "codellama:7b", displayName: "Code Llama", params: "7B", description: "Meta AI spécialisé code. Complétion et génération de code.", arch: "Llama", tags: ["code"] },
  { name: "starcoder2:3b", displayName: "StarCoder 2", params: "3B", description: "BigCode. Spécialisé code, 600+ langages. Compact.", arch: "StarCoder", tags: ["code", "rapide"] },
  { name: "starcoder2:7b", displayName: "StarCoder 2", params: "7B", description: "BigCode. Code generation amélioré, multilingue.", arch: "StarCoder", tags: ["code"] },
  { name: "codegemma:7b", displayName: "CodeGemma", params: "7B", description: "Google. Spécialisé code, completion et chat.", arch: "Gemma", tags: ["code"] },
  { name: "deepseek-coder-v2:16b", displayName: "DeepSeek Coder V2", params: "16B", description: "DeepSeek. Expert code. MoE léger, 128K contexte.", arch: "DeepSeek", tags: ["code", "raisonnement"] },
  { name: "qwen2.5-coder:7b", displayName: "Qwen 2.5 Coder", params: "7B", description: "Alibaba. Spécialisé code, multi-langages.", arch: "Qwen", tags: ["code"] },
  { name: "qwen2.5-coder:1.5b", displayName: "Qwen 2.5 Coder", params: "1.5B", description: "Alibaba. Code compact. Rapide pour autocomplétion.", arch: "Qwen", tags: ["code", "léger"] },
  { name: "codestral", displayName: "Codestral", params: "22B", description: "Mistral. Dédié code. 80+ langages. 32K contexte.", arch: "Mistral", tags: ["code"] },
  // === Raisonnement ===
  { name: "deepseek-r1:8b", displayName: "DeepSeek R1", params: "8B", description: "DeepSeek. Raisonnement chain-of-thought. Bon en maths.", arch: "DeepSeek", tags: ["raisonnement", "maths"] },
  { name: "deepseek-r1:14b", displayName: "DeepSeek R1", params: "14B", description: "DeepSeek. Raisonnement avancé. Nécessite 16GB+ libres.", arch: "DeepSeek", tags: ["raisonnement", "maths"] },
  { name: "qwq", displayName: "QwQ", params: "32B", description: "Alibaba. Raisonnement o1-like. Très puissant mais lourd.", arch: "Qwen", tags: ["raisonnement", "maths"] },
  // === Vision (multimodal) ===
  { name: "llava:7b", displayName: "LLaVA", params: "7B", description: "Vision + texte. Analyse d'images. Basé sur Llama.", arch: "Llama", tags: ["vision", "chat"] },
  { name: "llava:13b", displayName: "LLaVA", params: "13B", description: "Vision + texte. Meilleure compréhension d'images.", arch: "Llama", tags: ["vision", "chat"] },
  { name: "bakllava", displayName: "BakLLaVA", params: "7B", description: "Vision améliorée. Basé sur Mistral + BakLLaVA.", arch: "Mistral", tags: ["vision", "chat"] },
  { name: "moondream:1.8b", displayName: "Moondream", params: "1.8B", description: "Tiny vision model. Ultra-rapide pour OCR/description.", arch: "Moondream", tags: ["vision", "léger"] },
  { name: "minicpm-v", displayName: "MiniCPM-V", params: "8B", description: "OpenBMB. Vision+texte compact et performant.", arch: "MiniCPM", tags: ["vision", "chat"] },
  // === Embeddings ===
  { name: "nomic-embed-text", displayName: "Nomic Embed", params: "137M", description: "Embeddings texte pour RAG/recherche sémantique.", arch: "Nomic", tags: ["embedding", "RAG"] },
  { name: "snowflake-arctic-embed:33m", displayName: "Arctic Embed", params: "33M", description: "Snowflake. Embeddings ultra-léger, optimal CPU. Utilisé par Dromadaire RAG.", arch: "Arctic", tags: ["embedding", "RAG", "léger"] },
  { name: "mxbai-embed-large", displayName: "MxBAI Embed", params: "335M", description: "mixedbread.ai. Embeddings haute qualité pour RAG.", arch: "BERT", tags: ["embedding", "RAG"] },
  { name: "all-minilm", displayName: "All-MiniLM", params: "23M", description: "Sentence Transformers. Le plus léger pour embeddings.", arch: "BERT", tags: ["embedding", "RAG", "léger"] },
  // === Non censuré ===
  { name: "dolphin-mistral:7b", displayName: "Dolphin Mistral", params: "7B", description: "Cognitive Computations. Non censuré. Basé sur Mistral.", arch: "Mistral", tags: ["chat", "non-censuré"] },
  { name: "dolphin-llama3:8b", displayName: "Dolphin Llama 3", params: "8B", description: "Cognitive Computations. Non censuré. Basé sur Llama 3.", arch: "Llama", tags: ["chat", "non-censuré"] },
  { name: "nous-hermes2:7b", displayName: "Nous Hermes 2", params: "7B", description: "Nous Research. Fort en instruction, data science.", arch: "Mistral", tags: ["chat", "code"] },
  // === Spécialisés ===
  { name: "meditron:7b", displayName: "Meditron", params: "7B", description: "EPFL. Spécialisé médical. Chat clinique.", arch: "Llama", tags: ["médical"] },
  { name: "wizard-math:7b", displayName: "WizardMath", params: "7B", description: "Microsoft. Spécialisé mathématiques.", arch: "Llama", tags: ["maths"] },
  { name: "samantha-mistral:7b", displayName: "Samantha", params: "7B", description: "Personnalité empathique. Companion AI.", arch: "Mistral", tags: ["chat", "roleplay"] },
];

const ARCH_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  Phi:       { bg: "bg-sky-50 dark:bg-sky-950/40",       text: "text-sky-600 dark:text-sky-400",       border: "border-sky-200 dark:border-sky-800/60" },
  Llama:     { bg: "bg-blue-50 dark:bg-blue-950/40",     text: "text-blue-600 dark:text-blue-400",     border: "border-blue-200 dark:border-blue-800/60" },
  Gemma:     { bg: "bg-emerald-50 dark:bg-emerald-950/40", text: "text-emerald-600 dark:text-emerald-400", border: "border-emerald-200 dark:border-emerald-800/60" },
  Qwen:      { bg: "bg-violet-50 dark:bg-violet-950/40", text: "text-violet-600 dark:text-violet-400", border: "border-violet-200 dark:border-violet-800/60" },
  Mistral:   { bg: "bg-cyan-50 dark:bg-cyan-950/40",     text: "text-cyan-600 dark:text-cyan-400",     border: "border-cyan-200 dark:border-cyan-800/60" },
  DeepSeek:  { bg: "bg-indigo-50 dark:bg-indigo-950/40", text: "text-indigo-600 dark:text-indigo-400", border: "border-indigo-200 dark:border-indigo-800/60" },
  StarCoder: { bg: "bg-amber-50 dark:bg-amber-950/40",   text: "text-amber-600 dark:text-amber-400",   border: "border-amber-200 dark:border-amber-800/60" },
  Nomic:     { bg: "bg-rose-50 dark:bg-rose-950/40",     text: "text-rose-600 dark:text-rose-400",     border: "border-rose-200 dark:border-rose-800/60" },
  Arctic:    { bg: "bg-teal-50 dark:bg-teal-950/40",     text: "text-teal-600 dark:text-teal-400",     border: "border-teal-200 dark:border-teal-800/60" },
};

function guessArch(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("llama")) return "Llama";
  if (n.includes("mistral") || n.includes("mixtral")) return "Mistral";
  if (n.includes("gemma")) return "Gemma";
  if (n.includes("qwen")) return "Qwen";
  if (n.includes("phi")) return "Phi";
  if (n.includes("deepseek")) return "DeepSeek";
  if (n.includes("starcoder") || n.includes("codellama")) return "StarCoder";
  if (n.includes("nomic") || n.includes("embed") || n.includes("arctic")) return "Nomic";
  if (n.includes("falcon")) return "Falcon";
  if (n.includes("yi")) return "Yi";
  return "Other";
}

function formatSize(bytes: number): string {
  if (!bytes) return "";
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
  return `${(bytes / 1e3).toFixed(0)} KB`;
}

function estimateRamFromParams(params: string): number {
  if (!params) return 0;
  const match = params.match(/([\d.]+)\s*([BMbm])/i);
  if (!match) return 0;
  const value = parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  const billions = unit === "M" ? value / 1000 : value;
  // Q4_K_M: ~0.6 GB per billion params (weights + KV overhead)
  return billions * 0.6 * 1e9;
}

function getEstimatedRam(model: ModelEntry): number {
  if (model.sizeBytes && model.sizeBytes > 1e6) return model.sizeBytes;
  return estimateRamFromParams(model.params);
}

type HwCompat = "perfect" | "ok" | "tight" | "too-large";

function getHardwareCompat(estimatedBytes: number, availableBytes: number, totalBytes: number): HwCompat {
  if (!estimatedBytes || !totalBytes) return "ok";
  const needed = estimatedBytes * 1.2; // 20% overhead for runtime
  if (needed > totalBytes * 0.85) return "too-large";
  if (needed > availableBytes) return "tight";
  if (needed < availableBytes * 0.5) return "perfect";
  return "ok";
}


function extractModelDisplayName(modelName: string): string {
  const base = modelName.split(":")[0];
  return base
    .replace(/-/g, " ")
    .replace(/\b\w/g, l => l.toUpperCase());
}

type DownloadState = "idle" | "pulling" | "done" | "error";

interface DownloadProgress {
  status: string;
  completed: number;
  total: number;
  percent: number;
}

interface OllamaModel {
  name: string;
  digest: string;
  size: number;
  modified_at: string;
  details?: { families?: string[]; parameter_size?: string; quantization_level?: string };
}

interface RefreshStep {
  label: string;
  status: "pending" | "running" | "done" | "error";
  detail?: string;
}

interface RefreshModalState {
  open: boolean;
  steps: RefreshStep[];
  showGoOnline?: boolean;
}

async function fetchOllamaModels(): Promise<OllamaModel[]> {
  const resp = await fetch(`${API_BASE}/api/tags`);
  if (!resp.ok) throw new Error(`Erreur serveur : HTTP ${resp.status}`);
  const data = await resp.json();
  return data.models || [];
}

function ollamaToEntry(m: OllamaModel): ModelEntry {
  const name = m.name.replace(/:latest$/, "");
  const exactCurated = CURATED_MODELS.find(c => c.name === name);
  const baseCurated = !exactCurated ? CURATED_MODELS.find(c => c.name.split(":")[0] === name.split(":")[0]) : undefined;
  const arch = exactCurated?.arch || baseCurated?.arch || guessArch(name);
  const paramsFromDetails = m.details?.parameter_size;
  const paramsFromName = name.match(/(?::|\b)(\d+(?:\.\d+)?[bBmM])\b/);
  const params = exactCurated?.params || paramsFromDetails || (paramsFromName ? paramsFromName[1].toUpperCase() : "");
  return {
    name,
    displayName: exactCurated?.displayName || extractModelDisplayName(name),
    params,
    description: exactCurated?.description || "",
    arch,
    tags: exactCurated?.tags || baseCurated?.tags || [],
    sizeBytes: m.size || 0,
  };
}

export function ModelDiscovery({ onBack }: { onBack: () => void }) {
  const { data: sysMem } = useSystemResources();
  const [installedRaw, setInstalledRaw] = useState<OllamaModel[]>([]);
  const [search, setSearch] = useState("");
  const [onlineMode, setOnlineMode] = useState(false);
  const [preset, setPreset] = useState<"all" | "abliterated" | "compatible">("all");
  const [onlineResults, setOnlineResults] = useState<ModelEntry[]>([]);
  const [onlineLoading, setOnlineLoading] = useState(false);
  const [refreshModal, setRefreshModal] = useState<RefreshModalState>({ open: false, steps: [] });
  const [showInstalled, setShowInstalled] = useState(true);
  const [showRecommended, setShowRecommended] = useState(true);
  const [downloads, setDownloads] = useState<Map<string, { state: DownloadState; progress: DownloadProgress }>>(new Map());
  const [deleting, setDeleting] = useState<Set<string>>(new Set());
  const availableRam = sysMem?.availableBytes || 0;
  const totalRam = sysMem?.totalBytes || 0;
  const initialLoadDone = useRef(false);
  const refreshRunning = useRef(false);

  const loadModels = useCallback(async () => {
    try {
      const models = await fetchOllamaModels();
      setInstalledRaw(models);
      return models;
    } catch (err) {
      throw err;
    }
  }, []);

  useEffect(() => {
    if (!initialLoadDone.current) {
      initialLoadDone.current = true;
      loadModels();
    }
  }, [loadModels]);

  const installedEntries: ModelEntry[] = installedRaw.map(ollamaToEntry);

  const installedNames = new Set(installedEntries.map(m => m.name));
  const installedBaseNames = new Set(installedEntries.map(m => m.name.split(":")[0]));

  const isInstalled = (name: string): boolean => {
    const cleaned = name.replace(/:latest$/, "");
    return installedNames.has(cleaned) || installedNames.has(cleaned.split(":")[0]) || installedBaseNames.has(cleaned.split(":")[0]);
  };

  const recommendedNotInstalled = CURATED_MODELS.filter(m => !isInstalled(m.name));

  const filterModels = (models: ModelEntry[]) => {
    if (!search.trim()) return models;
    const q = search.toLowerCase();
    return models.filter(m =>
      m.displayName.toLowerCase().includes(q) ||
      m.name.toLowerCase().includes(q) ||
      m.description.toLowerCase().includes(q) ||
      m.tags.some(t => t.includes(q)) ||
      m.arch.toLowerCase().includes(q)
    );
  };

  const filteredInstalled = filterModels(installedEntries);
  const filteredRecommended = filterModels(recommendedNotInstalled);
  // Préréglage « compatibles » : on retire les modèles estimés trop gros pour la RAM disponible.
  const visibleOnline = preset === "compatible"
    ? onlineResults.filter(m => getHardwareCompat(getEstimatedRam(m), availableRam, totalRam) !== "too-large")
    : onlineResults;

  const parseHfModels = useCallback((data: any[]): ModelEntry[] => {
    return data.map((m: any) => {
      const ggufFiles = (m.siblings || []).filter((s: any) => s.rfilename?.endsWith(".gguf"));
      const recommendedFile = ggufFiles.find((f: any) => /Q4_K_M/i.test(f.rfilename))
        || ggufFiles.find((f: any) => /Q4_K_S/i.test(f.rfilename))
        || ggufFiles[0];
      const sizeBytes = recommendedFile?.size || 0;
      const modelName = m.modelId?.split("/").pop() || m.id?.split("/").pop() || "";
      const paramsMatch = modelName.match(/(\d+(?:\.\d+)?)[bB]/i);
      return {
        name: m.modelId || m.id,
        displayName: modelName.replace(/-GGUF$/i, "").replace(/-/g, " "),
        params: paramsMatch ? `${paramsMatch[1]}B` : "",
        description: m.description || m.pipeline_tag || "",
        arch: guessArch(modelName),
        tags: (m.tags || []).slice(0, 4),
        sizeBytes,
        author: m.author || m.modelId?.split("/")[0] || m.id?.split("/")[0] || "",
        downloads: m.downloads || 0,
        hfId: m.modelId || m.id,
      };
    });
  }, []);

  const fetchOllamaLibrary = useCallback(async (): Promise<ModelEntry[]> => {
    try {
      const resp = await fetch("https://ollama.com/api/tags", { signal: AbortSignal.timeout(8000) });
      if (!resp.ok) return [];
      const data = await resp.json();
      return (data.models || []).map((m: any) => ({
        name: m.name || m.model,
        displayName: extractModelDisplayName(m.name || m.model),
        params: m.details?.parameter_size || "",
        description: "",
        arch: guessArch(m.name || m.model),
        tags: ["ollama"],
        sizeBytes: m.size || 0,
        author: "ollama",
        downloads: 0,
      }));
    } catch { return []; }
  }, []);

  const fetchTrendingModels = useCallback(async (): Promise<ModelEntry[]> => {
    const [ollamaModels, hfModels] = await Promise.allSettled([
      fetchOllamaLibrary(),
      fetch("https://huggingface.co/api/models?filter=gguf&sort=downloads&direction=-1&limit=50", { signal: AbortSignal.timeout(10000) })
        .then(r => r.ok ? r.json() : [])
        .then((data: any[]) => parseHfModels(data))
        .catch(() => [] as ModelEntry[]),
    ]);
    const ollama = ollamaModels.status === "fulfilled" ? ollamaModels.value : [];
    const hf = hfModels.status === "fulfilled" ? hfModels.value : [];
    const seen = new Set<string>();
    const combined: ModelEntry[] = [];
    for (const m of [...ollama, ...hf]) {
      const key = m.name.split(":")[0].toLowerCase();
      if (!seen.has(key)) { seen.add(key); combined.push(m); }
    }
    return combined;
  }, [parseHfModels, fetchOllamaLibrary]);

  const searchOnline = useCallback(async (rawQuery: string, mode: "all" | "abliterated" | "compatible" = preset) => {
    // Préréglage « abliterated » : la recherche porte sur ce mot-clé (modèles sans censure).
    const query = mode === "abliterated" ? (rawQuery.trim() ? `${rawQuery.trim()} abliterated` : "abliterated") : rawQuery;
    if (!query.trim()) {
      setOnlineLoading(true);
      try {
        const results = await fetchTrendingModels();
        setOnlineResults(results);
      } catch {
        setOnlineResults([]);
      }
      setOnlineLoading(false);
      return;
    }
    setOnlineLoading(true);
    try {
      const resp = await fetch(
        `https://huggingface.co/api/models?search=${encodeURIComponent(query)}&filter=gguf&sort=downloads&direction=-1&limit=30`,
        { signal: AbortSignal.timeout(10000) }
      );
      if (!resp.ok) throw new Error("HuggingFace API error");
      const data: any[] = await resp.json();
      setOnlineResults(parseHfModels(data));
    } catch {
      setOnlineResults([]);
    }
    setOnlineLoading(false);
  }, [parseHfModels, fetchTrendingModels, preset]);

  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (!onlineMode) return;
    clearTimeout(searchTimeoutRef.current);
    if (!search.trim()) {
      searchOnline("");
    } else {
      searchTimeoutRef.current = setTimeout(() => searchOnline(search), 500);
    }
    return () => clearTimeout(searchTimeoutRef.current);
  }, [search, onlineMode, searchOnline]);

  const handleRefresh = useCallback(async () => {
    if (refreshRunning.current) return;
    refreshRunning.current = true;

    const steps: RefreshStep[] = [
      { label: "Interrogation du serveur Ollama local", status: "running" },
      { label: "Vérification de la connexion Internet", status: "pending" },
      { label: "Découverte de modèles sur HuggingFace", status: "pending" },
    ];
    setRefreshModal({ open: true, steps: [...steps] });

    // Step 1: local models
    try {
      const models = await fetchOllamaModels();
      setInstalledRaw(models);
      steps[0] = { ...steps[0], status: "done", detail: `${models.length} modèle${models.length > 1 ? "s" : ""} installé${models.length > 1 ? "s" : ""} localement` };
    } catch (err) {
      steps[0] = { ...steps[0], status: "error", detail: `Erreur : ${err instanceof Error ? err.message : String(err)}` };
      steps[1] = { ...steps[1], status: "error", detail: "Annulé — le serveur local est inaccessible" };
      steps[2] = { ...steps[2], status: "error", detail: "Annulé" };
      setRefreshModal({ open: true, steps: [...steps] });
      refreshRunning.current = false;
      return;
    }

    // Step 2: online check
    steps[1] = { ...steps[1], status: "running" };
    setRefreshModal({ open: true, steps: [...steps] });

    let internetAvailable = false;
    try {
      const resp = await fetch("https://huggingface.co/api/models?limit=1", { signal: AbortSignal.timeout(5000) });
      internetAvailable = resp.ok;
      if (resp.ok) {
        steps[1] = { ...steps[1], status: "done", detail: "Connexion à HuggingFace établie" };
      } else {
        steps[1] = { ...steps[1], status: "error", detail: `HuggingFace a répondu HTTP ${resp.status}` };
      }
    } catch {
      steps[1] = { ...steps[1], status: "done", detail: "Pas de connexion Internet — seuls les modèles locaux sont disponibles" };
    }
    setRefreshModal({ open: true, steps: [...steps] });

    // Step 3: discover online models
    if (internetAvailable) {
      steps[2] = { ...steps[2], status: "running" };
      setRefreshModal({ open: true, steps: [...steps] });

      try {
        const results = await fetchTrendingModels();
        setOnlineResults(results);
        if (!onlineMode) setOnlineMode(true);
        steps[2] = { ...steps[2], status: "done", detail: `${results.length} modèles GGUF populaires découverts` };
        setRefreshModal({ open: true, steps: [...steps] });
      } catch (err) {
        steps[2] = { ...steps[2], status: "error", detail: `Erreur : ${err instanceof Error ? err.message : String(err)}` };
        setRefreshModal({ open: true, steps: [...steps] });
      }
    } else {
      steps[2] = { ...steps[2], status: "done", detail: "Hors ligne — découverte désactivée" };
      setRefreshModal({ open: true, steps: [...steps], showGoOnline: false });
    }
    refreshRunning.current = false;
  }, [onlineMode, fetchTrendingModels]);

  const pullModel = useCallback(async (modelName: string) => {
    setDownloads(prev => new Map(prev).set(modelName, { state: "pulling", progress: { status: "Initialisation…", completed: 0, total: 0, percent: 0 } }));

    const pullName = modelName.includes("/") ? `hf.co/${modelName}` : modelName;
    try {
      const resp = await fetch(`${API_BASE}/api/pull`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: pullName, stream: true }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const j = JSON.parse(line);
            const completed = j.completed || 0;
            const total = j.total || 0;
            const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
            setDownloads(prev => new Map(prev).set(modelName, {
              state: "pulling",
              progress: { status: j.status || "Téléchargement…", completed, total, percent }
            }));
          } catch { /* skip bad JSON lines */ }
        }
      }
      setDownloads(prev => new Map(prev).set(modelName, { state: "done", progress: { status: "Terminé", completed: 1, total: 1, percent: 100 } }));
      await loadModels();
    } catch (err) {
      setDownloads(prev => new Map(prev).set(modelName, { state: "error", progress: { status: String(err), completed: 0, total: 0, percent: 0 } }));
    }
  }, [loadModels]);

  const deleteModel = useCallback(async (modelName: string) => {
    setDeleting(prev => new Set(prev).add(modelName));
    try {
      await fetch(`${API_BASE}/api/delete`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: modelName }),
      });
      await loadModels();
    } catch { /* ignore */ }
    setDeleting(prev => { const s = new Set(prev); s.delete(modelName); return s; });
  }, [loadModels]);

  return (
    <div className="flex flex-col h-full bg-white dark:bg-neutral-900">

      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-neutral-100 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-800/30">
        <button
          onClick={onBack}
          className="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-neutral-200/60 dark:hover:bg-neutral-700/60 text-neutral-500 dark:text-neutral-400 transition-colors cursor-pointer"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-[15px] font-semibold text-neutral-800 dark:text-neutral-100">Modèles</h1>
          <p className="text-[11px] text-neutral-400 dark:text-neutral-500">
            {installedRaw.length} installé{installedRaw.length > 1 ? "s" : ""}
            {recommendedNotInstalled.length > 0 && ` · ${recommendedNotInstalled.length} recommandé${recommendedNotInstalled.length > 1 ? "s" : ""}`}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Refresh button */}
          <button
            onClick={handleRefresh}
            disabled={refreshRunning.current}
            className="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-neutral-200/60 dark:hover:bg-neutral-700/60 text-neutral-400 dark:text-neutral-500 transition-colors cursor-pointer disabled:opacity-50"
            title="Rafraîchir la liste"
          >
            <ArrowsClockwise size={16} weight="bold" className={refreshRunning.current ? "animate-spin" : ""} />
          </button>

          {/* Privacy toggle */}
          <button
            onClick={() => setOnlineMode(!onlineMode)}
            data-testid="online-toggle"
            aria-pressed={onlineMode}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all cursor-pointer border ${
              onlineMode
                ? "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-700/50 text-amber-700 dark:text-amber-300"
                : "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-700/50 text-emerald-700 dark:text-emerald-300"
            }`}
          >
            {onlineMode ? <WifiHigh size={14} weight="bold" /> : <ShieldCheck size={14} weight="bold" />}
            <span>{onlineMode ? "En ligne" : "Hors ligne"}</span>
          </button>
        </div>
      </div>

      {/* Privacy notice when online */}
      {onlineMode && (
        <div className="mx-5 mt-3 px-3 py-2 rounded-lg bg-amber-50/80 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-700/30 text-[11px] text-amber-700 dark:text-amber-400 flex items-center gap-2">
          <WifiHigh size={13} weight="bold" className="flex-shrink-0" />
          <span>Mode connecté — les recherches interrogent <strong>huggingface.co</strong> (API publique, pas de compte requis). Désactivez pour rester hors ligne.</span>
        </div>
      )}

      {/* Refresh modal (portal) */}
      {refreshModal.open && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40" style={{ backdropFilter: "blur(2px)" }}>
          <div className="bg-white dark:bg-neutral-800 rounded-2xl shadow-2xl w-[440px] max-w-[90vw] overflow-hidden border border-neutral-200 dark:border-neutral-700">
            {/* Header */}
            <div className="flex items-center gap-3 px-5 pt-5 pb-3">
              <div className="w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 flex items-center justify-center">
                <ArrowsClockwise size={16} weight="bold" className="text-indigo-500" />
              </div>
              <h2 className="text-[15px] font-semibold text-neutral-800 dark:text-neutral-100">Actualisation des modèles</h2>
            </div>
            {/* Steps */}
            <div className="px-5 pb-4 space-y-4">
              {refreshModal.steps.map((step, i) => (
                <div key={i} className="flex items-start gap-3">
                  <div className="mt-0.5 flex-shrink-0 w-5 h-5 flex items-center justify-center">
                    {step.status === "running" && <CircleNotch size={16} className="text-indigo-500 animate-spin" />}
                    {step.status === "done" && <Check size={16} weight="bold" className="text-emerald-500" />}
                    {step.status === "error" && <Warning size={16} weight="bold" className="text-red-500" />}
                    {step.status === "pending" && <div className="w-4 h-4 rounded-full border-2 border-neutral-300 dark:border-neutral-600" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-[13px] font-medium ${
                      step.status === "pending" ? "text-neutral-400 dark:text-neutral-500"
                      : step.status === "error" ? "text-red-600 dark:text-red-400"
                      : "text-neutral-700 dark:text-neutral-200"
                    }`}>
                      {step.label}
                    </p>
                    {step.detail && (
                      <p className={`text-[12px] mt-0.5 leading-relaxed ${
                        step.status === "error" ? "text-red-500/80 dark:text-red-400/80" : "text-neutral-500 dark:text-neutral-400"
                      }`}>
                        {step.detail}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {/* Footer */}
            <div className="px-5 py-3 border-t border-neutral-100 dark:border-neutral-700 flex items-center justify-end gap-2 bg-neutral-50/50 dark:bg-neutral-800/50">
              {refreshModal.showGoOnline && (
                <button
                  onClick={() => { setOnlineMode(true); setRefreshModal({ open: false, steps: [] }); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[12px] font-medium transition-colors cursor-pointer"
                >
                  <Globe size={13} weight="bold" />
                  Passer en mode en ligne
                </button>
              )}
              {!refreshModal.steps.some(s => s.status === "running") && (
                <button
                  onClick={() => setRefreshModal({ open: false, steps: [] })}
                  className="px-3 py-1.5 rounded-lg bg-neutral-100 dark:bg-neutral-700 hover:bg-neutral-200 dark:hover:bg-neutral-600 text-neutral-600 dark:text-neutral-300 text-[12px] font-medium transition-colors cursor-pointer"
                >
                  Fermer
                </button>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Préréglages de recherche (mode connecté) */}
      {onlineMode && (
        <div className="px-5 pt-3 flex flex-wrap gap-2">
          {([
            { id: "all", label: "Tous" },
            { id: "abliterated", label: "Abliterated (sans censure)" },
            { id: "compatible", label: "Compatibles avec mon PC" },
          ] as const).map(p => (
            <button
              key={p.id}
              type="button"
              data-testid={`preset-${p.id}`}
              aria-pressed={preset === p.id}
              onClick={() => { setPreset(p.id); searchOnline(search, p.id); }}
              className={`px-3 py-1 rounded-full text-[12px] font-medium border transition-colors cursor-pointer ${preset === p.id ? "bg-indigo-600 text-white border-indigo-600" : "bg-white dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-700"}`}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}

      {/* Search */}
      <div className="px-5 pt-3 pb-1">
        <div className="relative">
          <MagnifyingGlass size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 dark:text-neutral-500" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            data-testid="model-search"
            placeholder={onlineMode ? "Rechercher sur HuggingFace (ex: llama, mistral, code)…" : "Filtrer les modèles…"}
            className="w-full pl-9 pr-4 py-2 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800/60 text-[13px] text-neutral-800 dark:text-neutral-200 placeholder:text-neutral-400 dark:placeholder:text-neutral-600 outline-none focus:border-indigo-400 dark:focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10 transition-all"
          />
          {onlineLoading && <CircleNotch size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-indigo-500 animate-spin" />}
        </div>
      </div>

      {/* Hardware info banner */}
      {sysMem && (
        <div className="mx-5 mt-2 mb-1 flex items-center gap-3 px-3 py-2 rounded-lg bg-neutral-50 dark:bg-neutral-800/40 border border-neutral-100 dark:border-neutral-700/40 text-[11px]">
          <div className="flex items-center gap-1.5 text-neutral-500 dark:text-neutral-400">
            <Cpu size={13} weight="bold" />
            <span className="font-medium">{navigator.hardwareConcurrency || "?"} threads</span>
          </div>
          <div className="w-px h-3.5 bg-neutral-200 dark:bg-neutral-700" />
          <div className="flex items-center gap-1.5 text-neutral-500 dark:text-neutral-400">
            <Memory size={13} weight="bold" />
            <span className="font-medium">{sysMem.totalGB.toFixed(0)} GB RAM</span>
          </div>
          <div className="w-px h-3.5 bg-neutral-200 dark:bg-neutral-700" />
          <div className={`flex items-center gap-1.5 font-medium ${
            sysMem.availableGB > 6 ? "text-emerald-600 dark:text-emerald-400" :
            sysMem.availableGB > 3 ? "text-amber-600 dark:text-amber-400" :
            "text-red-600 dark:text-red-400"
          }`}>
            <span>{sysMem.availableGB.toFixed(1)} GB dispo</span>
          </div>
          <div className="ml-auto flex items-center gap-1 text-neutral-400 dark:text-neutral-500">
            <Star size={12} weight="fill" className="text-amber-400" />
            <span>= compatible</span>
          </div>
        </div>
      )}

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-5 pb-5">

        {/* === ONLINE MODE: HuggingFace results === */}
        {onlineMode && visibleOnline.length > 0 && (
          <section className="mt-3">
            <SectionHeader
              title={search.trim() ? `Résultats HuggingFace (${onlineResults.length})` : `Modèles GGUF populaires (${onlineResults.length})`}
              open={true}
            />
            <div className="grid grid-cols-1 gap-2 mt-2">
              {visibleOnline.map(model => (
                <ModelCard
                  key={model.name}
                  model={model}
                  installed={isInstalled(model.name)}
                  downloadState={downloads.get(model.name)}
                  onPull={() => pullModel(model.name)}
                  availableRam={availableRam}
                  totalRam={totalRam}
                  variant="online"
                />
              ))}
            </div>
          </section>
        )}

        {/* === INSTALLED MODELS === */}
        <section className="mt-3">
          <SectionHeader
            title={`Installés (${filteredInstalled.length})`}
            open={showInstalled}
            onToggle={() => setShowInstalled(v => !v)}
          />
          {showInstalled && (
            filteredInstalled.length > 0 ? (
              <div className="grid grid-cols-1 gap-1.5 mt-2">
                {filteredInstalled.map(model => (
                  <InstalledModelRow
                    key={model.name}
                    model={model}
                    onDelete={() => deleteModel(model.name)}
                    isDeleting={deleting.has(model.name)}
                  />
                ))}
              </div>
            ) : (
              <p className="text-[12px] text-neutral-400 dark:text-neutral-500 mt-2 ml-1">
                {search ? "Aucun modèle installé ne correspond." : "Aucun modèle installé."}
              </p>
            )
          )}
        </section>

        {/* === RECOMMENDED MODELS === */}
        {filteredRecommended.length > 0 && (
          <section className="mt-4">
            <SectionHeader
              title={`Recommandés (${filteredRecommended.length})`}
              open={showRecommended}
              onToggle={() => setShowRecommended(v => !v)}
            />
            {showRecommended && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 mt-2">
                {filteredRecommended.map(model => (
                  <ModelCard
                    key={model.name}
                    model={model}
                    installed={false}
                    downloadState={downloads.get(model.name)}
                    onPull={() => pullModel(model.name)}
                    availableRam={availableRam}
                    totalRam={totalRam}
                    variant="recommended"
                  />
                ))}
              </div>
            )}
          </section>
        )}

        {/* Empty state */}
        {!onlineMode && filteredInstalled.length === 0 && filteredRecommended.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-neutral-400 dark:text-neutral-500">
            <MagnifyingGlass size={28} className="mb-2 opacity-40" />
            <p className="text-[13px]">Aucun modèle trouvé</p>
          </div>
        )}

        {onlineMode && onlineResults.length === 0 && !onlineLoading && search.trim() && (
          <div className="flex flex-col items-center justify-center py-16 text-neutral-400 dark:text-neutral-500">
            <MagnifyingGlass size={28} className="mb-2 opacity-40" />
            <p className="text-[13px]">Aucun résultat sur HuggingFace</p>
          </div>
        )}

        {onlineMode && !search.trim() && onlineResults.length === 0 && !onlineLoading && (
          <div className="flex flex-col items-center justify-center py-16 text-neutral-400 dark:text-neutral-500">
            <WifiHigh size={28} className="mb-2 opacity-40" />
            <p className="text-[13px]">Chargement des modèles populaires…</p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Section Header ── */

function SectionHeader({ title, open, onToggle }: { title: string; open: boolean; onToggle?: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={`flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500 ${onToggle ? "cursor-pointer hover:text-neutral-600 dark:hover:text-neutral-300" : "cursor-default"} transition-colors select-none`}
    >
      {onToggle && (open ? <CaretDown size={11} weight="bold" /> : <CaretUp size={11} weight="bold" />)}
      {title}
    </button>
  );
}

/* ── Installed Model Row (compact, list-style) ── */

function InstalledModelRow({ model, onDelete, isDeleting }: {
  model: ModelEntry;
  onDelete: () => void;
  isDeleting: boolean;
}) {
  const archColors = ARCH_COLORS[model.arch];
  const [showConfirm, setShowConfirm] = useState(false);
  const estimatedRam = getEstimatedRam(model);

  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-lg border border-neutral-100 dark:border-neutral-800/60 bg-white dark:bg-neutral-800/20 hover:bg-neutral-50 dark:hover:bg-neutral-800/40 transition-colors group">
      {/* Arch badge */}
      <span className={`flex-shrink-0 w-[52px] text-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium border ${
        archColors ? `${archColors.bg} ${archColors.text} ${archColors.border}` : "bg-neutral-100 text-neutral-500 border-neutral-200 dark:bg-neutral-800 dark:text-neutral-400 dark:border-neutral-700"
      }`}>
        {model.arch}
      </span>

      {/* Name */}
      <span className="flex-1 min-w-0 text-[13px] font-medium text-neutral-700 dark:text-neutral-200 truncate">
        {model.name}
      </span>

      {/* Params badge */}
      {model.params && (
        <span className="flex-shrink-0 text-[10px] font-mono text-neutral-400 dark:text-neutral-500 bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded">
          {model.params}
        </span>
      )}

      {/* RAM size */}
      {estimatedRam > 0 && (
        <span className="hidden sm:flex items-center gap-0.5 flex-shrink-0 text-[10px] font-mono text-neutral-400 dark:text-neutral-500 bg-neutral-50 dark:bg-neutral-800/60 px-1.5 py-0.5 rounded">
          <HardDrive size={9} />
          {formatSize(estimatedRam)}
        </span>
      )}

      {/* Tags */}
      {model.tags.slice(0, 2).map(tag => (
        <span key={tag} className="hidden lg:inline-block flex-shrink-0 text-[10px] text-neutral-400 dark:text-neutral-500 bg-neutral-50 dark:bg-neutral-800/60 px-1.5 py-0.5 rounded">
          {tag}
        </span>
      ))}

      {/* Installed indicator */}
      <Check size={13} weight="bold" className="flex-shrink-0 text-emerald-500 dark:text-emerald-400" />

      {/* Delete button */}
      {showConfirm ? (
        <div className="flex items-center gap-1">
          <button
            onClick={() => { onDelete(); setShowConfirm(false); }}
            disabled={isDeleting}
            className="text-[10px] font-medium text-red-600 dark:text-red-400 hover:text-red-700 px-1.5 py-0.5 rounded bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 cursor-pointer disabled:opacity-50"
          >
            {isDeleting ? "…" : "Oui"}
          </button>
          <button
            onClick={() => setShowConfirm(false)}
            className="text-[10px] text-neutral-400 hover:text-neutral-600 px-1 cursor-pointer"
          >
            Non
          </button>
        </div>
      ) : (
        <button
          onClick={() => setShowConfirm(true)}
          className="flex-shrink-0 opacity-0 group-hover:opacity-100 text-neutral-300 dark:text-neutral-600 hover:text-red-500 dark:hover:text-red-400 transition-all cursor-pointer"
          title="Supprimer le modèle"
        >
          <Trash size={14} />
        </button>
      )}
    </div>
  );
}

/* ── Model Card (for recommended / online results) ── */

function ModelCard({ model, installed, downloadState, onPull, availableRam, totalRam, variant }: {
  model: ModelEntry;
  installed: boolean;
  downloadState?: { state: DownloadState; progress: DownloadProgress };
  onPull: () => void;
  availableRam: number;
  totalRam: number;
  variant: "recommended" | "online";
}) {
  const archColors = ARCH_COLORS[model.arch];
  const isPulling = downloadState?.state === "pulling";
  const isDone = downloadState?.state === "done" || installed;
  const isError = downloadState?.state === "error";
  const estimatedRam = getEstimatedRam(model);
  const compat = getHardwareCompat(estimatedRam, availableRam, totalRam);

  return (
    <div
      data-testid="model-card"
      data-model={model.name}
      data-compat={compat}
      data-abliterated={/abliterat|uncensor/i.test(model.name) ? "true" : "false"}
      className={`flex flex-col gap-2 p-3 rounded-xl border transition-colors ${
      compat === "too-large"
        ? "border-red-200/70 dark:border-red-900/40 bg-red-50/30 dark:bg-red-950/10"
        : compat === "tight"
        ? "border-amber-200/70 dark:border-amber-900/40 bg-amber-50/20 dark:bg-amber-950/10"
        : "border-neutral-150 dark:border-neutral-700/50 bg-white dark:bg-neutral-800/20 hover:border-neutral-300 dark:hover:border-neutral-600"
    }`}>
      {/* Row 1: Name + badges + compat star */}
      <div className="flex items-center gap-2 min-w-0">
        {compat === "perfect" && (
          <span title="Parfaitement compatible avec votre matériel"><Star size={14} weight="fill" className="flex-shrink-0 text-amber-400" /></span>
        )}
        {compat === "ok" && (
          <span title="Compatible avec votre matériel"><Star size={14} weight="bold" className="flex-shrink-0 text-amber-300 dark:text-amber-500/70" /></span>
        )}
        <span className="text-[13px] font-semibold text-neutral-800 dark:text-neutral-100 truncate">
          {model.displayName}
        </span>
        <span className={`flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-mono font-medium border ${
          archColors ? `${archColors.bg} ${archColors.text} ${archColors.border}` : "bg-neutral-100 text-neutral-500 border-neutral-200 dark:bg-neutral-800 dark:text-neutral-400 dark:border-neutral-700"
        }`}>
          {model.arch}
        </span>
        {model.params && (
          <span className="flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-neutral-100 dark:bg-neutral-700/50 text-neutral-500 dark:text-neutral-400 border border-neutral-200 dark:border-neutral-600">
            {model.params}
          </span>
        )}
        {variant === "online" && model.author && (
          <span className="text-[10px] text-neutral-400 dark:text-neutral-500 truncate ml-auto">
            {model.author}
          </span>
        )}
      </div>

      {/* Description */}
      {model.description && (
        <p className="text-[12px] leading-relaxed text-neutral-500 dark:text-neutral-400 line-clamp-2">
          {model.description}
        </p>
      )}

      {/* RAM warning banner for tight/too-large models */}
      {estimatedRam > 0 && (compat === "too-large" || compat === "tight") && (
        <div className={`flex items-start gap-2 px-3 py-2 rounded-lg text-[11px] leading-relaxed ${
          compat === "too-large"
            ? "bg-red-50 dark:bg-red-950/20 border border-red-200/60 dark:border-red-800/40 text-red-700 dark:text-red-400"
            : "bg-amber-50 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-800/40 text-amber-700 dark:text-amber-400"
        }`}>
          <Warning size={14} weight="bold" className="flex-shrink-0 mt-0.5" />
          <span>
            Ce modèle nécessite environ <strong>{formatSize(estimatedRam)}</strong> de RAM.
            {compat === "too-large"
              ? <> Votre système a <strong>{(totalRam / 1e9).toFixed(0)} GB</strong> au total. Le chargement risque d'échouer ou de rendre le système instable.</>
              : <> Vous avez <strong>{formatSize(availableRam)}</strong> disponibles sur {(totalRam / 1e9).toFixed(0)} GB. Le chargement pourrait être lent.</>}
          </span>
        </div>
      )}

      {/* Tags + RAM estimate + metadata */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {/* RAM estimate — prominent */}
        {estimatedRam > 0 && (
          <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
            compat === "too-large" ? "bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400" :
            compat === "tight" ? "bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400" :
            compat === "perfect" ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400" :
            "bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400"
          }`}>
            <Memory size={10} weight="bold" />
            ~{formatSize(estimatedRam)} RAM
          </span>
        )}
        {model.tags.slice(0, 3).map(tag => (
          <span key={tag} className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-neutral-100 dark:bg-neutral-700/40 text-neutral-500 dark:text-neutral-400">
            {tag}
          </span>
        ))}
        {model.downloads ? (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-neutral-100 dark:bg-neutral-700/40 text-neutral-500 dark:text-neutral-400">
            {model.downloads > 1000 ? `${(model.downloads / 1000).toFixed(0)}k` : model.downloads} DL
          </span>
        ) : null}
      </div>

      {/* Action row */}
      <div className="flex items-center justify-between mt-auto pt-0.5">
        <span className="text-[11px] font-mono text-neutral-400 dark:text-neutral-500 truncate max-w-[60%]">
          {model.name}
        </span>

        {isDone ? (
          <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
            <Check size={13} weight="bold" />
            Installé
          </span>
        ) : isPulling ? (
          <div className="flex items-center gap-2">
            <div className="w-24 h-1.5 rounded-full bg-neutral-200 dark:bg-neutral-700 overflow-hidden">
              <div
                className="h-full rounded-full bg-indigo-500 transition-all duration-300"
                style={{ width: `${downloadState.progress.percent}%` }}
              />
            </div>
            <span className="text-[10px] tabular-nums text-neutral-400">{downloadState.progress.percent}%</span>
          </div>
        ) : isError ? (
          <button
            onClick={onPull}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-red-600 hover:bg-red-700 text-white text-[11px] font-medium transition-colors cursor-pointer shadow-sm"
          >
            <Warning size={12} />
            Réessayer
          </button>
        ) : compat === "too-large" ? (
          <span className="flex items-center gap-1 text-[11px] font-medium text-red-500 dark:text-red-400">
            <Warning size={12} />
            RAM insuffisante
          </span>
        ) : model.name.includes("/") ? (
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => onPull()}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-medium transition-colors cursor-pointer shadow-sm"
            >
              <Download size={12} weight="bold" />
              Télécharger
            </button>
            <a
              href={`https://huggingface.co/${model.hfId || model.name}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 px-2 py-1 rounded-lg bg-neutral-100 dark:bg-neutral-700 hover:bg-neutral-200 dark:hover:bg-neutral-600 text-neutral-500 dark:text-neutral-400 text-[10px] transition-colors cursor-pointer"
              title="Voir sur HuggingFace"
            >
              <Globe size={11} weight="bold" />
            </a>
          </div>
        ) : (
          <button
            onClick={onPull}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-medium transition-colors cursor-pointer shadow-sm"
          >
            <Download size={12} weight="bold" />
            Télécharger
          </button>
        )}
      </div>
    </div>
  );
}

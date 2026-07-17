import {
  ChatResponse,
  ChatsResponse,
  ChatEvent,
  DownloadEvent,
  ErrorEvent,
  InferenceCompute,
  InferenceComputeResponse,
  ModelCapabilitiesResponse,
  Model,
  ChatRequest,
  Settings,
  User,
} from "@/gotypes";
import { parseJsonlFromResponse } from "./util/jsonl-parsing";
import { dromadaireClient as ollama } from "./lib/dromadaire-client";
import type { ModelResponse } from "ollama/browser";
import { API_BASE, OLLAMA_DOT_COM } from "./lib/config";

// Extend Model class with utility methods
declare module "@/gotypes" {
  interface Model {
    isCloud(): boolean;
  }
}

Model.prototype.isCloud = function (): boolean {
  return this.model.endsWith("cloud");
};

// Dromadaire: fetch the encryption key for backup display
export async function getEncryptionKey(): Promise<{
  key: string;
  path: string;
}> {
  const response = await fetch(`${API_BASE}/api/v1/encryption-key`);
  if (!response.ok) {
    throw new Error("Failed to fetch encryption key");
  }
  return response.json();
}

// Dromadaire: warmup model by loading it into memory without generating text
// Pass settings options so Ollama loads with the same params chat will use (avoids reload on first message)
export async function warmupModel(modelName: string, settings?: { contextLength?: number; numThread?: number; numBatch?: number; useMlock?: boolean; kvCacheType?: string }): Promise<void> {
  try {
    const options: Record<string, unknown> = { use_mmap: false };
    if (settings?.contextLength && settings.contextLength > 0) options.num_ctx = settings.contextLength;
    if (settings?.numThread && settings.numThread > 0) options.num_thread = settings.numThread;
    if (settings?.numBatch && settings.numBatch > 0) options.num_batch = settings.numBatch;
    if (settings?.useMlock) options.use_mlock = true;
    if (settings?.kvCacheType) {
      options.cache_type_k = settings.kvCacheType;
      options.cache_type_v = settings.kvCacheType;
    }
    await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelName,
        prompt: "",
        keep_alive: "5m",
        options,
      }),
    });
  } catch {
    // Silently ignore warmup failures (model may not exist yet, server not ready, etc.)
  }
}

// Helper function to convert Uint8Array to base64
function uint8ArrayToBase64(uint8Array: Uint8Array): string {
  const chunkSize = 0x8000; // 32KB chunks to avoid stack overflow
  let binary = "";

  for (let i = 0; i < uint8Array.length; i += chunkSize) {
    const chunk = uint8Array.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

export async function fetchUser(): Promise<User | null> {
  const response = await fetch(`${API_BASE}/api/me`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
  });

  if (response.ok) {
    const userData: User = await response.json();

    if (userData.avatarurl && !userData.avatarurl.startsWith("http")) {
      userData.avatarurl = `${OLLAMA_DOT_COM}${userData.avatarurl}`;
    }

    return userData;
  }

  if (response.status === 401 || response.status === 403) {
    return null;
  }

  throw new Error(`Failed to fetch user: ${response.status}`);
}

export async function fetchConnectUrl(): Promise<string> {
  const response = await fetch(`${API_BASE}/api/me`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
  });

  if (response.status === 401) {
    const data = await response.json();
    if (data.signin_url) {
      return data.signin_url;
    }
  }

  throw new Error("Failed to fetch connect URL");
}

export async function disconnectUser(): Promise<void> {
  const response = await fetch(`${API_BASE}/api/signout`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error("Failed to disconnect user");
  }
}

export async function getChats(): Promise<ChatsResponse> {
  const response = await fetch(`${API_BASE}/api/v1/chats`);
  const data = await response.json();
  return new ChatsResponse(data);
}

export async function getChat(chatId: string): Promise<ChatResponse> {
  const response = await fetch(`${API_BASE}/api/v1/chat/${chatId}`);
  const data = await response.json();
  return new ChatResponse(data);
}

export async function getModels(query?: string): Promise<Model[]> {
  try {
    const { models: modelsResponse } = await ollama.list();

    let models: Model[] = modelsResponse
      .filter((m: ModelResponse) => {
        const families = m.details?.families;

        if (!families || families.length === 0) {
          return true;
        }

        const isBertOnly = families.every((family: string) =>
          family.toLowerCase().includes("bert"),
        );

        return !isBertOnly;
      })
      .map((m: ModelResponse) => {
        // Remove the latest tag from the returned model
        const modelName = m.name.replace(/:latest$/, "");

        return new Model({
          model: modelName,
          digest: m.digest,
          modified_at: m.modified_at ? new Date(m.modified_at) : undefined,
        });
      });

    // Filter by query if provided
    if (query) {
      const normalizedQuery = query.toLowerCase().trim();

      const filteredModels = models.filter((m: Model) => {
        return m.model.toLowerCase().startsWith(normalizedQuery);
      });

      let exactMatch = false;
      for (const m of filteredModels) {
        if (m.model.toLowerCase() === normalizedQuery) {
          exactMatch = true;
          break;
        }
      }

      // Add query if it's in the registry and not already in the list
      if (!exactMatch) {
        const result = await getModelUpstreamInfo(new Model({ model: query }));
        const existsUpstream = !!result.digest && !result.error;
        if (existsUpstream) {
          filteredModels.push(new Model({ model: query }));
        }
      }

      models = filteredModels;
    }

    return models;
  } catch (err) {
    throw new Error(`Failed to fetch models: ${err}`);
  }
}

export async function getModelCapabilities(
  modelName: string,
): Promise<ModelCapabilitiesResponse> {
  try {
    const showResponse = await ollama.show({ model: modelName });

    return new ModelCapabilitiesResponse({
      capabilities: Array.isArray(showResponse.capabilities)
        ? showResponse.capabilities
        : [],
    });
  } catch (error) {
    // Model might not be downloaded yet, return empty capabilities
    console.error(`Failed to get capabilities for ${modelName}:`, error);
    return new ModelCapabilitiesResponse({ capabilities: [] });
  }
}

export type ChatEventUnion = ChatEvent | DownloadEvent | ErrorEvent;

export async function* sendMessage(
  chatId: string,
  message: string,
  model: Model,
  attachments?: Array<{ filename: string; data: Uint8Array }>,
  signal?: AbortSignal,
  index?: number,
  webSearch?: boolean,
  fileTools?: boolean,
  forceUpdate?: boolean,
  think?: boolean | string,
  incognito?: boolean,
  modelParams?: { temperature?: number; topP?: number; numPredict?: number; topK?: number; minP?: number; typicalP?: number; repeatPenalty?: number; repeatLastN?: number; frequencyPenalty?: number; presencePenalty?: number; seed?: number; flashAttn?: boolean; cacheTypeK?: string; cacheTypeV?: string; stop?: string[]; numGPU?: number; numCtx?: number; numThread?: number; numBatch?: number; useMlock?: boolean; ropeFrequencyBase?: number; ropeFrequencyScale?: number; logitBias?: string },
  format?: any,
): AsyncGenerator<ChatEventUnion> {
  // Convert Uint8Array to base64 for JSON serialization
  const serializedAttachments = attachments?.map((att) => ({
    filename: att.filename,
    data: uint8ArrayToBase64(att.data),
  }));

  // Send think parameter when it's explicitly set (true, false, or a non-empty string).
  const shouldSendThink =
    think !== undefined &&
    (typeof think === "boolean" || (typeof think === "string" && think !== ""));

  // Dromadaire LOT 9B: append incognito query param to skip DB writes
  const chatUrl = incognito
    ? `${API_BASE}/api/v1/chat/${chatId}?incognito=true`
    : `${API_BASE}/api/v1/chat/${chatId}`;
  const response = await fetch(chatUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(
      new ChatRequest({
        model: model.model,
        prompt: message,
        ...(index !== undefined ? { index } : {}),
        ...(serializedAttachments !== undefined
          ? { attachments: serializedAttachments }
          : {}),
        // Always send web_search as a boolean value (default to false)
        web_search: webSearch ?? false,
        file_tools: fileTools ?? false,
        ...(forceUpdate !== undefined ? { forceUpdate } : {}),
        ...(shouldSendThink ? { think } : {}),
        ...(modelParams?.temperature !== undefined ? { temperature: modelParams.temperature } : {}),
        ...(modelParams?.topP !== undefined ? { top_p: modelParams.topP } : {}),
        ...(modelParams?.numPredict !== undefined ? { num_predict: modelParams.numPredict } : {}),
        ...(modelParams?.topK !== undefined ? { top_k: modelParams.topK } : {}),
        ...(modelParams?.minP !== undefined ? { min_p: modelParams.minP } : {}),
        ...(modelParams?.typicalP !== undefined && modelParams.typicalP < 1 ? { typical_p: modelParams.typicalP } : {}),
        ...(modelParams?.repeatPenalty !== undefined ? { repeat_penalty: modelParams.repeatPenalty } : {}),
        ...(modelParams?.repeatLastN !== undefined && modelParams.repeatLastN > 0 ? { repeat_last_n: modelParams.repeatLastN } : {}),
        ...(modelParams?.frequencyPenalty !== undefined ? { frequency_penalty: modelParams.frequencyPenalty } : {}),
        ...(modelParams?.presencePenalty !== undefined ? { presence_penalty: modelParams.presencePenalty } : {}),
        ...(modelParams?.seed !== undefined ? { seed: modelParams.seed } : {}),
        ...(modelParams?.flashAttn !== undefined ? { flash_attn: modelParams.flashAttn } : {}),
        ...(modelParams?.cacheTypeK !== undefined ? { cache_type_k: modelParams.cacheTypeK } : {}),
        ...(modelParams?.cacheTypeV !== undefined ? { cache_type_v: modelParams.cacheTypeV } : {}),
        ...(modelParams?.stop && modelParams.stop.length > 0 ? { stop: modelParams.stop } : {}),
        ...(modelParams?.numGPU !== undefined ? { num_gpu: modelParams.numGPU } : {}),
        ...(modelParams?.numCtx !== undefined && modelParams.numCtx > 0 ? { num_ctx: modelParams.numCtx } : {}),
        ...(modelParams?.numThread !== undefined && modelParams.numThread > 0 ? { num_thread: modelParams.numThread } : {}),
        ...(modelParams?.numBatch !== undefined && modelParams.numBatch > 0 ? { num_batch: modelParams.numBatch } : {}),
        ...(modelParams?.useMlock ? { use_mlock: true } : {}),
        ...(modelParams?.ropeFrequencyBase !== undefined && modelParams.ropeFrequencyBase > 0 ? { rope_frequency_base: modelParams.ropeFrequencyBase } : {}),
        ...(modelParams?.ropeFrequencyScale !== undefined && modelParams.ropeFrequencyScale > 0 ? { rope_frequency_scale: modelParams.ropeFrequencyScale } : {}),
        ...(modelParams?.logitBias ? (() => {
          const parsed: Record<string, number> = {};
          for (const pair of modelParams.logitBias.split(",")) {
            const [tid, bias] = pair.trim().split(":");
            if (tid && bias && !isNaN(Number(tid)) && !isNaN(Number(bias))) {
              parsed[tid.trim()] = Number(bias.trim());
            }
          }
          return Object.keys(parsed).length > 0 ? { logit_bias: parsed } : {};
        })() : {}),
        ...(format !== undefined ? { format } : {}),
      }),
    ),
    signal,
  });

  // Dromadaire LOT 9B: incognito mode - patched URL above
  for await (const event of parseJsonlFromResponse<ChatEventUnion>(response)) {
    switch (event.eventName) {
      case "download":
        yield new DownloadEvent(event);
        break;
      case "error":
        yield new ErrorEvent(event);
        break;
      default:
        yield new ChatEvent(event);
        break;
    }
  }
}

export async function getSettings(): Promise<{
  settings: Settings;
}> {
  const response = await fetch(`${API_BASE}/api/v1/settings`);
  if (!response.ok) {
    throw new Error("Failed to fetch settings");
  }
  const data = await response.json();
  return {
    settings: new Settings(data.settings),
  };
}

export async function updateSettings(settings: Settings): Promise<{
  settings: Settings;
}> {
  const response = await fetch(`${API_BASE}/api/v1/settings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(settings),
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(error || "Failed to update settings");
  }
  const data = await response.json();
  return {
    settings: new Settings(data.settings),
  };
}

// LOT H: Analyze writing style from sample texts
export async function analyzeWritingStyle(samples: string): Promise<{ rules: string }> {
  const response = await fetch(`${API_BASE}/api/v1/analyze-style`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ samples }),
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(error || "Style analysis failed");
  }
  return response.json();
}

export async function renameChat(chatId: string, title: string): Promise<void> {
  const response = await fetch(`${API_BASE}/api/v1/chat/${chatId}/rename`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ title: title.trim() }),
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(error || "Failed to rename chat");
  }
}

// LOT O: pin/unpin a chat
export async function pinChat(chatId: string, pinned: boolean): Promise<void> {
  const response = await fetch(`${API_BASE}/api/v1/chat/${chatId}/pin`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pinned }),
  });
  if (!response.ok) {
    throw new Error("Failed to pin chat");
  }
}

// LOT O: set chat folder
export async function setChatFolder(chatId: string, folder: string): Promise<void> {
  const response = await fetch(`${API_BASE}/api/v1/chat/${chatId}/folder`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folder }),
  });
  if (!response.ok) {
    throw new Error("Failed to set chat folder");
  }
}

export async function deleteChat(chatId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/api/v1/chat/${chatId}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(error || "Failed to delete chat");
  }
}

// LOT 43: Branch chat — fork a conversation at a specific message index
export async function branchChat(chatId: string, messageIndex: number): Promise<{ chatId: string }> {
  const response = await fetch(`${API_BASE}/api/v1/chat/${chatId}/branch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messageIndex }),
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(error || "Failed to branch chat");
  }
  return response.json();
}

export async function truncateMessages(chatId: string, fromIndex: number): Promise<void> {
  const response = await fetch(`${API_BASE}/api/v1/chat/${chatId}/messages`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fromIndex }),
  });
  if (!response.ok) {
    throw new Error("Failed to truncate messages");
  }
}

// Get upstream information for model staleness checking
export async function getModelUpstreamInfo(
  model: Model,
): Promise<{ digest?: string; pushTime: number; error?: string }> {
  try {
    const response = await fetch(`${API_BASE}/api/v1/model/upstream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: model.model,
      }),
    });

    if (!response.ok) {
      console.warn(
        `Failed to check upstream digest for ${model.model}: ${response.status}`,
      );
      return { pushTime: 0 };
    }

    const data = await response.json();

    if (data.error) {
      console.warn(`Upstream digest check: ${data.error}`);
      return { error: data.error, pushTime: 0 };
    }

    return { digest: data.digest, pushTime: data.pushTime || 0 };
  } catch (error) {
    console.warn(`Error checking model staleness:`, error);
    return { pushTime: 0 };
  }
}

export async function* pullModel(
  modelName: string,
  signal?: AbortSignal,
): AsyncGenerator<{
  status: string;
  digest?: string;
  total?: number;
  completed?: number;
  done?: boolean;
}> {
  const response = await fetch(`${API_BASE}/api/v1/models/pull`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: modelName }),
    signal,
  });

  if (!response.ok) {
    throw new Error(`Failed to pull model: ${response.statusText}`);
  }

  for await (const event of parseJsonlFromResponse<{
    status: string;
    digest?: string;
    total?: number;
    completed?: number;
    done?: boolean;
  }>(response)) {
    yield event;
  }
}

export async function getInferenceCompute(): Promise<InferenceCompute[]> {
  const response = await fetch(`${API_BASE}/api/v1/inference-compute`);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch inference compute: ${response.statusText}`,
    );
  }

  const data = await response.json();
  const inferenceComputeResponse = new InferenceComputeResponse(data);
  return inferenceComputeResponse.inferenceComputes || [];
}

// ========== Dromadaire v2: RAG API ==========

export interface RAGDocument {
  id: string;
  filename: string;
  file_size: number;
  content_hash: string;
  chunk_count: number;
  status: string;
  error_message: string;
  embedding_model: string;
  progress_current: number;
  progress_total: number;
  created_at: string;
  updated_at: string;
}

export async function getRAGDocuments(): Promise<RAGDocument[]> {
  const response = await fetch(`${API_BASE}/api/v1/rag/documents`);
  if (!response.ok) {
    throw new Error("Failed to fetch RAG documents");
  }
  return response.json();
}

export async function uploadRAGDocument(file: File): Promise<RAGDocument> {
  const formData = new FormData();
  formData.append("file", file);
  const response = await fetch(`${API_BASE}/api/v1/rag/documents`, {
    method: "POST",
    body: formData,
  });
  if (!response.ok) {
    throw new Error("Failed to upload RAG document");
  }
  return response.json();
}

export async function deleteRAGDocument(id: string): Promise<void> {
  const response = await fetch(`${API_BASE}/api/v1/rag/documents/${id}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    throw new Error("Failed to delete RAG document");
  }
}

// ========== Search API (LOT 15) ==========

export interface SearchResult {
  chat_id: string;
  chat_title: string;
  role: string;
  excerpt: string;
  created_at: string;
}

export async function searchChats(query: string): Promise<SearchResult[]> {
  const response = await fetch(
    `${API_BASE}/api/v1/search?q=${encodeURIComponent(query)}`,
  );
  if (!response.ok) {
    throw new Error("Failed to search chats");
  }
  const data = await response.json();
  return data.results || [];
}

// LOT 17: Get all chunks for a document (for preview panel)
export interface RAGChunk {
  id: number;
  document_id: string;
  document_name?: string;
  chunk_index: number;
  content: string;
  embedding_dim: number;
  token_count: number;
}

export async function getRAGDocumentChunks(docId: string): Promise<RAGChunk[]> {
  const response = await fetch(`${API_BASE}/api/v1/rag/documents/${docId}/chunks`);
  if (!response.ok) {
    throw new Error("Failed to fetch document chunks");
  }
  return response.json();
}

// LOT: Tokenize — estimate token count via Ollama API
export async function tokenize(model: string, input: string): Promise<number> {
  const resp = await fetch('/api/tokenize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input }),
  });
  const data = await resp.json();
  return data.tokens?.length ?? Math.ceil(input.length / 4);
}

// ========== End RAG API ==========

// ========== Auth API (Dromadaire v2) ==========

export interface AuthStatus {
  passwordEnabled: boolean;
  autoDeleteEnabled: boolean;
}

export interface AuthResult {
  authenticated: boolean;
  wiped: boolean;
  attemptsLeft?: number;
}

export async function authStatus(): Promise<AuthStatus> {
  const response = await fetch(`${API_BASE}/api/v1/auth/status`);
  if (!response.ok) throw new Error("Failed to fetch auth status");
  return response.json();
}

export async function verifyPassword(password: string): Promise<AuthResult> {
  const response = await fetch(`${API_BASE}/api/v1/auth/verify-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  return response.json();
}

export async function setAppPassword(password: string): Promise<void> {
  const response = await fetch(`${API_BASE}/api/v1/auth/set-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || "Failed to set password");
  }
}

export async function removeAppPassword(currentPassword: string): Promise<void> {
  const response = await fetch(`${API_BASE}/api/v1/auth/remove-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ current_password: currentPassword }),
  });
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || "Failed to remove password");
  }
}

// ========== LOT 22: Performance API ==========

export interface HardwareInfo {
  cpuCores: number;
  totalRAMGB: number;
  isGPU: boolean;
  gpuName: string;
  vram: string;
  library: string;
  systemGPU: string;
}

export interface AutoconfigResult {
  hardware: HardwareInfo;
  applied: {
    NumThread: number;
    KeepAlive: string;
    MaxLoadedModels: number;
    KVCacheType: string;
    NumBatch: number;
    ContextLength: number;
  };
}

export async function getHardwareInfo(): Promise<HardwareInfo> {
  const response = await fetch(`${API_BASE}/api/v1/hardware-info`);
  if (!response.ok) throw new Error("Failed to get hardware info");
  return response.json();
}

export async function runAutoconfig(): Promise<AutoconfigResult> {
  const response = await fetch(`${API_BASE}/api/v1/autoconfig`, { method: "POST" });
  if (!response.ok) throw new Error("Failed to run autoconfig");
  return response.json();
}

export async function restartServer(): Promise<void> {
  const response = await fetch(`${API_BASE}/api/v1/restart-server`, { method: "POST" });
  if (!response.ok) throw new Error("Failed to restart server");
}

// ========== Agent Tool Approval API ==========

export async function approveToolExecution(chatId: string, approved: boolean): Promise<void> {
  const response = await fetch(`${API_BASE}/api/v1/chat/${chatId}/tool-approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ approved }),
  });
  if (!response.ok) {
    throw new Error("Failed to send tool approval");
  }
}

// ========== Health API ==========

export async function fetchHealth(): Promise<boolean> {
  try {
    // Use the /api/version endpoint as a health check
    const response = await fetch(`${API_BASE}/api/version`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (response.ok) {
      const data = await response.json();
      // If we get a version back, the server is healthy
      return !!data.version;
    }

    return false;
  } catch (error) {
    console.error("Error checking health:", error);
    return false;
  }
}

// Dromadaire v4: system diagnostics
export interface DiagnosticsData {
  app_version: string;
  schema_version: number;
  portable_mode: boolean;
  os: string;
  arch: string;
  cpu_cores: number;
  total_ram_gb: string;
  gpu_devices: Array<{
    library: string;
    variant: string;
    compute: string;
    driver: string;
    name: string;
    vram: string;
  }>;
  build_info: Record<string, string>;
  server_port: string;
  ollama_env: Record<string, string>;
  performance: {
    num_thread: number;
    keep_alive: string;
    max_loaded_models: number;
    kv_cache_type: string;
    num_batch: number;
    context_length: number;
  };
  features: Record<string, any>;
  logs: string[];
}

export async function getDiagnostics(): Promise<DiagnosticsData> {
  const response = await fetch(`${API_BASE}/api/v1/diagnostics`);
  if (!response.ok) {
    throw new Error("Failed to fetch diagnostics");
  }
  return response.json();
}

// Dromadaire: cloud stubs (no cloud features — always disabled)
export type CloudStatusSource = "env" | "config" | "both" | "none";

export interface CloudStatusResponse {
  disabled: boolean;
  source: CloudStatusSource;
}

export async function getCloudStatus(): Promise<CloudStatusResponse | null> {
  return { disabled: true, source: "none" };
}

// ========== Dromadaire v5: Performance Benchmark ==========

export interface BenchmarkProgressEvent {
  event: "progress";
  phase: "cpu" | "memory" | "inference" | "gpu";
  message: string;
}

export interface BenchmarkResultEvent {
  event: "result";
  phase: "cpu" | "memory" | "inference" | "gpu";
  score: number; // 1.0-9.9 or -1 for N/A
  detail: string;
  duration_ms: number;
}

export interface BenchmarkCompleteEvent {
  event: "complete";
  overall_score: number;
  cpu_score: number;
  memory_score: number;
  infer_score: number;
  gpu_score: number;
  cpu_detail: string;
  memory_detail: string;
  infer_detail: string;
  gpu_detail: string;
  total_duration_ms: number;
}

export type BenchmarkEvent =
  | BenchmarkProgressEvent
  | BenchmarkResultEvent
  | BenchmarkCompleteEvent;

export async function* runBenchmark(
  signal?: AbortSignal,
): AsyncGenerator<BenchmarkEvent> {
  const response = await fetch(`${API_BASE}/api/v1/benchmark`, {
    method: "POST",
    signal,
  });
  if (!response.ok) {
    throw new Error(`Benchmark failed: ${response.statusText}`);
  }
  yield* parseJsonlFromResponse<BenchmarkEvent>(response);
}

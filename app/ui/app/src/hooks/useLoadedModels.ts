import { useQuery } from "@tanstack/react-query";
import { API_BASE } from "@/lib/config";
import { useAnyStreaming } from "@/contexts/StreamingContext";

interface LoadedModel {
  name: string;
  model: string;
  size: number;
  digest: string;
  expires_at: string;
  size_vram: number;
}

interface PsResponse {
  models: LoadedModel[];
}

async function fetchLoadedModels(): Promise<LoadedModel[]> {
  const resp = await fetch(`${API_BASE}/api/ps`);
  if (!resp.ok) return [];
  const data: PsResponse = await resp.json();
  return data.models || [];
}

export function useLoadedModels() {
  const isStreaming = useAnyStreaming();
  return useQuery({
    queryKey: ["loaded-models"],
    queryFn: fetchLoadedModels,
    refetchInterval: isStreaming ? false : 3000,
    refetchIntervalInBackground: false,
    retry: 1,
    staleTime: 2000,
  });
}

export function isModelLoaded(loadedModels: LoadedModel[] | undefined, modelName: string): boolean {
  if (!loadedModels || !modelName) return false;
  return loadedModels.some(m => m.name === modelName || m.model === modelName);
}

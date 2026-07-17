import { useQuery } from "@tanstack/react-query";
import { API_BASE } from "@/lib/config";
import { useAnyStreaming } from "@/contexts/StreamingContext";

export interface SystemMemory {
  totalBytes: number;
  availableBytes: number;
  usedBytes: number;
  usedPercent: number;
  totalGB: number;
  availableGB: number;
  usedGB: number;
}

async function fetchSystemResources(): Promise<SystemMemory> {
  const resp = await fetch(`${API_BASE}/api/v1/system-resources`);
  if (!resp.ok) throw new Error("Failed to fetch system resources");
  return resp.json();
}

export function useSystemResources() {
  const isStreaming = useAnyStreaming();
  return useQuery({
    queryKey: ["system-resources"],
    queryFn: fetchSystemResources,
    refetchInterval: isStreaming ? false : 5000,
    refetchIntervalInBackground: false,
    retry: 1,
    staleTime: 4000,
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export type MemoryLevel = "ok" | "warning" | "critical";

export function getMemoryLevel(usedPercent: number): MemoryLevel {
  if (usedPercent >= 90) return "critical";
  if (usedPercent >= 70) return "warning";
  return "ok";
}

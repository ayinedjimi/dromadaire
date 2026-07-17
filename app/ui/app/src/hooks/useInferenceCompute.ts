import { useQuery } from "@tanstack/react-query";
import { getInferenceCompute } from "@/api";

export function useInferenceCompute() {
  const { data: computes } = useQuery({
    queryKey: ["inference-compute"],
    queryFn: getInferenceCompute,
    staleTime: 30_000,
    retry: false,
  });

  const gpu = computes?.find(
    (c) => c.library !== "cpu" && c.name,
  );

  return {
    isGPU: !!gpu,
    gpuName: gpu?.name ?? null,
    library: gpu?.library ?? "cpu",
    vram: gpu?.vram ?? null,
  };
}

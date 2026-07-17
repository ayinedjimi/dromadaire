import { Model } from "@/gotypes";

// Featured models list (in priority order) — Dromadaire: no cloud models
export const FEATURED_MODELS = [
  "gemma3:27b",
  "gemma3:12b",
  "gemma3:4b",
  "gemma3:1b",
  "deepseek-r1:8b",
  "qwen3-coder:30b",
  "qwen3-vl:30b",
  "qwen3-vl:8b",
  "qwen3-vl:4b",
  "qwen3:30b",
  "qwen3:8b",
  "qwen3:4b",
];

function alphabeticalSort(a: Model, b: Model): number {
  return a.model.toLowerCase().localeCompare(b.model.toLowerCase());
}

// Dromadaire: local models only, no cloud models
export function mergeModels(
  localModels: Model[],
): Model[] {
  const allModels = (localModels || []).filter((m) => !m.isCloud());

  const featuredModels = FEATURED_MODELS.map((model) => {
    const localMatch = allModels.find(
      (m) => m.model.toLowerCase() === model.toLowerCase(),
    );
    if (localMatch) return localMatch;
    return new Model({ model });
  });

  const remainingModels = allModels.filter(
    (model) =>
      !FEATURED_MODELS.some(
        (f) => f.toLowerCase() === model.model.toLowerCase(),
      ),
  );

  featuredModels.sort(
    (a, b) =>
      FEATURED_MODELS.indexOf(a.model) - FEATURED_MODELS.indexOf(b.model),
  );

  remainingModels.sort(alphabeticalSort);

  return [...featuredModels, ...remainingModels];
}

// Custom display names for models — branding INTELLIGENCE PRIVEE
const MODEL_ALIASES: Record<string, string> = {};

// Prefix patterns: if the model name starts with one of these, prepend a label
const MODEL_PREFIXES: { pattern: string; prefix: string }[] = [
  { pattern: "m365-expert", prefix: "INTELLIGENCE PRIVEE" },
];

export function getModelDisplayName(modelId: string): string {
  // Exact alias match
  const alias = MODEL_ALIASES[modelId];
  if (alias) return alias;

  // Prefix match (e.g. m365:latest → INTELLIGENCE PRIVEE m365:latest)
  for (const { pattern, prefix } of MODEL_PREFIXES) {
    if (modelId.startsWith(pattern)) {
      return `${prefix} ${modelId}`;
    }
  }

  return modelId;
}

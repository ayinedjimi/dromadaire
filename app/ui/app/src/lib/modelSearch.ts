// Recherche de modèles « abliterated » (sans censure) sur HuggingFace.

export const HF_MODELS_API = "https://huggingface.co/api/models";

/** Termes qui désignent un modèle dont les garde-fous ont été retirés. */
export const ABLITERATED_TERMS = ["abliterated", "abliteration", "uncensored", "heretic"];

export function isAbliterated(name: string, tags: string[] = []): boolean {
  const haystack = `${name} ${tags.join(" ")}`.toLowerCase();
  return ABLITERATED_TERMS.some((term) => haystack.includes(term));
}

/**
 * Trie : les modèles abliterated d'abord, puis par nombre de téléchargements
 * décroissant. Le tri est stable (l'ordre d'origine départage les ex æquo).
 */
export function rankAbliteratedFirst<T extends { name: string; tags?: string[]; downloads?: number }>(items: T[]): T[] {
  return items
    .map((item, index) => ({ item, index, abl: isAbliterated(item.name, item.tags) }))
    .sort((a, b) =>
      Number(b.abl) - Number(a.abl) ||
      (b.item.downloads ?? 0) - (a.item.downloads ?? 0) ||
      a.index - b.index,
    )
    .map((x) => x.item);
}

/** URL de recherche GGUF triée par téléchargements. */
export function hfSearchUrl(search: string, limit = 30): string {
  return `${HF_MODELS_API}?search=${encodeURIComponent(search)}&filter=gguf&sort=downloads&direction=-1&limit=${limit}`;
}

interface HfRaw {
  modelId?: string;
  id?: string;
  tags?: string[];
  [key: string]: unknown;
}

/**
 * Cherche des modèles sans censure en interrogeant HuggingFace avec plusieurs
 * formulations (« <requête> abliterated », « <requête> uncensored », …), fusionne
 * les résultats, écarte les doublons et ne garde que ceux qui sont réellement
 * marqués abliterated / uncensored. Les plus téléchargés sont placés en premier.
 */
export async function findAbliteratedModels(
  query: string,
  opts: { fetchImpl?: typeof fetch; signal?: AbortSignal; limit?: number } = {},
): Promise<HfRaw[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const q = query.trim();
  const variants = q
    ? [`${q} abliterated`, `${q} uncensored`]
    : ["abliterated", "uncensored"];

  const responses = await Promise.allSettled(
    variants.map(async (search) => {
      const r = await fetchImpl(hfSearchUrl(search, opts.limit ?? 30), { signal: opts.signal });
      if (!r.ok) return [] as HfRaw[];
      const data = await r.json();
      return Array.isArray(data) ? (data as HfRaw[]) : [];
    }),
  );

  const seen = new Set<string>();
  const merged: HfRaw[] = [];
  for (const res of responses) {
    if (res.status !== "fulfilled") continue;
    for (const item of res.value) {
      const id = item.modelId || item.id || "";
      if (!id || seen.has(id)) continue;
      if (!isAbliterated(id, item.tags ?? [])) continue;
      seen.add(id);
      merged.push(item);
    }
  }
  return merged;
}

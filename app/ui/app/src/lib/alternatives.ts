const STORAGE_KEY = "dromadaire-alternatives";

export type Alternative = {
  content: string;
  thinking: string;
  model: string;
  created_at: string;
};

type AlternativesMap = Record<string, Alternative[]>;

function getKey(chatId: string, msgIdx: number): string {
  return `${chatId}:${msgIdx}`;
}

function loadAll(): AlternativesMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveAll(data: AlternativesMap) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function getAlternatives(chatId: string, msgIdx: number): Alternative[] {
  const all = loadAll();
  return all[getKey(chatId, msgIdx)] || [];
}

export function addAlternative(chatId: string, msgIdx: number, alt: Alternative): void {
  const all = loadAll();
  const key = getKey(chatId, msgIdx);
  const existing = all[key] || [];
  // Avoid duplicate by content
  if (existing.some((a) => a.content === alt.content)) return;
  existing.push(alt);
  // Cap at 10 alternatives per message
  if (existing.length > 10) existing.shift();
  all[key] = existing;
  saveAll(all);
}

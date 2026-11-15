// Téléchargement de modèles (/api/pull) fiable.
//
// Le serveur envoie sa progression en NDJSON sur un flux HTTP 200. Une erreur
// survenue pendant le téléchargement arrive donc comme une ligne
// {"error": "..."} et non comme un statut HTTP : il faut la détecter. Un flux
// qui se ferme sans {"status": "success"} est une interruption, pas un succès.

export interface PullProgress {
  status: string;
  completed: number;
  total: number;
  percent: number;
}

/** Erreur de téléchargement lisible par l'utilisateur. */
export class PullError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = "PullError";
    this.retryable = retryable;
  }
}

export interface PullOptions {
  apiBase: string;
  name: string;
  onProgress: (p: PullProgress) => void;
  signal?: AbortSignal;
  /** Nombre de nouvelles tentatives après une coupure réseau (défaut 2). */
  maxRetries?: number;
  /** Délai entre tentatives en ms (défaut 1000 ; doublé à chaque tentative). */
  retryDelayMs?: number;
  fetchImpl?: typeof fetch;
}

interface PullLineResult {
  success: boolean;
}

/**
 * Traduit les erreurs techniques du serveur en messages clairs.
 * Retourne le message d'origine si aucun motif ne correspond.
 */
export function friendlyPullError(raw: string): string {
  const msg = raw.toLowerCase();
  if (msg.includes("does not match original host") || msg.includes("manifest") && msg.includes("not found") || msg.includes("404")) {
    return "Modèle introuvable sur HuggingFace : vérifiez le nom du dépôt et le quantification.";
  }
  if (msg.includes("401") || msg.includes("403") || msg.includes("unauthorized") || msg.includes("forbidden")) {
    return "Accès refusé par HuggingFace (dépôt privé ou restreint).";
  }
  if (msg.includes("no space left") || msg.includes("disk full") || msg.includes("insufficient")) {
    return "Espace disque insuffisant pour télécharger ce modèle.";
  }
  return raw;
}

/** Traite une ligne NDJSON. Lance une PullError si le serveur signale une erreur. */
export function handlePullLine(line: string, onProgress: (p: PullProgress) => void): PullLineResult {
  let obj: any;
  try {
    obj = JSON.parse(line);
  } catch {
    // Ligne non JSON : on l'ignore, le serveur n'en produit pas en fonctionnement normal.
    return { success: false };
  }
  if (obj && typeof obj.error === "string" && obj.error) {
    throw new PullError(friendlyPullError(obj.error), false);
  }
  const completed = Number(obj?.completed) || 0;
  const total = Number(obj?.total) || 0;
  const percent = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;
  if (obj?.status !== "success") {
    onProgress({ status: obj?.status || "Téléchargement…", completed, total, percent });
  }
  return { success: obj?.status === "success" };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(abortError());
    }, { once: true });
  });
}

function abortError(): Error {
  const e = new Error("Téléchargement annulé");
  e.name = "AbortError";
  return e;
}

/** Une seule tentative de téléchargement. Retourne true si le serveur a confirmé la fin. */
async function pullOnce(opts: PullOptions, fetchImpl: typeof fetch): Promise<boolean> {
  let resp: Response;
  try {
    resp = await fetchImpl(`${opts.apiBase}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: opts.name, stream: true }),
      signal: opts.signal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new PullError("Connexion au serveur impossible", true);
  }

  if (!resp.ok) {
    let detail = "";
    try {
      const body = await resp.json();
      detail = body?.error || "";
    } catch {
      // corps non JSON
    }
    const retryable = resp.status >= 500;
    throw new PullError(detail || `Erreur serveur (HTTP ${resp.status})`, retryable);
  }
  if (!resp.body) {
    throw new PullError("Réponse vide du serveur", true);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let success = false;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        if (handlePullLine(line, opts.onProgress).success) success = true;
      }
    }
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    if (err instanceof PullError) throw err;
    throw new PullError("Connexion interrompue pendant le téléchargement", true);
  }

  // Traite le dernier fragment, même sans saut de ligne final.
  buf += decoder.decode();
  if (buf.trim()) {
    if (handlePullLine(buf, opts.onProgress).success) success = true;
  }
  return success;
}

/**
 * Télécharge un modèle avec progression. Résout quand le serveur confirme
 * « success ». Relance automatiquement après une coupure réseau ; Ollama
 * reprend les fichiers déjà partiellement reçus.
 */
export async function pullModelStream(opts: PullOptions): Promise<void> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const maxRetries = opts.maxRetries ?? 2;
  let delay = opts.retryDelayMs ?? 1000;

  for (let attempt = 0; ; attempt++) {
    if (opts.signal?.aborted) throw abortError();
    try {
      const ok = await pullOnce(opts, fetchImpl);
      if (ok) {
        opts.onProgress({ status: "Terminé", completed: 1, total: 1, percent: 100 });
        return;
      }
      throw new PullError("Le téléchargement s'est interrompu avant la fin", true);
    } catch (err) {
      if ((err as Error).name === "AbortError") throw err;
      const retryable = err instanceof PullError ? err.retryable : true;
      if (!retryable || attempt >= maxRetries) {
        if (err instanceof PullError) throw err;
        throw new PullError("Téléchargement échoué", false);
      }
      opts.onProgress({
        status: `Nouvelle tentative dans ${Math.round(delay / 1000)} s…`,
        completed: 0,
        total: 0,
        percent: 0,
      });
      await sleep(delay, opts.signal);
      delay *= 2;
    }
  }
}

/** Nom à passer à /api/pull : les dépôts HuggingFace sont préfixés par hf.co/ et peuvent porter un quant. */
export function pullNameFor(modelName: string, quant?: string): string {
  if (!modelName.includes("/")) return modelName;
  return `hf.co/${modelName}${quant ? `:${quant}` : ""}`;
}

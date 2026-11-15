import { describe, it, expect, vi } from "vitest";
import { pullModelStream, pullNameFor, PullError, handlePullLine } from "./modelPull";

function ndjson(lines: object[], trailingNewline = true): Response {
  const text = lines.map((l) => JSON.stringify(l)).join("\n") + (trailingNewline ? "\n" : "");
  return new Response(text, { status: 200 });
}

const base = { apiBase: "", name: "hf.co/a/b:Q4_K_M", retryDelayMs: 0 };

describe("pullModelStream", () => {
  it("résout quand le serveur confirme success et envoie la progression", async () => {
    const progress: string[] = [];
    const fetchImpl = vi.fn(async () =>
      ndjson([{ status: "pulling manifest" }, { status: "downloading", completed: 50, total: 100 }, { status: "success" }]),
    ) as unknown as typeof fetch;
    await pullModelStream({ ...base, fetchImpl, onProgress: (p) => progress.push(`${p.status}:${p.percent}`) });
    expect(progress).toContain("downloading:50");
    expect(progress.at(-1)).toBe("Terminé:100");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("détecte une erreur envoyée dans le flux (HTTP 200) et ne la relance pas", async () => {
    const fetchImpl = vi.fn(async () => ndjson([{ status: "pulling" }, { error: "model requires more system memory" }])) as unknown as typeof fetch;
    await expect(pullModelStream({ ...base, fetchImpl, onProgress: () => {} })).rejects.toMatchObject({
      message: "model requires more system memory",
      retryable: false,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("refuse un flux qui se ferme sans success (interruption)", async () => {
    const fetchImpl = vi.fn(async () => ndjson([{ status: "downloading", completed: 10, total: 100 }])) as unknown as typeof fetch;
    await expect(pullModelStream({ ...base, fetchImpl, onProgress: () => {}, maxRetries: 1 })).rejects.toThrow(/interrompu/);
    expect(fetchImpl).toHaveBeenCalledTimes(2); // une tentative + une relance
  });

  it("relance après une erreur serveur 5xx puis réussit", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "busy" }), { status: 503 }))
      .mockResolvedValueOnce(ndjson([{ status: "success" }])) as unknown as typeof fetch;
    await pullModelStream({ ...base, fetchImpl, onProgress: () => {} });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("n'essaie pas à nouveau sur une erreur 404 et affiche le message du serveur", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: "model not found" }), { status: 404 })) as unknown as typeof fetch;
    await expect(pullModelStream({ ...base, fetchImpl, onProgress: () => {} })).rejects.toMatchObject({ message: "model not found" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("traite le dernier fragment même sans saut de ligne final", async () => {
    const progress: number[] = [];
    const fetchImpl = vi.fn(async () => ndjson([{ status: "downloading", completed: 1, total: 4 }, { status: "success" }], false)) as unknown as typeof fetch;
    await pullModelStream({ ...base, fetchImpl, onProgress: (p) => progress.push(p.percent) });
    expect(progress).toContain(25);
  });

  it("s'arrête immédiatement si l'annulation est demandée", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn(async () => ndjson([{ status: "success" }])) as unknown as typeof fetch;
    await expect(pullModelStream({ ...base, fetchImpl, signal: controller.signal, onProgress: () => {} })).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("handlePullLine", () => {
  it("ignore les lignes non JSON", () => {
    expect(handlePullLine("pas du json", () => {})).toEqual({ success: false });
  });
  it("lève PullError pour une ligne error", () => {
    expect(() => handlePullLine('{"error":"boom"}', () => {})).toThrow(PullError);
  });
});

describe("pullNameFor", () => {
  it("ajoute hf.co/ et le quant pour les dépôts HuggingFace", () => {
    expect(pullNameFor("user/repo-GGUF", "Q4_K_M")).toBe("hf.co/user/repo-GGUF:Q4_K_M");
    expect(pullNameFor("user/repo-GGUF")).toBe("hf.co/user/repo-GGUF");
  });
  it("laisse les noms de la bibliothèque Ollama inchangés", () => {
    expect(pullNameFor("llama3.2:3b")).toBe("llama3.2:3b");
  });
});

import { friendlyPullError } from "./modelPull";

describe("friendlyPullError", () => {
  it("explique un dépôt introuvable", () => {
    expect(friendlyPullError('realm host "huggingface.co" does not match original host "hf.co"')).toMatch(/introuvable/);
  });
  it("explique un accès refusé et un disque plein", () => {
    expect(friendlyPullError("HTTP 403 Forbidden")).toMatch(/Accès refusé/);
    expect(friendlyPullError("write: no space left on device")).toMatch(/Espace disque/);
  });
  it("garde les autres messages tels quels", () => {
    expect(friendlyPullError("model requires more system memory")).toBe("model requires more system memory");
  });
});

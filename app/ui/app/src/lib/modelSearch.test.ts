import { describe, it, expect, vi } from "vitest";
import { isAbliterated, rankAbliteratedFirst, findAbliteratedModels, hfSearchUrl } from "./modelSearch";

describe("isAbliterated", () => {
  it("reconnaît les noms et les tags", () => {
    expect(isAbliterated("huihui-ai/Qwen2.5-abliterated-GGUF")).toBe(true);
    expect(isAbliterated("org/model-GGUF", ["uncensored"])).toBe(true);
    expect(isAbliterated("bartowski/Phi-3.5-mini-GGUF", ["gguf"])).toBe(false);
  });
});

describe("rankAbliteratedFirst", () => {
  it("place les abliterated en premier, puis trie par téléchargements", () => {
    const ranked = rankAbliteratedFirst([
      { name: "a/plain-big", downloads: 9000 },
      { name: "b/Model-abliterated", downloads: 100 },
      { name: "c/plain-small", downloads: 50 },
      { name: "d/Other-uncensored", downloads: 300 },
    ]);
    expect(ranked.map((m) => m.name)).toEqual(["d/Other-uncensored", "b/Model-abliterated", "a/plain-big", "c/plain-small"]);
  });
});

describe("findAbliteratedModels", () => {
  it("interroge plusieurs formulations, fusionne, dédoublonne et ne garde que les modèles sans censure", async () => {
    const byQuery: Record<string, unknown[]> = {
      "qwen abliterated": [
        { modelId: "x/qwen-abliterated-GGUF", tags: ["gguf"] },
        { modelId: "x/qwen-plain-GGUF", tags: ["gguf"] },
      ],
      "qwen uncensored": [
        { modelId: "x/qwen-abliterated-GGUF", tags: ["gguf"] },
        { modelId: "y/qwen-uncensored-GGUF", tags: ["gguf"] },
      ],
    };
    const fetchImpl = vi.fn(async (url: string) => {
      const search = decodeURIComponent(new URL(url).searchParams.get("search") ?? "");
      return new Response(JSON.stringify(byQuery[search] ?? []), { status: 200 });
    }) as unknown as typeof fetch;

    const found = await findAbliteratedModels("qwen", { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(found.map((m) => m.modelId)).toEqual(["x/qwen-abliterated-GGUF", "y/qwen-uncensored-GGUF"]);
  });

  it("tolère une formulation en erreur", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("abliterated")) throw new Error("réseau");
      return new Response(JSON.stringify([{ modelId: "z/Foo-uncensored", tags: [] }]), { status: 200 });
    }) as unknown as typeof fetch;
    const found = await findAbliteratedModels("", { fetchImpl });
    expect(found.map((m) => m.modelId)).toEqual(["z/Foo-uncensored"]);
  });
});

describe("hfSearchUrl", () => {
  it("encode la requête et filtre GGUF", () => {
    const u = hfSearchUrl("a b");
    expect(u).toContain("search=a%20b");
    expect(u).toContain("filter=gguf");
  });
});

describe("termes de retrait de censure", () => {
  it("reconnaît aussi les variantes Heretic", () => {
    expect(isAbliterated("0bserverx/Qwen3.8-27B-Heretic-GGUF")).toBe(true);
  });
});

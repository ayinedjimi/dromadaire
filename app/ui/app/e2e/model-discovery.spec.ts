import { test, expect } from "./fixtures";

// Téléchargeur de modèles : préréglages (Tous / Abliterated / Compatibles)
// et filtrage par matériel. Les réponses HuggingFace sont mockées : aucun
// accès réseau, aucun GPU requis.

const HF_RESULTS = [
  {
    modelId: "huihui-ai/Qwen2.5-3B-Instruct-abliterated-GGUF",
    tags: ["gguf", "abliterated"],
    downloads: 1200,
    likes: 40,
    siblings: [{ rfilename: "qwen2.5-3b-instruct-abliterated-q4_k_m.gguf" }],
  },
  {
    modelId: "bartowski/Llama-3.3-70B-Instruct-GGUF",
    tags: ["gguf"],
    downloads: 9000,
    likes: 300,
    siblings: [{ rfilename: "Llama-3.3-70B-Instruct-Q4_K_M.gguf" }],
  },
  {
    modelId: "bartowski/Phi-3.5-mini-instruct-GGUF",
    tags: ["gguf"],
    downloads: 5000,
    likes: 120,
    siblings: [{ rfilename: "Phi-3.5-mini-instruct-Q4_K_M.gguf" }],
  },
];

test.describe("Téléchargeur de modèles — préréglages", () => {
  let hfQueries: string[] = [];

  test.beforeEach(async ({ page }) => {
    hfQueries = [];
    await page.route("https://huggingface.co/api/**", (route) => {
      const url = new URL(route.request().url());
      hfQueries.push(url.searchParams.get("search") ?? "");
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(HF_RESULTS) });
    });
    // Ressources système mockées : 32 Go de RAM, 20 Go disponibles.
    await page.route("**/api/v1/system-resources", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          totalBytes: 32 * 1024 ** 3,
          availableBytes: 20 * 1024 ** 3,
          usedBytes: 12 * 1024 ** 3,
          usedPercent: 37.5,
          totalGB: 32,
          availableGB: 20,
          usedGB: 12,
        }),
      }),
    );
    await page.goto("/models");
    await expect(page.getByTestId("online-toggle")).toBeVisible({ timeout: 15000 });
  });

  test("le mode connecté affiche les préréglages", async ({ page }) => {
    await page.getByTestId("online-toggle").click();
    await expect(page.getByTestId("preset-all")).toBeVisible();
    await expect(page.getByTestId("preset-abliterated")).toBeVisible();
    await expect(page.getByTestId("preset-compatible")).toBeVisible();
  });

  test("le préréglage Abliterated interroge HuggingFace avec le mot-clé", async ({ page }) => {
    await page.getByTestId("online-toggle").click();
    await page.getByTestId("preset-abliterated").click();
    await expect(page.getByTestId("preset-abliterated")).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => hfQueries.some((q) => q.includes("abliterated"))).toBe(true);
    await expect(page.getByTestId("model-card").first()).toBeVisible();
  });

  test("le badge abliterated est posé sur les modèles sans censure", async ({ page }) => {
    await page.getByTestId("online-toggle").click();
    await page.getByTestId("preset-abliterated").click();
    const abliterated = page.locator('[data-testid="model-card"][data-abliterated="true"]');
    await expect(abliterated).toHaveCount(1);
    await expect(abliterated).toHaveAttribute("data-model", /abliterated/);
  });

  test("le préréglage Compatibles retire les modèles trop gros", async ({ page }) => {
    await page.getByTestId("online-toggle").click();
    await page.getByTestId("preset-all").click();
    await expect(page.locator('[data-model="bartowski/Llama-3.3-70B-Instruct-GGUF"]')).toBeVisible();

    await page.getByTestId("preset-compatible").click();
    await expect(page.locator('[data-model="bartowski/Llama-3.3-70B-Instruct-GGUF"]')).toHaveCount(0);
    await expect(page.locator('[data-model="bartowski/Phi-3.5-mini-instruct-GGUF"]')).toBeVisible();
  });

  test("la recherche libre reste active après un préréglage", async ({ page }) => {
    await page.getByTestId("online-toggle").click();
    await page.getByTestId("preset-abliterated").click();
    await page.getByTestId("model-search").fill("qwen");
    await expect.poll(() => hfQueries.some((q) => q.includes("qwen"))).toBe(true);
    await expect.poll(() => hfQueries.some((q) => q.includes("qwen abliterated"))).toBe(true);
  });
});

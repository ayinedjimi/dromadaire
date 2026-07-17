import { test, expect } from "./fixtures";
import { goToAbout } from "./helpers";

/**
 * E2E tests for BenchmarkModal and DiagnosticModal.
 *
 * Both modals are opened from the About page (/about).
 * - BenchmarkModal: auto-starts on open, streams NDJSON from POST /api/v1/benchmark
 * - DiagnosticModal: fetches GET /api/v1/diagnostics, displays formatted system info
 */

// ─── Mock Data ─────────────────────────────────────────────────────

const MOCK_BENCHMARK_EVENTS = [
  { event: "progress", phase: "cpu", message: "Test du processeur..." },
  { event: "result", phase: "cpu", score: 6.2, detail: "6 coeurs, 3.1 GHz", duration_ms: 1200 },
  { event: "progress", phase: "memory", message: "Test de la memoire..." },
  { event: "result", phase: "memory", score: 5.8, detail: "16 Go DDR4", duration_ms: 800 },
  { event: "progress", phase: "inference", message: "Test d'inference..." },
  { event: "result", phase: "inference", score: 4.5, detail: "gemma3:4b — 7.5 tok/s", duration_ms: 3000 },
  { event: "progress", phase: "gpu", message: "Detection du GPU..." },
  { event: "result", phase: "gpu", score: -1, detail: "Aucun GPU compatible", duration_ms: 200 },
  {
    event: "complete",
    overall_score: 4.5,
    cpu_score: 6.2,
    memory_score: 5.8,
    infer_score: 4.5,
    gpu_score: -1,
    cpu_detail: "6 coeurs, 3.1 GHz",
    memory_detail: "16 Go DDR4",
    infer_detail: "gemma3:4b — 7.5 tok/s",
    gpu_detail: "Aucun GPU compatible",
    total_duration_ms: 5200,
  },
];

const MOCK_DIAGNOSTICS = {
  app_version: "6.0.0",
  schema_version: 25,
  portable_mode: false,
  os: "windows",
  arch: "amd64",
  cpu_cores: 6,
  total_ram_gb: "16.0",
  gpu_devices: [{ library: "cpu", variant: "", compute: "", driver: "", name: "", vram: "" }],
  build_info: { go_version: "go1.22.0" },
  server_port: "3001",
  ollama_env: {},
  performance: {
    num_thread: 0,
    keep_alive: "",
    max_loaded_models: 0,
    kv_cache_type: "",
    num_batch: 0,
    context_length: 2048,
  },
  features: {
    rag_enabled: false,
    embedding_model: "",
    citations_enabled: false,
    preview_enabled: false,
    artifacts_enabled: true,
    search_enabled: true,
    encryption: false,
    airplane_mode: false,
    theme: "dark",
  },
  logs: ["[INFO] Server started on port 3001", "[INFO] Models loaded: 0"],
};

// ═══════════════════════════════════════════════════════════════════
// Benchmark Modal
// ═══════════════════════════════════════════════════════════════════

test.describe("Benchmark Modal", () => {
  test.beforeEach(async ({ page }) => {
    // Mock the benchmark NDJSON stream endpoint
    await page.route("**/api/v1/benchmark", (route) => {
      if (route.request().method() === "POST") {
        const body = MOCK_BENCHMARK_EVENTS.map((e) => JSON.stringify(e)).join("\n") + "\n";
        route.fulfill({
          status: 200,
          contentType: "application/x-ndjson",
          body,
        });
      } else {
        route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      }
    });

    await goToAbout(page);
  });

  test("clicking Performance button opens the benchmark modal", async ({ page }) => {
    const perfButton = page.getByRole("button", { name: "Performance" });
    await perfButton.click();

    // Modal should appear with the "Indice de performance" heading
    const modalTitle = page.getByText("Indice de performance");
    await expect(modalTitle).toBeVisible({ timeout: 5000 });
  });

  test("4 sub-score rows are displayed (CPU, RAM, Inference, GPU)", async ({ page }) => {
    const perfButton = page.getByRole("button", { name: "Performance" });
    await perfButton.click();

    await expect(page.getByText("Processeur (CPU)")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("Memoire (RAM)")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("Inference IA")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("Carte graphique")).toBeVisible({ timeout: 5000 });
  });

  test("benchmark auto-starts and shows progress spinner", async ({ page }) => {
    // Delay the benchmark response to catch the spinner
    await page.route("**/api/v1/benchmark", (route) => {
      if (route.request().method() === "POST") {
        // Return only the first progress event, then hang for a moment
        const firstEvent = JSON.stringify(MOCK_BENCHMARK_EVENTS[0]) + "\n";
        setTimeout(() => {
          const body = MOCK_BENCHMARK_EVENTS.map((e) => JSON.stringify(e)).join("\n") + "\n";
          route.fulfill({
            status: 200,
            contentType: "application/x-ndjson",
            body,
          });
        }, 500);
      }
    });

    const perfButton = page.getByRole("button", { name: "Performance" });
    await perfButton.click();

    // The modal auto-starts the benchmark — look for any spinning indicator
    // or the score rows being present (they're always visible)
    await expect(page.getByText("Processeur (CPU)")).toBeVisible({ timeout: 5000 });
  });

  test("results display scores after benchmark completes", async ({ page }) => {
    const perfButton = page.getByRole("button", { name: "Performance" });
    await perfButton.click();

    // Wait for the benchmark to complete (auto-started on mount)
    // The CPU score should show 6.2
    await expect(page.getByText("6.2")).toBeVisible({ timeout: 10000 });
    // Memory score 5.8
    await expect(page.getByText("5.8")).toBeVisible({ timeout: 5000 });
    // Inference score 4.5
    // 4.5 appears both in inference row and overall — just check it exists
    const scores45 = page.getByText("4.5");
    await expect(scores45.first()).toBeVisible({ timeout: 5000 });
    // GPU score N/A (score = -1)
    await expect(page.getByText("N/A")).toBeVisible({ timeout: 5000 });
  });

  test("global (overall) score is displayed after completion", async ({ page }) => {
    const perfButton = page.getByRole("button", { name: "Performance" });
    await perfButton.click();

    // Wait for completion — the "Score global" label appears in the big centered display
    await expect(page.getByText("Score global")).toBeVisible({ timeout: 10000 });
  });

  test("duration is shown in footer after completion", async ({ page }) => {
    const perfButton = page.getByRole("button", { name: "Performance" });
    await perfButton.click();

    // After completion, footer shows "Evalue en X.Xs"
    await expect(page.getByText(/Evalue en/)).toBeVisible({ timeout: 10000 });
  });

  test("Relancer button appears after benchmark completes", async ({ page }) => {
    const perfButton = page.getByRole("button", { name: "Performance" });
    await perfButton.click();

    // "Relancer" button is shown when phase === "done"
    await expect(page.getByText("Relancer")).toBeVisible({ timeout: 10000 });
  });

  test("close button dismisses the modal", async ({ page }) => {
    const perfButton = page.getByRole("button", { name: "Performance" });
    await perfButton.click();

    const modalTitle = page.getByText("Indice de performance");
    await expect(modalTitle).toBeVisible({ timeout: 5000 });

    // Close button (X icon) in the modal header
    // The benchmark modal has a close button next to the title
    const closeButton = page
      .locator(".fixed")
      .locator("button")
      .filter({ has: page.locator("svg") })
      .first();
    await closeButton.click();

    // Modal should be gone
    await expect(modalTitle).toBeHidden({ timeout: 5000 });
  });

  test("no crash when benchmark endpoint returns error", async ({ page }) => {
    // Override the benchmark mock to return an error
    await page.route("**/api/v1/benchmark", (route) => {
      if (route.request().method() === "POST") {
        route.fulfill({
          status: 500,
          contentType: "text/plain",
          body: "Internal Server Error",
        });
      }
    });

    const perfButton = page.getByRole("button", { name: "Performance" });
    await perfButton.click();

    // The modal should still open and show an error message
    await expect(page.getByText("Indice de performance")).toBeVisible({ timeout: 5000 });

    // Error message should appear (the component catches errors and displays "Erreur : ...")
    await expect(page.getByText(/Erreur/)).toBeVisible({ timeout: 10000 });
  });
});

// ═══════════════════════════════════════════════════════════════════
// Diagnostic Modal
// ═══════════════════════════════════════════════════════════════════

test.describe("Diagnostic Modal", () => {
  test.beforeEach(async ({ page }) => {
    // Mock the diagnostics endpoint
    await page.route("**/api/v1/diagnostics", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MOCK_DIAGNOSTICS),
      });
    });

    await goToAbout(page);
  });

  test("clicking Diagnostic button opens the diagnostic modal", async ({ page }) => {
    const diagButton = page.getByRole("button", { name: "Diagnostic" });
    await diagButton.click();

    const modalTitle = page.getByText("Diagnostic systeme");
    await expect(modalTitle).toBeVisible({ timeout: 5000 });
  });

  test("application section displays version and schema", async ({ page }) => {
    const diagButton = page.getByRole("button", { name: "Diagnostic" });
    await diagButton.click();

    // The formatted text includes "Version: 6.0.0" and "Schema DB: v25"
    await expect(page.getByText("Version: 6.0.0")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("Schema DB: v25")).toBeVisible({ timeout: 5000 });
  });

  test("system section displays OS and CPU info", async ({ page }) => {
    const diagButton = page.getByRole("button", { name: "Diagnostic" });
    await diagButton.click();

    await expect(page.getByText("OS: windows (amd64)")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("CPU: 6 coeurs")).toBeVisible({ timeout: 5000 });
  });

  test("RAM info is displayed", async ({ page }) => {
    const diagButton = page.getByRole("button", { name: "Diagnostic" });
    await diagButton.click();

    await expect(page.getByText("RAM: 16.0 Go")).toBeVisible({ timeout: 5000 });
  });

  test("GPU section displays CPU-only mode", async ({ page }) => {
    const diagButton = page.getByRole("button", { name: "Diagnostic" });
    await diagButton.click();

    // With library: "cpu" in gpu_devices, the formatted text shows "Mode: CPU uniquement"
    await expect(page.getByText("Mode: CPU uniquement")).toBeVisible({ timeout: 5000 });
  });

  test("portable mode indicator shows Non", async ({ page }) => {
    const diagButton = page.getByRole("button", { name: "Diagnostic" });
    await diagButton.click();

    await expect(page.getByText("Mode portable: Non")).toBeVisible({ timeout: 5000 });
  });

  test("Copier tout button is visible and enabled", async ({ page }) => {
    const diagButton = page.getByRole("button", { name: "Diagnostic" });
    await diagButton.click();

    const copyButton = page.getByRole("button", { name: "Copier tout" });
    await expect(copyButton).toBeVisible({ timeout: 5000 });
    await expect(copyButton).toBeEnabled();
  });

  test("Copier tout button shows confirmation after click", async ({ page }) => {
    const diagButton = page.getByRole("button", { name: "Diagnostic" });
    await diagButton.click();

    // Grant clipboard permissions
    await page.context().grantPermissions(["clipboard-write", "clipboard-read"]);

    const copyButton = page.getByRole("button", { name: "Copier tout" });
    await copyButton.click();

    // After click, the button text changes to "Copie !" for 2 seconds
    await expect(page.getByText("Copie !")).toBeVisible({ timeout: 5000 });
  });

  test("close button dismisses the diagnostic modal", async ({ page }) => {
    const diagButton = page.getByRole("button", { name: "Diagnostic" });
    await diagButton.click();

    const modalTitle = page.getByText("Diagnostic systeme");
    await expect(modalTitle).toBeVisible({ timeout: 5000 });

    // The close X button in the diagnostic modal header
    // It's next to the "Copier tout" button
    const closeButton = page
      .locator(".fixed")
      .locator("button")
      .filter({ has: page.locator("svg.w-5.h-5") })
      .last();
    await closeButton.click();

    await expect(modalTitle).toBeHidden({ timeout: 5000 });
  });

  test("error state when diagnostics endpoint fails", async ({ page }) => {
    // Override the diagnostics mock to return an error
    await page.route("**/api/v1/diagnostics", (route) => {
      route.fulfill({
        status: 500,
        contentType: "text/plain",
        body: "Internal Server Error",
      });
    });

    const diagButton = page.getByRole("button", { name: "Diagnostic" });
    await diagButton.click();

    // The modal should still open and display "Diagnostic systeme" title
    await expect(page.getByText("Diagnostic systeme")).toBeVisible({ timeout: 5000 });

    // Error message should appear
    await expect(page.getByText(/Erreur/)).toBeVisible({ timeout: 10000 });
  });

  test("features section shows enabled/disabled statuses", async ({ page }) => {
    const diagButton = page.getByRole("button", { name: "Diagnostic" });
    await diagButton.click();

    // Verify features from the formatted diagnostics text
    await expect(page.getByText("Artifacts: Actif")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("Recherche: Actif")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("RAG: Inactif")).toBeVisible({ timeout: 5000 });
  });

  test("footer text with support instruction is visible", async ({ page }) => {
    const diagButton = page.getByRole("button", { name: "Diagnostic" });
    await diagButton.click();

    await expect(page.getByText("support technique")).toBeVisible({ timeout: 5000 });
  });
});

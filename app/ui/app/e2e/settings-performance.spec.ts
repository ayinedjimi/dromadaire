import { test, expect } from "./fixtures";
import { goToSettings } from "./helpers";
import type { Page } from "@playwright/test";

/**
 * Performance settings E2E tests for Dromadaire v6.
 *
 * Covers: NumThread, ContextLength (in perf section), KeepAlive,
 * MaxLoadedModels, KVCacheType, NumBatch, VulkanEnabled,
 * and the restart notification banner.
 *
 * The hardware-info and restart-server endpoints are not mocked in
 * fixtures.ts, so we add them here to avoid fetch errors.
 */

const MOCK_HARDWARE_INFO = {
  cpuCores: 6,
  totalRAMGB: 16.0,
  isGPU: false,
  gpuName: "",
  vram: "",
};

/** Capture all POST payloads to /api/v1/settings without overriding the mock. */
function captureSettingsPayloads(page: Page) {
  const payloads: Record<string, unknown>[] = [];
  page.on("request", (req) => {
    if (
      req.url().includes("/api/v1/settings") &&
      req.method() === "POST"
    ) {
      try {
        payloads.push(req.postDataJSON());
      } catch {
        // ignore parse errors
      }
    }
  });
  return () => payloads;
}

/** Set up hardware-info, autoconfig, and restart-server mocks. */
async function setupPerfMocks(page: Page) {
  await page.route("**/api/v1/hardware-info", (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(MOCK_HARDWARE_INFO),
    });
  });

  await page.route("**/api/v1/autoconfig", (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        hardware: MOCK_HARDWARE_INFO,
        settings: {},
      }),
    });
  });

  await page.route("**/api/v1/restart-server", (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });
}

// ─── Test Suite ───────────────────────────────────────────────────────

test.describe("Settings Performance — NumThread (Threads CPU)", () => {
  test.beforeEach(async ({ page }) => {
    await setupPerfMocks(page);
    await goToSettings(page);
  });

  test("threads CPU select is visible with label", async ({ page }) => {
    await expect(
      page.getByText("Threads CPU").first(),
    ).toBeVisible({ timeout: 10000 });

    // The select should contain an "Auto" option
    const threadSelect = page.locator("select").filter({
      has: page.locator("option", { hasText: "Auto" }),
    }).filter({
      has: page.locator("option", { hasText: "coeur" }),
    });
    await expect(threadSelect).toBeVisible({ timeout: 5000 });
  });

  test("changing thread count sends POST and shows restart banner", async ({ page }) => {
    const getPayloads = captureSettingsPayloads(page);

    // Find the thread select — it has "Auto" option and "coeur(s)" options
    const threadSelect = page.locator("select").filter({
      has: page.locator("option", { hasText: "coeur" }),
    });
    await expect(threadSelect).toBeVisible({ timeout: 10000 });

    // Select 4 threads
    await threadSelect.selectOption("4");
    await page.waitForTimeout(500);

    // Verify POST was sent with NumThread
    const payloads = getPayloads();
    expect(payloads.length).toBeGreaterThanOrEqual(1);
    const payload = payloads.find(
      (p) => (p as Record<string, unknown>).NumThread !== undefined,
    );
    expect(payload).toBeDefined();
    expect((payload as Record<string, unknown>).NumThread).toBe(4);

    // Restart banner should appear
    await expect(
      page.getByText("Redemarrage du serveur requis").first(),
    ).toBeVisible({ timeout: 5000 });
  });

  test("value 0 means auto detection", async ({ page }) => {
    // Default NumThread is 0 in the mock
    const threadSelect = page.locator("select").filter({
      has: page.locator("option", { hasText: "coeur" }),
    });
    await expect(threadSelect).toBeVisible({ timeout: 10000 });

    const selectedValue = await threadSelect.inputValue();
    expect(selectedValue).toBe("0");

    // The "Auto" option text should show auto-detected core count
    const autoOption = threadSelect.locator('option[value="0"]');
    const autoText = await autoOption.textContent();
    expect(autoText).toContain("Auto");
  });
});

// ─── KeepAlive ──────────────────────────────────────────────────────

test.describe("Settings Performance — KeepAlive", () => {
  test.beforeEach(async ({ page }) => {
    await setupPerfMocks(page);
    await goToSettings(page);
  });

  test("keep alive select is visible with label", async ({ page }) => {
    await expect(
      page.getByText("Keep Alive").first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test("changing keep alive sends POST", async ({ page }) => {
    const getPayloads = captureSettingsPayloads(page);

    // The KeepAlive select has options: "", "2m", "5m", "30m", "1h", "-1"
    const keepAliveSelect = page.locator("select").filter({
      has: page.locator('option[value="5m"]'),
    });
    await expect(keepAliveSelect).toBeVisible({ timeout: 10000 });

    await keepAliveSelect.selectOption("5m");
    await page.waitForTimeout(500);

    const payloads = getPayloads();
    expect(payloads.length).toBeGreaterThanOrEqual(1);
    const payload = payloads.find(
      (p) => (p as Record<string, unknown>).KeepAlive !== undefined,
    );
    expect(payload).toBeDefined();
    expect((payload as Record<string, unknown>).KeepAlive).toBe("5m");
  });

  test("keep alive accepts various time formats", async ({ page }) => {
    const keepAliveSelect = page.locator("select").filter({
      has: page.locator('option[value="5m"]'),
    });
    await expect(keepAliveSelect).toBeVisible({ timeout: 10000 });

    // Verify all options exist
    await expect(keepAliveSelect.locator('option[value=""]')).toBeAttached();    // Auto (2 min)
    await expect(keepAliveSelect.locator('option[value="2m"]')).toBeAttached();  // 2 minutes
    await expect(keepAliveSelect.locator('option[value="5m"]')).toBeAttached();  // 5 minutes
    await expect(keepAliveSelect.locator('option[value="30m"]')).toBeAttached(); // 30 minutes
    await expect(keepAliveSelect.locator('option[value="1h"]')).toBeAttached();  // 1 heure
    await expect(keepAliveSelect.locator('option[value="-1"]')).toBeAttached();  // Illimite
  });
});

// ─── MaxLoadedModels ────────────────────────────────────────────────

test.describe("Settings Performance — MaxLoadedModels", () => {
  test.beforeEach(async ({ page }) => {
    await setupPerfMocks(page);
    await goToSettings(page);
  });

  test("max loaded models select is visible with label", async ({ page }) => {
    await expect(
      page.getByText("Modeles simultanes").first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test("changing max loaded models sends POST", async ({ page }) => {
    const getPayloads = captureSettingsPayloads(page);

    // MaxLoadedModels select has: 0 (Auto), 1, 2, 3, 4
    const modelsSelect = page.locator("select").filter({
      has: page.locator("option", { hasText: "Auto" }),
    }).filter({
      has: page.locator('option[value="3"]'),
    });
    await expect(modelsSelect).toBeVisible({ timeout: 10000 });

    await modelsSelect.selectOption("2");
    await page.waitForTimeout(500);

    const payloads = getPayloads();
    expect(payloads.length).toBeGreaterThanOrEqual(1);
    const payload = payloads.find(
      (p) => (p as Record<string, unknown>).MaxLoadedModels !== undefined,
    );
    expect(payload).toBeDefined();
    expect((payload as Record<string, unknown>).MaxLoadedModels).toBe(2);
  });
});

// ─── KVCacheType ────────────────────────────────────────────────────

test.describe("Settings Performance — KVCacheType", () => {
  test.beforeEach(async ({ page }) => {
    await setupPerfMocks(page);
    await goToSettings(page);
  });

  test("KV cache type select is visible with label", async ({ page }) => {
    await expect(
      page.getByText("Cache KV").first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test("KV cache options include f16, q8_0, q4_0", async ({ page }) => {
    const kvSelect = page.locator("select").filter({
      has: page.locator('option[value="q8_0"]'),
    });
    await expect(kvSelect).toBeVisible({ timeout: 10000 });

    await expect(kvSelect.locator('option[value=""]')).toBeAttached();     // Auto (q8_0)
    await expect(kvSelect.locator('option[value="f16"]')).toBeAttached();  // f16
    await expect(kvSelect.locator('option[value="q8_0"]')).toBeAttached(); // q8_0
    await expect(kvSelect.locator('option[value="q4_0"]')).toBeAttached(); // q4_0
  });
});

// ─── NumBatch ───────────────────────────────────────────────────────

test.describe("Settings Performance — NumBatch (Batch Size)", () => {
  test.beforeEach(async ({ page }) => {
    await setupPerfMocks(page);
    await goToSettings(page);
  });

  test("batch size select is visible with label", async ({ page }) => {
    await expect(
      page.getByText("Batch size").first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test("changing batch size sends POST", async ({ page }) => {
    const getPayloads = captureSettingsPayloads(page);

    // NumBatch select: 0 (Auto 256), 128, 256, 512, 1024
    const batchSelect = page.locator("select").filter({
      has: page.locator('option[value="512"]'),
    });
    await expect(batchSelect).toBeVisible({ timeout: 10000 });

    await batchSelect.selectOption("512");
    await page.waitForTimeout(500);

    const payloads = getPayloads();
    expect(payloads.length).toBeGreaterThanOrEqual(1);
    const payload = payloads.find(
      (p) => (p as Record<string, unknown>).NumBatch !== undefined,
    );
    expect(payload).toBeDefined();
    expect((payload as Record<string, unknown>).NumBatch).toBe(512);
  });
});

// ─── VulkanEnabled ──────────────────────────────────────────────────

test.describe("Settings Performance — VulkanEnabled", () => {
  test.beforeEach(async ({ page }) => {
    await setupPerfMocks(page);
    await goToSettings(page);
  });

  test("Vulkan backend toggle is visible with label", async ({ page }) => {
    await expect(
      page.getByText("Backend Vulkan").first(),
    ).toBeVisible({ timeout: 10000 });

    // The switch should exist
    const vulkanField = page.getByText("Backend Vulkan").first()
      .locator("..").locator("..").locator("..");
    const vulkanSwitch = vulkanField.locator('button[role="switch"]');
    await expect(vulkanSwitch).toBeVisible({ timeout: 5000 });
  });

  test("toggling Vulkan sends POST and shows restart banner", async ({ page }) => {
    const getPayloads = captureSettingsPayloads(page);

    const vulkanField = page.getByText("Backend Vulkan").first()
      .locator("..").locator("..").locator("..");
    const vulkanSwitch = vulkanField.locator('button[role="switch"]');
    await expect(vulkanSwitch).toBeVisible({ timeout: 10000 });

    // Enable Vulkan
    await vulkanSwitch.click();
    await page.waitForTimeout(500);

    // Verify POST was sent
    const payloads = getPayloads();
    expect(payloads.length).toBeGreaterThanOrEqual(1);
    const payload = payloads.find(
      (p) => (p as Record<string, unknown>).VulkanEnabled !== undefined,
    );
    expect(payload).toBeDefined();

    // Restart banner should appear
    await expect(
      page.getByText("Redemarrage du serveur requis").first(),
    ).toBeVisible({ timeout: 5000 });
  });
});

// ─── Restart Notification ───────────────────────────────────────────

test.describe("Settings Performance — Restart Notification", () => {
  test.beforeEach(async ({ page }) => {
    await setupPerfMocks(page);
    await goToSettings(page);
  });

  test("restart banner appears after changing any performance setting", async ({ page }) => {
    // Initially no restart banner
    await expect(
      page.getByText("Redemarrage du serveur requis"),
    ).not.toBeVisible();

    // Change KV cache type to trigger needsRestart
    const kvSelect = page.locator("select").filter({
      has: page.locator('option[value="q8_0"]'),
    });
    await expect(kvSelect).toBeVisible({ timeout: 10000 });
    await kvSelect.selectOption("q4_0");
    await page.waitForTimeout(500);

    // Restart banner should now appear with a "Redemarrer" button
    await expect(
      page.getByText("Redemarrage du serveur requis").first(),
    ).toBeVisible({ timeout: 5000 });

    await expect(
      page.getByRole("button", { name: /Redemarrer/ }),
    ).toBeVisible({ timeout: 5000 });
  });

  test("autoconfig button is visible and clickable", async ({ page }) => {
    const autoconfigButton = page.getByRole("button", { name: /Autoconfig/ });
    await expect(autoconfigButton).toBeVisible({ timeout: 10000 });

    // Click autoconfig
    await autoconfigButton.click();
    await page.waitForTimeout(1000);

    // After autoconfig, restart banner should appear (autoconfig sets needsRestart)
    await expect(
      page.getByText("Redemarrage du serveur requis").first(),
    ).toBeVisible({ timeout: 5000 });
  });

  test("hardware info banner appears when hardware-info is available", async ({ page }) => {
    // The hardware info banner shows CPU and RAM info
    await expect(
      page.getByText("CPU : 6 coeurs").first(),
    ).toBeVisible({ timeout: 10000 });
    await expect(
      page.getByText("RAM : 16.0 GB").first(),
    ).toBeVisible({ timeout: 5000 });
  });
});

// ─── Moteur CPU lamazero : moteur et cache KV ───────────────────────

test.describe("Settings Performance — Moteur CPU lamazero", () => {
  test.beforeEach(async ({ page }) => {
    await setupPerfMocks(page);
    await goToSettings(page);
  });

  test("les deux sélecteurs lamazero sont visibles avec leurs options", async ({ page }) => {
    const engine = page.getByTestId("lamazero-engine");
    const kv = page.getByTestId("lamazero-kv");
    await expect(engine).toBeVisible({ timeout: 10000 });
    await expect(kv).toBeVisible();
    await expect(engine.locator('option[value="auto"]')).toBeAttached();
    await expect(engine.locator('option[value="official"]')).toBeAttached();
    await expect(engine.locator('option[value="turbo"]')).toBeAttached();
    await expect(kv.locator('option[value="f16"]')).toBeAttached();
    await expect(kv.locator('option[value="turbo3"]')).toBeAttached();
    await expect(kv.locator('option[value="turbo4"]')).toBeAttached();
  });

  test("changer le moteur et le cache KV envoie les réglages", async ({ page }) => {
    const getPayloads = captureSettingsPayloads(page);
    await page.getByTestId("lamazero-engine").selectOption("turbo");
    await expect.poll(() => getPayloads().some((p) => p.LamazeroEngine === "turbo")).toBe(true);

    await page.getByTestId("lamazero-kv").selectOption("turbo3");
    await expect.poll(() => getPayloads().some((p) => p.LamazeroKVCache === "turbo3")).toBe(true);
  });
});

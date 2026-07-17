import { test, expect } from "./fixtures";
import { goToSettings } from "./helpers";
import type { Page } from "@playwright/test";

/**
 * Deep settings E2E tests for Dromadaire v6.
 *
 * Covers: Model, Context Length, Theme, Security, Features,
 * Retention, System Prompt, and Reset sections.
 *
 * NOTE: The stateful mock in fixtures.ts handles settings POST/GET.
 * We capture POST payloads via page.on("request") so we don't override
 * the existing route (which the app needs for subsequent GETs).
 */

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

// ─── Test Suite ───────────────────────────────────────────────────────

test.describe("Settings Deep — Model Section", () => {
  test.beforeEach(async ({ page }) => {
    await goToSettings(page);
  });

  test("models location field is visible", async ({ page }) => {
    await expect(
      page.getByText("Emplacement des mod").first(),
    ).toBeVisible({ timeout: 10000 });

    // The input for the models path should be present
    const modelsInput = page.locator("input").first();
    await expect(modelsInput).toBeVisible();
  });

  test("browse button is visible next to models path", async ({ page }) => {
    await expect(
      page.getByRole("button", { name: /Parcourir/ }),
    ).toBeVisible({ timeout: 10000 });
  });

  test("selected model is reflected in settings", async ({ page }) => {
    // The default SelectedModel in the mock is "llama3.2:3b"
    const settings = await page.evaluate(async () => {
      const res = await fetch("/api/v1/settings");
      return res.json();
    });
    expect(settings.settings.SelectedModel).toBe("llama3.2:3b");
  });

  test("models path input shows current value from settings", async ({ page }) => {
    // Default Models is "" in the mock — the input should be empty
    const modelsInput = page.locator("input").first();
    const value = await modelsInput.inputValue();
    expect(value).toBe("");
  });
});

// ─── Context Length ──────────────────────────────────────────────────

test.describe("Settings Deep — Context Length", () => {
  test.beforeEach(async ({ page }) => {
    await goToSettings(page);
  });

  test("context length slider is visible with label", async ({ page }) => {
    await expect(
      page.getByText("Longueur du contexte").first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test("all context length options are present in the slider", async ({ page }) => {
    // The Slider renders option labels: 1k, 2k, 4k, 8k, 16k, 32k, 64k
    const expectedLabels = ["1k", "2k", "4k", "8k", "16k", "32k", "64k"];
    for (const label of expectedLabels) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible({
        timeout: 5000,
      });
    }
  });

  test("clicking a context length option sends POST with restart banner", async ({ page }) => {
    const getPayloads = captureSettingsPayloads(page);

    // Click the "2k" label button (value 2048)
    const twoKButton = page.getByText("2k", { exact: true }).first();
    await expect(twoKButton).toBeVisible({ timeout: 5000 });

    // The Slider renders a button above each label — click the parent button area
    // The button is the sibling right above the label div
    await twoKButton.locator("..").locator("button").click();
    await page.waitForTimeout(500);

    // Should show restart banner
    await expect(
      page.getByText("Redemarrage du serveur requis").first(),
    ).toBeVisible({ timeout: 5000 });

    // Should have sent a POST with ContextLength
    const payloads = getPayloads();
    expect(payloads.length).toBeGreaterThanOrEqual(1);
    const lastPayload = payloads[payloads.length - 1];
    expect(lastPayload).toHaveProperty("ContextLength");
  });
});

// ─── Theme Section ──────────────────────────────────────────────────

test.describe("Settings Deep — Theme", () => {
  test.beforeEach(async ({ page }) => {
    await goToSettings(page);
  });

  test("theme select has all 6 themes", async ({ page }) => {
    const themeSelect = page.locator("select").filter({
      has: page.locator('option[value="dark"]'),
    });
    await expect(themeSelect).toBeVisible({ timeout: 10000 });

    const options = ["light", "dark", "oled", "sepia", "blue-night", "nord"];
    for (const value of options) {
      await expect(
        themeSelect.locator(`option[value="${value}"]`),
      ).toBeAttached();
    }
  });

  test("changing theme sends POST and updates HTML classes", async ({ page }) => {
    const getPayloads = captureSettingsPayloads(page);

    const themeSelect = page.locator("select").filter({
      has: page.locator('option[value="dark"]'),
    });
    await expect(themeSelect).toBeVisible({ timeout: 10000 });

    // Switch to "nord"
    await themeSelect.selectOption("nord");
    await page.waitForTimeout(500);

    // Verify POST was sent
    const payloads = getPayloads();
    const themePayload = payloads.find(
      (p) => (p as Record<string, unknown>).Theme !== undefined,
    );
    expect(themePayload).toBeDefined();

    // Verify HTML class was updated
    const htmlClasses = await page.locator("html").getAttribute("class");
    expect(htmlClasses).toContain("nord");
  });
});

// ─── Security Section ───────────────────────────────────────────────

test.describe("Settings Deep — Security", () => {
  test.beforeEach(async ({ page }) => {
    await goToSettings(page);
  });

  test("encryption toggle is visible and functional", async ({ page }) => {
    await expect(
      page.getByText("Chiffrement des conversations").first(),
    ).toBeVisible({ timeout: 10000 });

    const getPayloads = captureSettingsPayloads(page);

    // Find the encryption switch (button role=switch near the encryption label)
    const encryptionField = page.getByText("Chiffrement des conversations").first()
      .locator("..").locator("..").locator("..");
    const encryptionSwitch = encryptionField.locator('button[role="switch"]');
    await expect(encryptionSwitch).toBeVisible({ timeout: 5000 });

    // Click to enable encryption
    await encryptionSwitch.click();
    await page.waitForTimeout(500);

    // Verify POST was sent with EncryptionEnabled
    const payloads = getPayloads();
    expect(payloads.length).toBeGreaterThanOrEqual(1);
    const encPayload = payloads.find(
      (p) => (p as Record<string, unknown>).EncryptionEnabled !== undefined,
    );
    expect(encPayload).toBeDefined();
  });

  test("password protection section is visible with form", async ({ page }) => {
    await expect(
      page.getByText("Protection par mot de passe").first(),
    ).toBeVisible({ timeout: 10000 });

    // When password is NOT enabled (default), show "set password" form
    await expect(
      page.getByPlaceholder("Nouveau mot de passe").first(),
    ).toBeVisible({ timeout: 5000 });
    await expect(
      page.getByPlaceholder("Confirmer le mot de passe").first(),
    ).toBeVisible();
  });

  test("password form validates minimum length", async ({ page }) => {
    // Mock the set-password endpoint
    await page.route("**/api/v1/auth/set-password", (route) => {
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    });

    const pwdInput = page.getByPlaceholder("Nouveau mot de passe").first();
    await expect(pwdInput).toBeVisible({ timeout: 10000 });

    // Type a short password
    await pwdInput.fill("ab");
    const confirmInput = page.getByPlaceholder("Confirmer le mot de passe").first();
    await confirmInput.fill("ab");

    // Click "Activer le mot de passe" button
    await page.getByRole("button", { name: /Activer le mot de passe/ }).click();
    await page.waitForTimeout(500);

    // Should show validation error
    await expect(
      page.getByText("au moins 4 caract").first(),
    ).toBeVisible({ timeout: 5000 });
  });

  test("lock timeout select appears when password is enabled", async ({ page }) => {
    // Override auth status to simulate password enabled
    await page.route("**/api/v1/auth/status", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ passwordEnabled: true, locked: false }),
      });
    });
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("h1")).toContainText("Param", { timeout: 15000 });

    // Lock timeout select should appear
    await expect(
      page.getByText("Verrouillage automatique").first(),
    ).toBeVisible({ timeout: 10000 });

    // Verify lock timeout options
    const lockSelect = page.locator("select").filter({
      has: page.locator('option[value="5"]'),
    });
    await expect(lockSelect).toBeVisible();
    await expect(lockSelect.locator('option[value="0"]')).toBeAttached();
    await expect(lockSelect.locator('option[value="10"]')).toBeAttached();
    await expect(lockSelect.locator('option[value="30"]')).toBeAttached();
  });

  test("auto-delete on failure toggle appears when password is enabled", async ({ page }) => {
    // Override auth status to simulate password enabled
    await page.route("**/api/v1/auth/status", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ passwordEnabled: true, locked: false }),
      });
    });
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("h1")).toContainText("Param", { timeout: 15000 });

    await expect(
      page.getByText("Auto-suppression (3 echecs)").first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test("clipboard clear seconds select is visible with options", async ({ page }) => {
    await expect(
      page.getByText("Effacer le presse-papiers").first(),
    ).toBeVisible({ timeout: 10000 });

    const clipboardSelect = page.locator("select").filter({
      has: page.locator('option[value="15"]'),
    });
    await expect(clipboardSelect).toBeVisible();

    // Verify all options
    await expect(clipboardSelect.locator('option[value="0"]')).toBeAttached();
    await expect(clipboardSelect.locator('option[value="15"]')).toBeAttached();
    await expect(clipboardSelect.locator('option[value="30"]')).toBeAttached();
    await expect(clipboardSelect.locator('option[value="60"]')).toBeAttached();
  });
});

// ─── Features Section ───────────────────────────────────────────────

test.describe("Settings Deep — Features", () => {
  test.beforeEach(async ({ page }) => {
    await goToSettings(page);
  });

  test("search toggle is visible and sends POST", async ({ page }) => {
    await expect(
      page.getByText("Recherche conversations").first(),
    ).toBeVisible({ timeout: 10000 });

    const getPayloads = captureSettingsPayloads(page);

    // Find the switch near the search label
    const searchField = page.getByText("Recherche conversations").first()
      .locator("..").locator("..").locator("..");
    const searchSwitch = searchField.locator('button[role="switch"]');
    await expect(searchSwitch).toBeVisible({ timeout: 5000 });

    // Toggle it (default is enabled, so clicking disables)
    await searchSwitch.click();
    await page.waitForTimeout(500);

    const payloads = getPayloads();
    expect(payloads.length).toBeGreaterThanOrEqual(1);
    const searchPayload = payloads.find(
      (p) => (p as Record<string, unknown>).SearchEnabled !== undefined,
    );
    expect(searchPayload).toBeDefined();
  });

  test("RAG citations toggle is visible", async ({ page }) => {
    await expect(
      page.getByText("Citations RAG").first(),
    ).toBeVisible({ timeout: 10000 });

    // Switch should exist
    const ragField = page.getByText("Citations RAG").first()
      .locator("..").locator("..").locator("..");
    const ragSwitch = ragField.locator('button[role="switch"]');
    await expect(ragSwitch).toBeVisible({ timeout: 5000 });
  });

  test("RAG preview toggle is visible", async ({ page }) => {
    await expect(
      page.getByText("Apercu documents RAG").first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test("artifacts toggle is visible and sends POST", async ({ page }) => {
    await expect(
      page.getByText("Artifacts interactifs").first(),
    ).toBeVisible({ timeout: 10000 });

    const getPayloads = captureSettingsPayloads(page);

    const artifactsField = page.getByText("Artifacts interactifs").first()
      .locator("..").locator("..").locator("..");
    const artifactsSwitch = artifactsField.locator('button[role="switch"]');
    await expect(artifactsSwitch).toBeVisible({ timeout: 5000 });

    await artifactsSwitch.click();
    await page.waitForTimeout(500);

    const payloads = getPayloads();
    expect(payloads.length).toBeGreaterThanOrEqual(1);
    const payload = payloads.find(
      (p) => (p as Record<string, unknown>).ArtifactsEnabled !== undefined,
    );
    expect(payload).toBeDefined();
  });

  test("keyboard shortcuts toggle is visible and sends POST", async ({ page }) => {
    await expect(
      page.getByText("Raccourcis clavier").first(),
    ).toBeVisible({ timeout: 10000 });

    const getPayloads = captureSettingsPayloads(page);

    const kbField = page.getByText("Raccourcis clavier").first()
      .locator("..").locator("..").locator("..");
    const kbSwitch = kbField.locator('button[role="switch"]');
    await expect(kbSwitch).toBeVisible({ timeout: 5000 });

    await kbSwitch.click();
    await page.waitForTimeout(500);

    const payloads = getPayloads();
    expect(payloads.length).toBeGreaterThanOrEqual(1);
    const payload = payloads.find(
      (p) => (p as Record<string, unknown>).KeyboardShortcutsEnabled !== undefined,
    );
    expect(payload).toBeDefined();
  });

  test("keyboard shortcuts list appears when enabled", async ({ page }) => {
    // Default: KeyboardShortcutsEnabled = true, so shortcuts list should show
    await expect(page.getByText("Ctrl+K").first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Ctrl+N").first()).toBeVisible();
    await expect(page.getByText("Ctrl+Shift+I").first()).toBeVisible();
  });
});

// ─── Retention Section ──────────────────────────────────────────────

test.describe("Settings Deep — Retention", () => {
  test.beforeEach(async ({ page }) => {
    await goToSettings(page);
  });

  test("retention select is visible with label", async ({ page }) => {
    await expect(
      page.getByText("Retention des conversations").first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test("retention options are present (Illimitee/7/30/90 jours)", async ({ page }) => {
    const retentionSelect = page.locator("select").filter({
      has: page.locator('option[value="7"]'),
    }).first();
    await expect(retentionSelect).toBeVisible({ timeout: 10000 });

    await expect(retentionSelect.locator('option[value="0"]')).toBeAttached();
    await expect(retentionSelect.locator('option[value="7"]')).toBeAttached();
    await expect(retentionSelect.locator('option[value="30"]')).toBeAttached();
    await expect(retentionSelect.locator('option[value="90"]')).toBeAttached();
  });

  test("changing retention sends POST with AutoDeleteDays", async ({ page }) => {
    const getPayloads = captureSettingsPayloads(page);

    const retentionSelect = page.locator("select").filter({
      has: page.locator('option[value="7"]'),
    }).first();
    await expect(retentionSelect).toBeVisible({ timeout: 10000 });

    await retentionSelect.selectOption("30");
    await page.waitForTimeout(500);

    const payloads = getPayloads();
    expect(payloads.length).toBeGreaterThanOrEqual(1);
    const payload = payloads.find(
      (p) => (p as Record<string, unknown>).AutoDeleteDays !== undefined,
    );
    expect(payload).toBeDefined();
    expect((payload as Record<string, unknown>).AutoDeleteDays).toBe(30);
  });
});

// ─── System Prompt ──────────────────────────────────────────────────

test.describe("Settings Deep — System Prompt", () => {
  test.beforeEach(async ({ page }) => {
    await goToSettings(page);
  });

  test("system prompt textarea is visible", async ({ page }) => {
    await expect(
      page.getByText("System prompt").first(),
    ).toBeVisible({ timeout: 10000 });

    const textarea = page.locator("textarea").filter({
      hasText: "",
    }).first();
    await expect(textarea).toBeVisible();
  });

  test("typing in system prompt sends POST on change", async ({ page }) => {
    const getPayloads = captureSettingsPayloads(page);

    // Find the system prompt textarea by its placeholder
    const promptTextarea = page.getByPlaceholder("Tu es un assistant intelligent").first();
    await expect(promptTextarea).toBeVisible({ timeout: 10000 });

    await promptTextarea.fill("Tu es un expert en Python. Reponds en francais.");
    await page.waitForTimeout(500);

    // The onChange handler calls handleChange immediately on each keystroke,
    // but fill triggers a single change event
    const payloads = getPayloads();
    expect(payloads.length).toBeGreaterThanOrEqual(1);
    const promptPayload = payloads.find(
      (p) => (p as Record<string, unknown>).SystemPrompt !== undefined,
    );
    expect(promptPayload).toBeDefined();
    expect((promptPayload as Record<string, unknown>).SystemPrompt).toContain("Python");
  });

  test("empty system prompt clears the setting", async ({ page }) => {
    // First set a non-empty prompt via API
    await page.evaluate(async () => {
      await fetch("/api/v1/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ SystemPrompt: "Custom prompt" }),
      });
    });
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("h1")).toContainText("Param", { timeout: 15000 });

    const getPayloads = captureSettingsPayloads(page);

    const promptTextarea = page.getByPlaceholder("Tu es un assistant intelligent").first();
    await expect(promptTextarea).toBeVisible({ timeout: 10000 });

    // Clear the textarea
    await promptTextarea.fill("");
    await page.waitForTimeout(500);

    const payloads = getPayloads();
    const clearPayload = payloads.find(
      (p) => (p as Record<string, unknown>).SystemPrompt !== undefined,
    );
    expect(clearPayload).toBeDefined();
    expect((clearPayload as Record<string, unknown>).SystemPrompt).toBe("");
  });
});

// ─── Reset ──────────────────────────────────────────────────────────

test.describe("Settings Deep — Reset", () => {
  test.beforeEach(async ({ page }) => {
    await goToSettings(page);
  });

  test("reset button is visible", async ({ page }) => {
    await expect(
      page.getByRole("button", { name: /initialiser/ }),
    ).toBeVisible({ timeout: 10000 });
  });

  test("clicking reset sends POST to reset settings", async ({ page }) => {
    const getPayloads = captureSettingsPayloads(page);

    const resetButton = page.getByRole("button", { name: /initialiser/ });
    await expect(resetButton).toBeVisible({ timeout: 10000 });

    await resetButton.click();
    await page.waitForTimeout(500);

    // Reset calls updateSettingsMutation with default values
    const payloads = getPayloads();
    expect(payloads.length).toBeGreaterThanOrEqual(1);

    // The reset payload should have default values
    const resetPayload = payloads[payloads.length - 1] as Record<string, unknown>;
    expect(resetPayload.Expose).toBe(false);
    expect(resetPayload.ContextLength).toBe(4096);
    expect(resetPayload.EncryptionEnabled).toBe(false);
  });

  test("after reset, settings are restored to defaults", async ({ page }) => {
    // First change a setting
    await page.evaluate(async () => {
      await fetch("/api/v1/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Theme: "nord" }),
      });
    });
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("h1")).toContainText("Param", { timeout: 15000 });

    // Click reset
    const resetButton = page.getByRole("button", { name: /initialiser/ });
    await resetButton.click();
    await page.waitForTimeout(500);

    // Verify settings were reset by checking the mock state
    const settings = await page.evaluate(async () => {
      const res = await fetch("/api/v1/settings");
      return res.json();
    });
    // After reset, the stateful mock should have the default values
    expect(settings.settings.EncryptionEnabled).toBe(false);
    expect(settings.settings.ContextLength).toBe(4096);
  });
});

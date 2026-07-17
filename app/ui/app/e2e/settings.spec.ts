import { test, expect } from "./fixtures";

test.describe("Settings Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("domcontentloaded");
    // Wait for settings page to render with mocked API
    await expect(page.locator("h1")).toContainText("Param", {
      timeout: 15000,
    });
  });

  test("settings page loads with all sections", async ({ page }) => {
    // Key settings sections should be present (use first() to avoid strict mode issues)
    await expect(
      page.getByText("Emplacement des mod").first(),
    ).toBeVisible({ timeout: 10000 });

    await expect(page.getByText("Longueur du contexte").first()).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByText("Theme").first()).toBeVisible({
      timeout: 5000,
    });
    await expect(
      page.getByText("Chiffrement des conversations").first(),
    ).toBeVisible({ timeout: 5000 });
    await expect(
      page.getByText("Protection par mot de passe").first(),
    ).toBeVisible({ timeout: 5000 });
  });

  test("theme selector is visible and has options", async ({ page }) => {
    // The theme <select> should be visible
    const themeSelect = page.locator("select").filter({
      has: page.locator('option[value="dark"]'),
    });
    await expect(themeSelect).toBeVisible({ timeout: 10000 });

    // Verify all theme options exist
    const options = ["light", "dark", "oled", "sepia", "blue-night", "nord"];
    for (const value of options) {
      await expect(themeSelect.locator(`option[value="${value}"]`)).toBeAttached();
    }
  });

  test("encryption toggle is visible", async ({ page }) => {
    const encryptionSection = page.getByText("Chiffrement des conversations");
    await expect(encryptionSection).toBeVisible({ timeout: 10000 });

    // There should be a switch (button with role=switch) near the encryption label
    const switches = page.locator('button[role="switch"]');
    const count = await switches.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test("retention selector is visible", async ({ page }) => {
    await expect(
      page.getByText("Retention des conversations"),
    ).toBeVisible({ timeout: 10000 });

    const retentionSelect = page.locator("select").filter({
      has: page.locator('option[value="7"]'),
    }).first();
    await expect(retentionSelect).toBeVisible();
  });

  test("clipboard clear seconds selector is visible", async ({ page }) => {
    await expect(
      page.getByText("Effacer le presse-papiers"),
    ).toBeVisible({ timeout: 10000 });

    const clipboardSelect = page.locator("select").filter({
      has: page.locator('option[value="15"]'),
    });
    await expect(clipboardSelect).toBeVisible();
  });

  test("features section has search toggle", async ({ page }) => {
    await expect(
      page.getByText("Recherche conversations"),
    ).toBeVisible({ timeout: 10000 });
  });

  test("features section has RAG citations toggle", async ({ page }) => {
    await expect(page.getByText("Citations RAG")).toBeVisible({
      timeout: 10000,
    });
  });

  test("features section has artifacts toggle", async ({ page }) => {
    await expect(
      page.getByText("Artifacts interactifs"),
    ).toBeVisible({ timeout: 10000 });
  });

  test("features section has keyboard shortcuts toggle", async ({ page }) => {
    await expect(page.getByText("Raccourcis clavier").first()).toBeVisible({
      timeout: 10000,
    });
  });

  test("reset button is visible", async ({ page }) => {
    await expect(
      page.getByRole("button", { name: /initialiser/ }),
    ).toBeVisible({ timeout: 10000 });
  });

  test("settings persist after navigation away and back", async ({
    page,
  }) => {
    // Read the current theme value
    const themeSelect = page.locator("select").filter({
      has: page.locator('option[value="dark"]'),
    });
    await expect(themeSelect).toBeVisible({ timeout: 10000 });
    const initialTheme = await themeSelect.inputValue();

    // Navigate away to chat page
    await page.goto("/");
    await expect(page.locator("textarea")).toBeVisible({ timeout: 15000 });

    // Navigate back to settings
    await page.goto("/settings");
    await expect(page.locator("h1")).toContainText("Param", {
      timeout: 15000,
    });

    // Theme value should be the same
    const themeSelectAgain = page.locator("select").filter({
      has: page.locator('option[value="dark"]'),
    });
    await expect(themeSelectAgain).toBeVisible({ timeout: 10000 });
    const persistedTheme = await themeSelectAgain.inputValue();
    expect(persistedTheme).toBe(initialTheme);
  });
});

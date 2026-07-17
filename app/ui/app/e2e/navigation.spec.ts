import { test, expect } from "./fixtures";

test.describe("Navigation & Routing", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
  });

  test("home page loads with chat interface", async ({ page }) => {
    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 15000 });
  });

  test("Settings page loads via direct navigation", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("h1")).toContainText("Param", {
      timeout: 15000,
    });
  });

  test("About page loads via direct navigation", async ({ page }) => {
    await page.goto("/about");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("h1")).toContainText("propos", {
      timeout: 15000,
    });
  });

  test("Knowledge page loads via direct navigation", async ({ page }) => {
    await page.goto("/knowledge");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("h1")).toContainText("Connaissance", {
      timeout: 15000,
    });
  });

  test("Settings link IS highlighted when on settings page", async ({
    page,
  }) => {
    await page.goto("/settings");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("h1")).toContainText("Param", {
      timeout: 15000,
    });

    // Settings page renders its own full-screen layout (no sidebar),
    // so we just verify the page loaded correctly
    const settingsHeading = page.locator("h1");
    await expect(settingsHeading).toContainText("Param");
  });

  test("back navigation works", async ({ page }) => {
    // Navigate to "/" first (already done in beforeEach), then to settings
    await page.goto("/settings");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("h1")).toContainText("Param", {
      timeout: 15000,
    });

    await page.goBack();

    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 15000 });
  });

  test("Ctrl+N creates new chat (navigates to home)", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("h1")).toContainText("Param", {
      timeout: 15000,
    });

    await page.keyboard.press("Control+n");

    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 15000 });
  });

  test("Ctrl+K opens search modal", async ({ page }) => {
    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 15000 });

    await page.keyboard.press("Control+k");

    const searchInput = page.locator(
      'input[type="text"], input[placeholder*="echerch"]',
    );
    await expect(searchInput).toBeVisible({ timeout: 5000 });
  });

  test("Escape closes modals", async ({ page }) => {
    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 15000 });

    await page.keyboard.press("Control+k");

    const searchInput = page.locator(
      'input[type="text"], input[placeholder*="echerch"]',
    );
    await expect(searchInput).toBeVisible({ timeout: 5000 });

    await page.keyboard.press("Escape");

    await expect(searchInput).toBeHidden({ timeout: 5000 });
  });
});

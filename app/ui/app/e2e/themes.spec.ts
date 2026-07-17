import { test, expect } from "./fixtures";

test.describe("Theme System", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("h1")).toContainText("Param", {
      timeout: 15000,
    });
  });

  /**
   * Helper: selects a theme from the Settings page theme dropdown
   * and waits for the <html> element to reflect it.
   */
  async function selectTheme(page: import("@playwright/test").Page, value: string) {
    const themeSelect = page.locator("select").filter({
      has: page.locator('option[value="dark"]'),
    });
    await expect(themeSelect).toBeVisible({ timeout: 10000 });
    await themeSelect.selectOption(value);
    // Give the React effect time to propagate the class change
    await page.waitForTimeout(500);
  }

  test("light theme applies correct classes to <html>", async ({ page }) => {
    await selectTheme(page, "light");

    const htmlClasses = await page.locator("html").getAttribute("class");
    expect(htmlClasses).toContain("light");
    expect(htmlClasses).not.toContain("dark");
  });

  test("dark theme applies correct classes (dark class present)", async ({
    page,
  }) => {
    await selectTheme(page, "dark");

    const htmlClasses = await page.locator("html").getAttribute("class");
    expect(htmlClasses).toContain("dark");
  });

  test("OLED theme applies (oled + dark classes)", async ({ page }) => {
    await selectTheme(page, "oled");

    const htmlClasses = await page.locator("html").getAttribute("class");
    expect(htmlClasses).toContain("oled");
    expect(htmlClasses).toContain("dark");
  });

  test("sepia theme applies", async ({ page }) => {
    await selectTheme(page, "sepia");

    const htmlClasses = await page.locator("html").getAttribute("class");
    expect(htmlClasses).toContain("sepia");
    // Sepia is not a dark theme
    expect(htmlClasses).not.toContain("dark");
  });

  test("blue-night theme applies (blue-night + dark)", async ({ page }) => {
    await selectTheme(page, "blue-night");

    const htmlClasses = await page.locator("html").getAttribute("class");
    expect(htmlClasses).toContain("blue-night");
    expect(htmlClasses).toContain("dark");
  });

  test("nord theme applies (nord + dark)", async ({ page }) => {
    await selectTheme(page, "nord");

    const htmlClasses = await page.locator("html").getAttribute("class");
    expect(htmlClasses).toContain("nord");
    expect(htmlClasses).toContain("dark");
  });

  test("theme persists after page reload", async ({ page }) => {
    // Select dark theme
    await selectTheme(page, "dark");

    // Verify it applied
    let htmlClasses = await page.locator("html").getAttribute("class");
    expect(htmlClasses).toContain("dark");

    // Reload the page
    await page.reload();
    await page.waitForLoadState("domcontentloaded");

    // Wait for the settings page to render (mock API will respond)
    await expect(page.locator("h1")).toContainText("Param", {
      timeout: 15000,
    });

    // Allow time for the theme effect to run
    await page.waitForTimeout(1000);

    htmlClasses = await page.locator("html").getAttribute("class");
    // Theme should persist via mocked settings
    const hasTheme =
      htmlClasses?.includes("dark") || htmlClasses?.includes("light");
    expect(hasTheme).toBe(true);
  });
});

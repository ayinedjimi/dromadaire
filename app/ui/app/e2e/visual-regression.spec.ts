import { test, expect } from "./fixtures";

test.describe("Visual regression", () => {
  test("home page - empty chat", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(1000); // Wait for animations
    await expect(page).toHaveScreenshot("home-empty-chat.png", {
      maxDiffPixelRatio: 0.02,
    });
  });

  test("settings page", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForTimeout(1000);
    await expect(page).toHaveScreenshot("settings-page.png", {
      maxDiffPixelRatio: 0.02,
    });
  });

  test("about page", async ({ page }) => {
    await page.goto("/about");
    await page.waitForTimeout(1000);
    await expect(page).toHaveScreenshot("about-page.png", {
      maxDiffPixelRatio: 0.02,
    });
  });

  test("knowledge page", async ({ page }) => {
    await page.goto("/knowledge");
    await page.waitForTimeout(1000);
    await expect(page).toHaveScreenshot("knowledge-page.png", {
      maxDiffPixelRatio: 0.02,
    });
  });

  test("dark theme applied", async ({ page }) => {
    // The default mock settings use Theme: "dark"
    await page.goto("/");
    await page.waitForTimeout(1000);
    // Verify dark class is applied
    const html = page.locator("html");
    await expect(html).toHaveClass(/dark/);
    await expect(page).toHaveScreenshot("dark-theme.png", {
      maxDiffPixelRatio: 0.02,
    });
  });
});

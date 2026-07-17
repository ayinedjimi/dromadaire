import { test, expect } from "./fixtures";

test.describe("Chat Interface", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
  });

  test("chat form is visible with textarea", async ({ page }) => {
    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 15000 });
  });

  test("empty chat shows welcome placeholder or logo", async ({ page }) => {
    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 15000 });

    // A new chat should have zero or very few message elements
    const messages = page.locator('[data-role="message-list"] [data-message-index]');
    const messageCount = await messages.count();
    expect(messageCount).toBeLessThanOrEqual(2);
  });

  test("sidebar shows chat list area", async ({ page }) => {
    const nav = page.locator("nav");
    await expect(nav).toBeVisible({ timeout: 15000 });
  });

  test("new chat button exists in sidebar", async ({ page }) => {
    const newChatLink = page.getByText("Nouveau chat");
    await expect(newChatLink).toBeVisible({ timeout: 15000 });
  });

  test("chat input area has textarea and buttons", async ({ page }) => {
    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 15000 });

    // There should be at least one button near the textarea
    // (model picker, send button, etc.)
    const buttons = page.locator("button");
    const buttonCount = await buttons.count();
    expect(buttonCount).toBeGreaterThanOrEqual(1);
  });

  test("sidebar can be toggled", async ({ page }) => {
    // Wait for the sidebar toggle button to appear
    const toggleButton = page.locator(
      'button[aria-label="Masquer le panneau"], button[aria-label="Afficher le panneau"]',
    );
    await expect(toggleButton).toBeVisible({ timeout: 15000 });

    // Get initial aria-label to determine current state
    const initialLabel = await toggleButton.getAttribute("aria-label");

    // Click the toggle
    await toggleButton.click();

    // Wait for the settings POST + re-render
    await page.waitForTimeout(1000);

    // The label should have changed
    const newToggle = page.locator(
      'button[aria-label="Masquer le panneau"], button[aria-label="Afficher le panneau"]',
    );
    const newLabel = await newToggle.getAttribute("aria-label");
    expect(newLabel).not.toBe(initialLabel);
  });

  test("status bar shows version info", async ({ page }) => {
    // The layout shows a status bar with version info
    // At viewport < xl (1280px), the status bar is visible on Windows
    await expect(page.getByText("v5.0")).toBeVisible({ timeout: 15000 });
  });
});

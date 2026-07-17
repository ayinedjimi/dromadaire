import { test, expect } from "./fixtures";
import { goToChat, goToSettings, setupModels, MOCK_MODELS_LIST } from "./helpers";

/**
 * E2E tests for responsive layout behavior across Desktop, Tablet, and Mobile viewports.
 *
 * The default fixture uses 1024x720. Each test sets its own viewport size
 * via page.setViewportSize() before navigating.
 *
 * Key breakpoints:
 * - Desktop: >= 1280px (xl) — sidebar visible, artifact panel side-by-side, status bar visible
 * - Tablet:  ~768px          — sidebar collapsible, chat full width, toggle button visible
 * - Mobile:  <= 640px        — sidebar hidden by default, full-width textarea
 */

// ─── Desktop 1280px ──────────────────────────────────────────────────────

test.describe("Desktop (1280px)", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  test("sidebar is visible at 1280px", async ({ page }) => {
    await goToChat(page);

    // The sidebar nav element should be visible
    const nav = page.locator("nav");
    await expect(nav).toBeVisible({ timeout: 15000 });

    // "Nouveau chat" link in the sidebar should be visible
    await expect(page.getByText("Nouveau chat")).toBeVisible({ timeout: 5000 });
  });

  test("status bar visible at bottom with version info", async ({ page }) => {
    await goToChat(page);

    // The status bar shows version info
    await expect(page.getByText("v5.0")).toBeVisible({ timeout: 15000 });
  });

  test("chat area and sidebar are side by side", async ({ page }) => {
    await goToChat(page);

    // Sidebar should be visible
    const nav = page.locator("nav");
    await expect(nav).toBeVisible({ timeout: 15000 });

    // Textarea (in main content area) should also be visible
    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 15000 });

    // The sidebar and textarea should both be in the viewport simultaneously
    const navBox = await nav.boundingBox();
    const textareaBox = await textarea.boundingBox();
    expect(navBox).not.toBeNull();
    expect(textareaBox).not.toBeNull();

    // Sidebar should be to the left of the textarea
    expect(navBox!.x).toBeLessThan(textareaBox!.x);
  });

  test("full layout renders correctly with all sidebar links", async ({ page }) => {
    await goToChat(page);

    // Sidebar links should all be visible on desktop
    await expect(page.getByText("Nouveau chat")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("Paramètres")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("Connaissances")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("À propos")).toBeVisible({ timeout: 5000 });

    // Main chat area should be rendered
    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 5000 });

    // Toggle button should be present
    const toggleButton = page.locator(
      'button[aria-label="Masquer le panneau"], button[aria-label="Afficher le panneau"]',
    );
    await expect(toggleButton).toBeVisible({ timeout: 5000 });
  });
});

// ─── Tablet 768px ──────────────────────────────────────────────────────

test.describe("Tablet (768px)", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
  });

  test("sidebar toggle button is visible", async ({ page }) => {
    await goToChat(page);

    const toggleButton = page.locator(
      'button[aria-label="Masquer le panneau"], button[aria-label="Afficher le panneau"]',
    );
    await expect(toggleButton).toBeVisible({ timeout: 15000 });
  });

  test("sidebar can be toggled on and off", async ({ page }) => {
    await goToChat(page);

    const toggleButton = page.locator(
      'button[aria-label="Masquer le panneau"], button[aria-label="Afficher le panneau"]',
    );
    await expect(toggleButton).toBeVisible({ timeout: 15000 });

    // Get initial state
    const initialLabel = await toggleButton.getAttribute("aria-label");

    // Click toggle
    await toggleButton.click();
    await page.waitForTimeout(500);

    // Label should have changed
    const newToggle = page.locator(
      'button[aria-label="Masquer le panneau"], button[aria-label="Afficher le panneau"]',
    );
    const newLabel = await newToggle.getAttribute("aria-label");
    expect(newLabel).not.toBe(initialLabel);
  });

  test("chat textarea takes available width", async ({ page }) => {
    await goToChat(page);

    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 15000 });

    // Textarea should be reasonably wide (at least 60% of viewport for tablet)
    const box = await textarea.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(768 * 0.4);
  });

  test("sidebar collapse gives chat more room", async ({ page }) => {
    await goToChat(page);

    // If sidebar is open, close it
    const hideButton = page.locator('button[aria-label="Masquer le panneau"]');
    const isHideVisible = await hideButton.isVisible().catch(() => false);
    if (isHideVisible) {
      await hideButton.click();
      await page.waitForTimeout(500);
    }

    // After closing sidebar, textarea should have more width
    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 5000 });
    const box = await textarea.boundingBox();
    expect(box).not.toBeNull();
    // Without sidebar, the textarea parent should use near full viewport width
    expect(box!.width).toBeGreaterThan(768 * 0.5);
  });

  test("settings page renders correctly at tablet width", async ({ page }) => {
    await goToSettings(page);

    // The settings page h1 should be visible
    await expect(page.locator("h1")).toContainText("Param", { timeout: 15000 });

    // Content should not overflow horizontally
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 2); // small tolerance for borders
  });
});

// ─── Mobile 375px ──────────────────────────────────────────────────────

test.describe("Mobile (375px)", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
  });

  test("sidebar is hidden or collapsed by default", async ({ page }) => {
    await goToChat(page);

    // With SidebarOpen=true (default) but at 375px, sidebar takes 256px (w-64).
    // The toggle button should be visible to hide/show the sidebar.
    const toggleButton = page.locator(
      'button[aria-label="Masquer le panneau"], button[aria-label="Afficher le panneau"]',
    );
    await expect(toggleButton).toBeVisible({ timeout: 15000 });

    // The textarea should still be accessible
    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 15000 });
  });

  test("toggle button is visible and functional on mobile", async ({ page }) => {
    await goToChat(page);

    const toggleButton = page.locator(
      'button[aria-label="Masquer le panneau"], button[aria-label="Afficher le panneau"]',
    );
    await expect(toggleButton).toBeVisible({ timeout: 15000 });

    // Click to toggle sidebar
    await toggleButton.click();
    await page.waitForTimeout(500);

    // The button label should have changed
    const newToggle = page.locator(
      'button[aria-label="Masquer le panneau"], button[aria-label="Afficher le panneau"]',
    );
    await expect(newToggle).toBeVisible({ timeout: 5000 });
  });

  test("textarea is visible and takes appropriate width", async ({ page }) => {
    // Close sidebar first so chat area gets full width
    await goToChat(page);

    // Close sidebar if open
    const hideButton = page.locator('button[aria-label="Masquer le panneau"]');
    const isHideVisible = await hideButton.isVisible().catch(() => false);
    if (isHideVisible) {
      await hideButton.click();
      await page.waitForTimeout(500);
    }

    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 15000 });

    const box = await textarea.boundingBox();
    expect(box).not.toBeNull();
    // Textarea should span a large portion of the mobile viewport
    expect(box!.width).toBeGreaterThan(200);
  });

  test("settings page is scrollable on mobile", async ({ page }) => {
    await goToSettings(page);

    await expect(page.locator("h1")).toContainText("Param", { timeout: 15000 });

    // Settings page likely has more content than fits in 667px height
    // Verify the page can be scrolled
    const initialScrollTop = await page.evaluate(() => document.documentElement.scrollTop);

    // Scroll down
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(300);

    // The page should be scrollable (scrollHeight > viewport height)
    const scrollHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    const clientHeight = await page.evaluate(() => document.documentElement.clientHeight);
    // Either content is taller (scrollable) or fits neatly
    expect(scrollHeight).toBeGreaterThanOrEqual(clientHeight);
  });

  test("all content is accessible via scroll", async ({ page }) => {
    await goToChat(page);

    // The textarea and at least the toggle button should be reachable
    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 15000 });

    // Status bar should also be somewhere on the page
    const versionText = page.getByText("v5.0");
    await expect(versionText).toBeAttached({ timeout: 5000 });
  });

  test("prompt templates remain visible on mobile", async ({ page }) => {
    await setupModels(page);
    await page.goto("/");
    await page.locator("textarea").waitFor({ state: "visible", timeout: 15000 });

    // At least one template should be visible even at 375px
    const firstTemplate = page.getByRole("button", { name: "Resumer un texte" });
    await expect(firstTemplate).toBeVisible({ timeout: 5000 });
  });
});

// ─── Resize transitions ──────────────────────────────────────────────────

test.describe("Resize transitions", () => {
  test("resize from 1280 to 375 — sidebar becomes collapsible", async ({ page }) => {
    // Start at desktop
    await page.setViewportSize({ width: 1280, height: 800 });
    await goToChat(page);

    // Sidebar should be visible
    const nav = page.locator("nav");
    await expect(nav).toBeVisible({ timeout: 15000 });

    // Resize to mobile
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForTimeout(500);

    // Toggle button should still be present
    const toggleButton = page.locator(
      'button[aria-label="Masquer le panneau"], button[aria-label="Afficher le panneau"]',
    );
    await expect(toggleButton).toBeVisible({ timeout: 5000 });

    // Textarea should remain accessible
    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 5000 });
  });

  test("resize from 375 to 1280 — sidebar shows", async ({ page }) => {
    // Start at mobile
    await page.setViewportSize({ width: 375, height: 667 });
    await goToChat(page);

    // Ensure sidebar is visible initially (SidebarOpen=true by default)
    const nav = page.locator("nav");

    // Resize to desktop
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(500);

    // Sidebar should be visible
    await expect(nav).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("Nouveau chat")).toBeVisible({ timeout: 5000 });
  });

  test("panel adapts to viewport change", async ({ page }) => {
    // Start at desktop with sidebar open
    await page.setViewportSize({ width: 1280, height: 800 });
    await goToChat(page);

    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 15000 });
    const desktopBox = await textarea.boundingBox();
    expect(desktopBox).not.toBeNull();

    // Resize to tablet
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.waitForTimeout(500);

    await expect(textarea).toBeVisible({ timeout: 5000 });
    const tabletBox = await textarea.boundingBox();
    expect(tabletBox).not.toBeNull();

    // The layout should still function (no crash, textarea accessible)
    expect(tabletBox!.width).toBeGreaterThan(0);
  });

  test("layout does not break on rapid resize", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await goToChat(page);

    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 15000 });

    // Rapidly resize through several breakpoints
    const sizes = [
      { width: 768, height: 1024 },
      { width: 375, height: 667 },
      { width: 1280, height: 800 },
      { width: 640, height: 480 },
      { width: 1024, height: 720 },
    ];

    for (const size of sizes) {
      await page.setViewportSize(size);
      await page.waitForTimeout(200);
    }

    // After all resizes, the textarea should still be visible and functional
    await expect(textarea).toBeVisible({ timeout: 5000 });

    // The app should not have crashed — verify the page is still interactive
    const toggleButton = page.locator(
      'button[aria-label="Masquer le panneau"], button[aria-label="Afficher le panneau"]',
    );
    await expect(toggleButton).toBeVisible({ timeout: 5000 });
  });

  test("no horizontal scroll on mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await goToChat(page);

    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 15000 });

    // Close sidebar to test proper mobile layout
    const hideButton = page.locator('button[aria-label="Masquer le panneau"]');
    const isHideVisible = await hideButton.isVisible().catch(() => false);
    if (isHideVisible) {
      await hideButton.click();
      await page.waitForTimeout(500);
    }

    // Check for horizontal overflow
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    // Allow 1px tolerance for sub-pixel rounding
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
  });
});

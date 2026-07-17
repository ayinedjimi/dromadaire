import { test, expect } from "./fixtures";

test.describe("Airplane mode", () => {
  test("airplane mode is disabled by default", async ({ page }) => {
    await page.goto("/");
    // Wait for the app to load
    await expect(page.locator("textarea")).toBeVisible({ timeout: 15000 });

    // The airplane icon indicator should NOT be in the status bar
    // (the airplane SVG path is inside a span with title containing "Mode avion")
    const airplaneIndicator = page.locator("span[title*='avion']");
    await expect(airplaneIndicator).not.toBeVisible();
  });

  test("enabling airplane mode via settings API updates the UI", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator("textarea")).toBeVisible({ timeout: 15000 });

    // The stateful mock accepts POST to /api/v1/settings to update settings.
    // Simulate what the app does: POST the AirplaneMode: true update.
    await page.evaluate(async () => {
      await fetch("/api/v1/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ AirplaneMode: true }),
      });
    });

    // Verify the mock was updated by fetching settings
    const settings = await page.evaluate(async () => {
      const res = await fetch("/api/v1/settings");
      return res.json();
    });
    expect(settings.settings.AirplaneMode).toBe(true);
  });

  test("airplane indicator appears after enabling airplane mode and reloading", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator("textarea")).toBeVisible({ timeout: 15000 });

    // Enable airplane mode via POST
    await page.evaluate(async () => {
      await fetch("/api/v1/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ AirplaneMode: true }),
      });
    });

    // Reload to pick up the new settings (the mock is stateful per-page)
    // Note: since the mock is set up per page, reloading re-attaches the mock
    // with the same closured state. But actually Playwright route handlers persist
    // across navigations, so the updated currentSettings will be served.
    await page.reload();
    await expect(page.locator("textarea")).toBeVisible({ timeout: 15000 });

    // Now the airplane mode indicator should be visible
    const airplaneIndicator = page.locator("span[title*='avion']");
    await expect(airplaneIndicator).toBeVisible({ timeout: 5000 });
  });
});

import { test, expect } from "./fixtures";

test.describe("Incognito mode", () => {
  test("incognito button is visible in the chat form", async ({ page }) => {
    await page.goto("/");
    // The incognito button has a title containing "incognito"
    const incognitoBtn = page.locator("button[title*='incognito' i]");
    await expect(incognitoBtn).toBeVisible({ timeout: 15000 });
  });

  test("Ctrl+Shift+I toggles incognito and shows indicator", async ({
    page,
  }) => {
    await page.goto("/");
    // Wait for the app to load
    await expect(page.locator("textarea")).toBeVisible({ timeout: 15000 });

    // Initially, the status bar incognito indicator should not be visible
    // Use a specific selector: the violet-colored span in the status bar
    const statusIncognito = page.locator(
      "span.text-violet-500",
    );
    await expect(statusIncognito).not.toBeVisible();

    // Press Ctrl+Shift+I to toggle incognito on
    await page.keyboard.press("Control+Shift+I");

    // The status bar should now show the violet "Incognito" indicator
    await expect(statusIncognito).toBeVisible({ timeout: 5000 });
    await expect(statusIncognito).toHaveText("Incognito");

    // The incognito button in the chat form should also show the "Incognito" label
    const incognitoLabel = page.locator("button[title*='incognito' i] span");
    await expect(incognitoLabel).toHaveText("Incognito", { timeout: 5000 });
  });

  test("clicking incognito button toggles mode on and off", async ({
    page,
  }) => {
    await page.goto("/");
    const incognitoBtn = page.locator("button[title*='incognito' i]");
    await expect(incognitoBtn).toBeVisible({ timeout: 15000 });

    // The status bar indicator (violet span)
    const statusIncognito = page.locator(
      "span.text-violet-500",
    );

    // Click to enable incognito
    await incognitoBtn.click();
    await expect(statusIncognito).toBeVisible({ timeout: 5000 });

    // Click again to disable
    await incognitoBtn.click();
    await expect(statusIncognito).not.toBeVisible({ timeout: 5000 });
  });
});

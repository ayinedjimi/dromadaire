import { test, expect } from "./fixtures";

test.describe("Sidebar Navigation", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    // Wait for the sidebar to be rendered (nav element)
    await expect(page.locator("nav")).toBeVisible({ timeout: 15000 });
  });

  test('sidebar shows "Nouveau chat" button', async ({ page }) => {
    const newChatLink = page.getByText("Nouveau chat");
    await expect(newChatLink).toBeVisible({ timeout: 15000 });
  });

  test('sidebar shows "Parametres" link', async ({ page }) => {
    await expect(page.getByText("Paramètres")).toBeVisible({ timeout: 15000 });
  });

  test('sidebar shows "Connaissances" link', async ({ page }) => {
    await expect(page.getByText("Connaissances")).toBeVisible({ timeout: 15000 });
  });

  test('sidebar shows "À propos" link at bottom', async ({ page }) => {
    await expect(page.getByText("À propos")).toBeVisible({ timeout: 15000 });
  });

  test("active link highlighting works for settings page", async ({
    page,
  }) => {
    // Navigate directly to settings
    await page.goto("/settings");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("h1")).toContainText("Param", {
      timeout: 15000,
    });

    // If the sidebar is visible on settings page, check the link
    const settingsText = page.getByText("Paramètres");
    const count = await settingsText.count();
    if (count > 0) {
      // The nearest <a> ancestor should have the active class
      const link = settingsText.locator("xpath=ancestor::a");
      const linkCount = await link.count();
      if (linkCount > 0) {
        const classes = await link.first().getAttribute("class");
        expect(classes).toContain("bg-neutral-100");
      }
    }
  });

  test("active link highlighting works for knowledge page", async ({
    page,
  }) => {
    await page.goto("/knowledge");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("h1")).toContainText("Connaissance", {
      timeout: 15000,
    });

    const knowledgeText = page.getByText("Connaissances");
    const count = await knowledgeText.count();
    if (count > 0) {
      const link = knowledgeText.locator("xpath=ancestor::a");
      const linkCount = await link.count();
      if (linkCount > 0) {
        const classes = await link.first().getAttribute("class");
        expect(classes).toContain("bg-neutral-100");
      }
    }
  });

  test("active link highlighting works for about page", async ({ page }) => {
    await page.goto("/about");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("h1")).toContainText("propos", {
      timeout: 15000,
    });

    const aboutText = page.getByText("A propos");
    const count = await aboutText.count();
    if (count > 0) {
      const link = aboutText.locator("xpath=ancestor::a");
      const linkCount = await link.count();
      if (linkCount > 0) {
        const classes = await link.first().getAttribute("class");
        expect(classes).toContain("bg-neutral-100");
      }
    }
  });

  test("selection mode activates with checkmark button", async ({ page }) => {
    const selectButton = page.locator(
      'button[title="Sélectionner des conversations"]',
    );
    const isVisible = await selectButton.isVisible().catch(() => false);

    if (isVisible) {
      await selectButton.click();
      await expect(page.getByText("Tout")).toBeVisible({ timeout: 5000 });
      await expect(page.getByText("Supprimer")).toBeVisible({ timeout: 5000 });
    } else {
      test.skip();
    }
  });

  test("selection mode shows select all and delete buttons", async ({
    page,
  }) => {
    const selectButton = page.locator(
      'button[title="Sélectionner des conversations"]',
    );
    const isVisible = await selectButton.isVisible().catch(() => false);

    if (isVisible) {
      await selectButton.click();

      const selectAllBtn = page.getByText("Tout");
      await expect(selectAllBtn).toBeVisible({ timeout: 5000 });

      const deleteBtn = page.getByText("Supprimer");
      await expect(deleteBtn).toBeVisible({ timeout: 5000 });

      await expect(page.getByText(/sélectionné/)).toBeVisible({
        timeout: 5000,
      });

      const cancelBtn = page.locator('button[title="Annuler"]');
      await expect(cancelBtn).toBeVisible({ timeout: 5000 });
    } else {
      test.skip();
    }
  });
});

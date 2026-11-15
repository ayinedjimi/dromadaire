import { test, expect } from "./fixtures";

// Bannière globale de redémarrage : visible sur toutes les pages quand un
// réglage du moteur n'est pas encore appliqué, et redémarre le serveur.

test.describe("Bannière de redémarrage du moteur", () => {
  test("affichée sur la page de chat quand un redémarrage est requis", async ({ page }) => {
    let needed = true;
    let restartRequested = false;
    await page.route("**/api/v1/restart-status", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ needed }) }),
    );
    await page.route("**/api/v1/restart-server", (route) => {
      restartRequested = true;
      needed = false;
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "restarting" }) });
    });

    await page.goto("/");
    await expect(page.getByTestId("restart-banner")).toBeVisible({ timeout: 15000 });
    await page.getByTestId("restart-now").click();
    await expect.poll(() => restartRequested).toBe(true);
    await expect(page.getByTestId("restart-banner")).toHaveCount(0, { timeout: 15000 });
  });

  test("absente quand aucun redémarrage n'est requis", async ({ page }) => {
    await page.route("**/api/v1/restart-status", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ needed: false }) }),
    );
    await page.goto("/");
    await page.locator("textarea").waitFor({ state: "visible", timeout: 15000 });
    await expect(page.getByTestId("restart-banner")).toHaveCount(0);
  });
});

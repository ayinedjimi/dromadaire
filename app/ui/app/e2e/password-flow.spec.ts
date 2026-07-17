import { test, expect } from "./fixtures";
import {
  setupPasswordEnabled,
  goToSettings,
  capturePostRequests,
} from "./helpers";

// ─── No Password (default state) ──────────────────────────────────

test.describe("Password: no password configured", () => {
  test("app loads normally without prompt", async ({ page }) => {
    await page.goto("/");
    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 15000 });
  });

  test("no PasswordPrompt visible on load", async ({ page }) => {
    await page.goto("/");
    await page.locator("textarea").waitFor({ state: "visible", timeout: 15000 });

    // PasswordPrompt heading is "Dromadaire" inside a fixed overlay with Lock icon
    // It should NOT be present when passwordEnabled=false (the default mock)
    const prompt = page.locator("text=Entrez votre mot de passe pour continuer");
    await expect(prompt).not.toBeVisible();
  });

  test("settings shows password form (not active indicator)", async ({ page }) => {
    await goToSettings(page);

    // Should see the password section label
    await expect(
      page.getByText("Protection par mot de passe").first(),
    ).toBeVisible({ timeout: 5000 });

    // Should see the "set new password" placeholder — not "Mot de passe actif"
    const newPwdInput = page.locator('input[placeholder*="Nouveau mot de passe"]');
    await expect(newPwdInput).toBeVisible({ timeout: 5000 });

    // "Mot de passe actif" should NOT be visible
    const activeLabel = page.getByText("Mot de passe actif");
    await expect(activeLabel).not.toBeVisible();
  });
});

// ─── Set Password ──────────────────────────────────────────────────

test.describe("Password: set password flow", () => {
  test("password field and confirm field visible in settings", async ({ page }) => {
    await goToSettings(page);

    const newPwdInput = page.locator('input[placeholder*="Nouveau mot de passe"]');
    await expect(newPwdInput).toBeVisible({ timeout: 5000 });

    const confirmInput = page.locator('input[placeholder*="Confirmer le mot de passe"]');
    await expect(confirmInput).toBeVisible({ timeout: 5000 });
  });

  test("set password button visible with label", async ({ page }) => {
    await goToSettings(page);

    const activateBtn = page.getByRole("button", { name: "Activer le mot de passe" });
    await expect(activateBtn).toBeVisible({ timeout: 5000 });
  });

  test("short password shows error", async ({ page }) => {
    await goToSettings(page);

    const newPwdInput = page.locator('input[placeholder*="Nouveau mot de passe"]');
    await newPwdInput.fill("ab");

    const confirmInput = page.locator('input[placeholder*="Confirmer le mot de passe"]');
    await confirmInput.fill("ab");

    const activateBtn = page.getByRole("button", { name: "Activer le mot de passe" });
    await activateBtn.click();

    // Should show min length error
    await expect(
      page.getByText("Le mot de passe doit contenir au moins 4 caracteres"),
    ).toBeVisible({ timeout: 5000 });
  });

  test("mismatched passwords show error", async ({ page }) => {
    await goToSettings(page);

    const newPwdInput = page.locator('input[placeholder*="Nouveau mot de passe"]');
    await newPwdInput.fill("secure1234");

    const confirmInput = page.locator('input[placeholder*="Confirmer le mot de passe"]');
    await confirmInput.fill("different");

    const activateBtn = page.getByRole("button", { name: "Activer le mot de passe" });
    await activateBtn.click();

    await expect(
      page.getByText("Les mots de passe ne correspondent pas"),
    ).toBeVisible({ timeout: 5000 });
  });

  test("valid password sends POST to /auth/set-password", async ({ page }) => {
    // Capture POST payloads to set-password
    const getPayloads = await capturePostRequests(
      page,
      "**/api/v1/auth/set-password",
      { ok: true },
    );

    await goToSettings(page);

    const newPwdInput = page.locator('input[placeholder*="Nouveau mot de passe"]');
    await newPwdInput.fill("mypassword");

    const confirmInput = page.locator('input[placeholder*="Confirmer le mot de passe"]');
    await confirmInput.fill("mypassword");

    const activateBtn = page.getByRole("button", { name: "Activer le mot de passe" });
    await activateBtn.click();

    // Wait for the request to be captured
    await page.waitForTimeout(500);

    const payloads = getPayloads();
    expect(payloads.length).toBe(1);
    expect(payloads[0]).toEqual({ password: "mypassword" });
  });
});

// ─── Login (locked state) ──────────────────────────────────────────

test.describe("Password: login flow (locked state)", () => {
  test("locked state shows PasswordPrompt on load", async ({ page }) => {
    await setupPasswordEnabled(page, { locked: true, attemptsLeft: 3 });

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    // PasswordPrompt shows the heading "Dromadaire"
    await expect(page.locator("h1").getByText("Dromadaire")).toBeVisible({
      timeout: 15000,
    });
    await expect(
      page.getByText("Entrez votre mot de passe pour continuer"),
    ).toBeVisible({ timeout: 5000 });
  });

  test("password input field is visible in prompt", async ({ page }) => {
    await setupPasswordEnabled(page, { locked: true, attemptsLeft: 3 });
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    const pwdInput = page.locator('input[type="password"]');
    await expect(pwdInput).toBeVisible({ timeout: 15000 });
  });

  test("correct password unlocks the app", async ({ page }) => {
    await setupPasswordEnabled(page, { locked: true, attemptsLeft: 3 });

    // Mock verify-password to return success
    await page.route("**/api/v1/auth/verify-password", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ authenticated: true, wiped: false }),
      });
    });

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    const pwdInput = page.locator('input[type="password"]');
    await pwdInput.waitFor({ state: "visible", timeout: 15000 });
    await pwdInput.fill("correctpassword");

    const unlockBtn = page.getByRole("button", { name: "Deverrouiller" });
    await unlockBtn.click();

    // After unlock, the main chat interface should appear
    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 15000 });
  });

  test("wrong password shows error with attempts count", async ({ page }) => {
    await setupPasswordEnabled(page, { locked: true, attemptsLeft: 3 });

    // Mock verify-password to return failure with 2 attempts left
    await page.route("**/api/v1/auth/verify-password", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ authenticated: false, wiped: false, attemptsLeft: 2 }),
      });
    });

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    const pwdInput = page.locator('input[type="password"]');
    await pwdInput.waitFor({ state: "visible", timeout: 15000 });
    await pwdInput.fill("wrongpassword");

    const unlockBtn = page.getByRole("button", { name: "Deverrouiller" });
    await unlockBtn.click();

    // Should show error with attempts remaining
    await expect(
      page.getByText("2 tentatives restantes"),
    ).toBeVisible({ timeout: 5000 });
  });

  test("single attempt remaining shows singular form", async ({ page }) => {
    await setupPasswordEnabled(page, { locked: true, attemptsLeft: 2 });

    // Mock verify-password to return failure with 1 attempt left
    await page.route("**/api/v1/auth/verify-password", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ authenticated: false, wiped: false, attemptsLeft: 1 }),
      });
    });

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    const pwdInput = page.locator('input[type="password"]');
    await pwdInput.waitFor({ state: "visible", timeout: 15000 });
    await pwdInput.fill("badpass");

    const unlockBtn = page.getByRole("button", { name: "Deverrouiller" });
    await unlockBtn.click();

    // Should show singular "tentative restante"
    await expect(
      page.getByText("1 tentative restante."),
    ).toBeVisible({ timeout: 5000 });
  });
});

// ─── Auto-delete on 3 Failures ─────────────────────────────────────

test.describe("Password: auto-delete on 3 failures", () => {
  test("3 failures with autoDelete triggers wipe message", async ({ page }) => {
    await setupPasswordEnabled(page, { locked: true, attemptsLeft: 1 });

    // Mock verify-password to return wiped=true
    await page.route("**/api/v1/auth/verify-password", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ authenticated: false, wiped: true, attemptsLeft: 0 }),
      });
    });

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    const pwdInput = page.locator('input[type="password"]');
    await pwdInput.waitFor({ state: "visible", timeout: 15000 });
    await pwdInput.fill("lastchance");

    const unlockBtn = page.getByRole("button", { name: "Deverrouiller" });
    await unlockBtn.click();

    // Should show data wipe message
    await expect(
      page.getByText("Donnees supprimees"),
    ).toBeVisible({ timeout: 5000 });
  });

  test("wipe message includes explanation text", async ({ page }) => {
    await setupPasswordEnabled(page, { locked: true, attemptsLeft: 1 });

    await page.route("**/api/v1/auth/verify-password", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ authenticated: false, wiped: true, attemptsLeft: 0 }),
      });
    });

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    const pwdInput = page.locator('input[type="password"]');
    await pwdInput.waitFor({ state: "visible", timeout: 15000 });
    await pwdInput.fill("wrong");

    const unlockBtn = page.getByRole("button", { name: "Deverrouiller" });
    await unlockBtn.click();

    await expect(
      page.getByText("Toutes les conversations et la cle de chiffrement ont ete supprimees"),
    ).toBeVisible({ timeout: 5000 });
  });

  test("password field is cleared after wipe", async ({ page }) => {
    await setupPasswordEnabled(page, { locked: true, attemptsLeft: 1 });

    await page.route("**/api/v1/auth/verify-password", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ authenticated: false, wiped: true, attemptsLeft: 0 }),
      });
    });

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    const pwdInput = page.locator('input[type="password"]');
    await pwdInput.waitFor({ state: "visible", timeout: 15000 });
    await pwdInput.fill("wrong");

    const unlockBtn = page.getByRole("button", { name: "Deverrouiller" });
    await unlockBtn.click();

    // Input should be cleared
    await expect(pwdInput).toHaveValue("", { timeout: 5000 });
  });

  test("without autoDelete, wrong password shows error without wipe", async ({ page }) => {
    await setupPasswordEnabled(page, { locked: true, attemptsLeft: 1 });

    // Mock: authenticated=false, wiped=false (no auto-delete configured)
    await page.route("**/api/v1/auth/verify-password", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ authenticated: false, wiped: false, attemptsLeft: 0 }),
      });
    });

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    const pwdInput = page.locator('input[type="password"]');
    await pwdInput.waitFor({ state: "visible", timeout: 15000 });
    await pwdInput.fill("wrong");

    const unlockBtn = page.getByRole("button", { name: "Deverrouiller" });
    await unlockBtn.click();

    // Should show error but NOT the wipe message
    await expect(
      page.getByText("Mot de passe incorrect."),
    ).toBeVisible({ timeout: 5000 });
    await expect(
      page.getByText("Donnees supprimees"),
    ).not.toBeVisible();
  });
});

// ─── Helper: authenticate through PasswordPrompt then navigate ────

/**
 * When passwordEnabled=true, the app always shows PasswordPrompt first
 * (React state `authenticated` starts as false on every page load).
 * This helper authenticates on the target page, then navigates within the SPA.
 * For /settings, we authenticate on "/" first, then use the sidebar link.
 */
async function authenticateAndGoTo(page: import("@playwright/test").Page, path: string) {
  // Mock auth status: password enabled
  await page.route("**/api/v1/auth/status", (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ passwordEnabled: true, locked: true, attemptsLeft: 3 }),
    });
  });

  // Mock verify-password to succeed
  await page.route("**/api/v1/auth/verify-password", (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ authenticated: true, wiped: false }),
    });
  });

  // Navigate to the target path directly — PasswordPrompt will show
  await page.goto(path);
  await page.waitForLoadState("domcontentloaded");

  // Authenticate through the PasswordPrompt
  const pwdInput = page.locator('input[type="password"]');
  await pwdInput.waitFor({ state: "visible", timeout: 15000 });
  await pwdInput.fill("testpassword");
  await page.getByRole("button", { name: "Deverrouiller" }).click();

  // Wait for the target page to render after unlock
  if (path === "/settings") {
    await page.locator("h1").waitFor({ state: "visible", timeout: 15000 });
  } else {
    await page.locator("textarea").waitFor({ state: "visible", timeout: 15000 });
  }
}

// ─── Lock Timeout ──────────────────────────────────────────────────

test.describe("Password: lock timeout", () => {
  test("lock timeout select visible when password enabled", async ({ page }) => {
    await authenticateAndGoTo(page, "/settings");

    // The lock timeout dropdown should be visible
    const lockLabel = page.getByText("Verrouillage automatique").first();
    await expect(lockLabel).toBeVisible({ timeout: 5000 });

    // Target the select near the "Verrouillage automatique" label
    // Use the parent container that holds both the label and the select
    const lockSection = lockLabel.locator("..").locator("..").locator(".."); // up to the Field wrapper
    const lockSelect = lockSection.locator("select");
    await expect(lockSelect).toBeVisible({ timeout: 5000 });

    // Check options: 0 (Desactive), 5, 10, 30
    await expect(lockSelect.locator('option[value="0"]')).toBeAttached();
    await expect(lockSelect.locator('option[value="5"]')).toBeAttached();
    await expect(lockSelect.locator('option[value="10"]')).toBeAttached();
    await expect(lockSelect.locator('option[value="30"]')).toBeAttached();
  });

  test("auto-delete toggle visible when password enabled", async ({ page }) => {
    await authenticateAndGoTo(page, "/settings");

    await expect(
      page.getByText("Auto-suppression (3 echecs)").first(),
    ).toBeVisible({ timeout: 5000 });
  });

  test("auto-lock and auto-delete hidden when password not enabled", async ({ page }) => {
    // Default mock has passwordEnabled=false
    await goToSettings(page);

    // These should NOT be visible because password is not enabled
    const autoLock = page.getByText("Verrouillage automatique");
    await expect(autoLock).not.toBeVisible();

    const autoDelete = page.getByText("Auto-suppression (3 echecs)");
    await expect(autoDelete).not.toBeVisible();
  });

  test("lock timeout re-locks the app (simulated via state reset)", async ({ page }) => {
    await setupPasswordEnabled(page, { locked: true, attemptsLeft: 3 });

    // Mock verify to succeed
    await page.route("**/api/v1/auth/verify-password", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ authenticated: true, wiped: false }),
      });
    });

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    // Unlock
    const pwdInput = page.locator('input[type="password"]');
    await pwdInput.waitFor({ state: "visible", timeout: 15000 });
    await pwdInput.fill("mypassword");
    await page.getByRole("button", { name: "Deverrouiller" }).click();

    // Should be unlocked now — textarea visible
    await expect(page.locator("textarea")).toBeVisible({ timeout: 15000 });

    // Simulate timeout by reloading with locked=true
    // (In reality, the frontend timer sets authenticated=false which re-shows PasswordPrompt)
    await setupPasswordEnabled(page, { locked: true, attemptsLeft: 3 });
    await page.reload();
    await page.waitForLoadState("domcontentloaded");

    // Password prompt should reappear
    await expect(
      page.getByText("Entrez votre mot de passe pour continuer"),
    ).toBeVisible({ timeout: 15000 });
  });
});

// ─── Remove Password ───────────────────────────────────────────────

test.describe("Password: remove password", () => {
  test("remove password form visible when password is active", async ({ page }) => {
    // Authenticate first, then navigate to settings
    await authenticateAndGoTo(page, "/settings");

    // Should show "Mot de passe actif" label
    await expect(
      page.getByText("Mot de passe actif").first(),
    ).toBeVisible({ timeout: 5000 });

    // Current password input for removal
    const currentPwdInput = page.locator('input[placeholder*="Mot de passe actuel pour desactiver"]');
    await expect(currentPwdInput).toBeVisible({ timeout: 5000 });

    // Disable button
    const disableBtn = page.getByRole("button", { name: "Desactiver le mot de passe" });
    await expect(disableBtn).toBeVisible({ timeout: 5000 });
  });

  test("remove password sends POST to /auth/remove-password", async ({ page }) => {
    // Capture payloads before navigating (route registered in LIFO order)
    const getPayloads = await capturePostRequests(
      page,
      "**/api/v1/auth/remove-password",
      { ok: true },
    );

    // Authenticate first, then navigate to settings
    await authenticateAndGoTo(page, "/settings");

    const currentPwdInput = page.locator('input[placeholder*="Mot de passe actuel pour desactiver"]');
    await currentPwdInput.waitFor({ state: "visible", timeout: 5000 });
    await currentPwdInput.fill("currentpwd");

    const disableBtn = page.getByRole("button", { name: "Desactiver le mot de passe" });
    await disableBtn.click();

    await page.waitForTimeout(500);

    const payloads = getPayloads();
    expect(payloads.length).toBe(1);
    expect(payloads[0]).toEqual({ current_password: "currentpwd" });
  });
});

// ─── Discretion Overlay ────────────────────────────────────────────

test.describe("Password: discretion overlay", () => {
  test("discretion overlay activates with Ctrl+Shift+H", async ({ page }) => {
    await page.goto("/");
    await page.locator("textarea").waitFor({ state: "visible", timeout: 15000 });

    // Activate discretion overlay
    await page.keyboard.press("Control+Shift+h");

    // The overlay has a wallpaper.jpg image and covers the whole screen
    const overlay = page.locator('div[style*="z-index: 99999"]');
    await expect(overlay).toBeVisible({ timeout: 5000 });
  });

  test("discretion overlay deactivates with Escape", async ({ page }) => {
    await page.goto("/");
    await page.locator("textarea").waitFor({ state: "visible", timeout: 15000 });

    // Activate
    await page.keyboard.press("Control+Shift+h");

    const overlay = page.locator('div[style*="z-index: 99999"]');
    await expect(overlay).toBeVisible({ timeout: 5000 });

    // Deactivate with Escape
    await page.keyboard.press("Escape");

    await expect(overlay).not.toBeVisible({ timeout: 5000 });

    // App should be usable again
    await expect(page.locator("textarea")).toBeVisible({ timeout: 5000 });
  });
});

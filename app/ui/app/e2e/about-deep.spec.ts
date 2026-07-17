import { test, expect } from "./fixtures";
import { goToAbout } from "./helpers";

/**
 * Deep E2E tests for the About page (/about).
 *
 * Covers: page load, branding, version, hardware info, tool buttons,
 * external links, and navigation.
 */
test.describe("About Page — Deep", () => {
  test.beforeEach(async ({ page }) => {
    await goToAbout(page);
  });

  // ─── Page Load ───────────────────────────────────────────────────

  test("page title 'A propos' is visible in header", async ({ page }) => {
    const h1 = page.locator("h1");
    await expect(h1).toContainText("propos", { timeout: 15000 });
  });

  test("version string is displayed", async ({ page }) => {
    // The About component renders "Version 6.0" as a static string
    const versionText = page.getByText("Version 6.0");
    await expect(versionText).toBeVisible({ timeout: 5000 });
  });

  test("Dromadaire logo (SVG) is visible", async ({ page }) => {
    // The logo is an inline SVG inside a styled container div
    const logo = page.locator("svg").first();
    await expect(logo).toBeVisible({ timeout: 5000 });
  });

  // ─── Branding & Identity ─────────────────────────────────────────

  test("app name 'Dromadaire' is displayed as heading", async ({ page }) => {
    const appName = page.locator("h2", { hasText: "Dromadaire" });
    await expect(appName).toBeVisible({ timeout: 5000 });
  });

  test("author attribution is visible", async ({ page }) => {
    const author = page.getByText("Ayi NEDJIMI");
    await expect(author).toBeVisible({ timeout: 5000 });
  });

  test("tagline 'INTELLIGENCE PRIVEE' is visible", async ({ page }) => {
    const tagline = page.getByText("INTELLIGENCE PRIVEE");
    await expect(tagline).toBeVisible({ timeout: 5000 });
  });

  // ─── Description ─────────────────────────────────────────────────

  test("privacy description text is displayed", async ({ page }) => {
    const description = page.getByText("assistant IA local");
    await expect(description).toBeVisible({ timeout: 5000 });
  });

  test("no-telemetry statement is present", async ({ page }) => {
    const noTelemetry = page.getByText("telemetrie");
    await expect(noTelemetry).toBeVisible({ timeout: 5000 });
  });

  // ─── Hardware Info Section ───────────────────────────────────────

  test("hardware section heading is visible", async ({ page }) => {
    const hardwareHeading = page.getByText("Materiel d'inference");
    await expect(hardwareHeading).toBeVisible({ timeout: 5000 });
  });

  test("inference mode is displayed (CPU when no GPU)", async ({ page }) => {
    // With empty inferenceComputes mock, mode should show "CPU"
    const modeLabel = page.getByText("Mode");
    await expect(modeLabel).toBeVisible({ timeout: 5000 });

    const cpuText = page.getByText("CPU");
    await expect(cpuText).toBeVisible({ timeout: 5000 });
  });

  test("GPU details are hidden when no GPU is detected", async ({ page }) => {
    // With empty inferenceComputes, GPU/API/VRAM rows should not appear
    // The "GPU" label would appear as a row label only if isGPU is true
    const apiRow = page.locator("text=VRAM");
    await expect(apiRow).toBeHidden({ timeout: 3000 });
  });

  // ─── Tools Section ───────────────────────────────────────────────

  test("tools section heading 'Outils' is visible", async ({ page }) => {
    const toolsHeading = page.getByText("Outils");
    await expect(toolsHeading).toBeVisible({ timeout: 5000 });
  });

  test("Diagnostic button is visible and enabled", async ({ page }) => {
    const diagButton = page.getByRole("button", { name: "Diagnostic" });
    await expect(diagButton).toBeVisible({ timeout: 5000 });
    await expect(diagButton).toBeEnabled();
  });

  test("Performance button is visible and enabled", async ({ page }) => {
    const perfButton = page.getByRole("button", { name: "Performance" });
    await expect(perfButton).toBeVisible({ timeout: 5000 });
    await expect(perfButton).toBeEnabled();
  });

  // ─── External Link ───────────────────────────────────────────────

  test("intelligence-privee.fr link is present with valid href", async ({
    page,
  }) => {
    const link = page.locator('a[href="https://intelligence-privee.fr"]');
    await expect(link).toBeVisible({ timeout: 5000 });
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /noopener/);
  });

  // ─── Navigation ──────────────────────────────────────────────────

  test("back button navigates to home", async ({ page }) => {
    // On Windows, the back button (ArrowLeft) is rendered with aria-label "Retour"
    const backButton = page.getByRole("button", { name: "Retour" });
    await expect(backButton).toBeVisible({ timeout: 5000 });

    await backButton.click();

    // Should navigate back to the chat page (textarea visible)
    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 15000 });
  });
});

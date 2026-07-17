import { test, expect } from "./fixtures";
import {
  goToSettings,
  capturePostRequests,
  mockSettingsOverride,
} from "./helpers";

// ─── Toggle Encryption On ──────────────────────────────────────────

test.describe("Encryption: toggle on", () => {
  test("encryption toggle visible in settings", async ({ page }) => {
    await goToSettings(page);

    await expect(
      page.getByText("Chiffrement des conversations").first(),
    ).toBeVisible({ timeout: 5000 });

    // The switch is labeled by the "Chiffrement des conversations" label
    const toggle = page.getByRole("switch", { name: "Chiffrement des conversations" });
    await expect(toggle).toBeVisible({ timeout: 5000 });
  });

  test("encryption description and warning visible", async ({ page }) => {
    await goToSettings(page);

    // Description text
    await expect(
      page.getByText("Chiffre toutes les conversations").first(),
    ).toBeVisible({ timeout: 5000 });

    // Warning about key loss
    await expect(
      page.getByText("si la cl").first(),
    ).toBeVisible({ timeout: 5000 });
  });

  test("toggling encryption on sends POST with EncryptionEnabled:true", async ({ page }) => {
    const getPayloads = await capturePostRequests(
      page,
      "**/api/v1/settings",
    );

    await goToSettings(page);

    // Click the encryption switch (labeled via aria-labelledby)
    const toggle = page.getByRole("switch", { name: "Chiffrement des conversations" });
    await toggle.waitFor({ state: "visible", timeout: 5000 });
    await toggle.click();

    await page.waitForTimeout(500);

    // Verify the POST includes EncryptionEnabled: true
    const payloads = getPayloads();
    const encPayload = payloads.find(
      (p: any) => p && typeof p === "object" && "EncryptionEnabled" in p,
    );
    expect(encPayload).toBeDefined();
    expect((encPayload as any).EncryptionEnabled).toBe(true);
  });

  test("key backup panel shows after enabling encryption", async ({ page }) => {
    // Mock the encryption key endpoint to return a key
    await page.route("**/api/v1/encryption-key", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          key: "aes256-test-key-abcdef1234567890",
          path: "C:\\Users\\Ayi\\.dromadaire\\encryption.key",
        }),
      });
    });

    await goToSettings(page);

    // Toggle encryption on
    const toggle = page.getByRole("switch", { name: "Chiffrement des conversations" });
    await toggle.waitFor({ state: "visible", timeout: 5000 });
    await toggle.click();

    // Key backup panel should appear
    await expect(
      page.getByText("Sauvegardez votre cl").first(),
    ).toBeVisible({ timeout: 5000 });

    // Key should be displayed
    await expect(
      page.getByText("aes256-test-key-abcdef1234567890"),
    ).toBeVisible({ timeout: 5000 });

    // File path should be shown
    await expect(
      page.getByText("Fichier").first(),
    ).toBeVisible({ timeout: 5000 });
  });
});

// ─── Toggle Encryption Off ─────────────────────────────────────────

test.describe("Encryption: toggle off", () => {
  test("toggle shows checked state when encryption enabled", async ({ page }) => {
    // Navigate first to establish origin, then override settings
    await goToSettings(page);
    await mockSettingsOverride(page, { EncryptionEnabled: true });

    // The encryption switch should be checked
    const toggle = page.getByRole("switch", { name: "Chiffrement des conversations" });
    await expect(toggle).toHaveAttribute("aria-checked", "true", { timeout: 5000 });
  });

  test("toggling off sends POST with EncryptionEnabled:false", async ({ page }) => {
    // Navigate first, then override
    await goToSettings(page);
    await mockSettingsOverride(page, { EncryptionEnabled: true });

    const getPayloads = await capturePostRequests(
      page,
      "**/api/v1/settings",
    );

    // Toggle the encryption switch off
    const toggle = page.getByRole("switch", { name: "Chiffrement des conversations" });
    await toggle.waitFor({ state: "visible", timeout: 5000 });
    await toggle.click();

    await page.waitForTimeout(500);

    const payloads = getPayloads();
    const encPayload = payloads.find(
      (p: any) => p && typeof p === "object" && "EncryptionEnabled" in p,
    );
    expect(encPayload).toBeDefined();
    expect((encPayload as any).EncryptionEnabled).toBe(false);
  });

  test("key backup panel hidden after disabling encryption", async ({ page }) => {
    // Navigate first, then override
    await goToSettings(page);
    await mockSettingsOverride(page, { EncryptionEnabled: true });

    // Toggle off
    const toggle = page.getByRole("switch", { name: "Chiffrement des conversations" });
    await toggle.waitFor({ state: "visible", timeout: 5000 });
    await toggle.click();

    await page.waitForTimeout(300);

    // Key backup should NOT appear when disabling
    const keyBackup = page.getByText("Sauvegardez votre cl");
    await expect(keyBackup).not.toBeVisible();
  });
});

// ─── Key Management ────────────────────────────────────────────────

test.describe("Encryption: key management", () => {
  test.beforeEach(async ({ page }) => {
    // Mock encryption key endpoint with real data
    await page.route("**/api/v1/encryption-key", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          key: "aes256-backup-key-9876543210fedcba",
          path: "C:\\Users\\Ayi\\.dromadaire\\encryption.key",
        }),
      });
    });
  });

  test("key file path displayed in backup panel", async ({ page }) => {
    await goToSettings(page);

    // Toggle encryption on to trigger key backup panel
    const toggle = page.getByRole("switch", { name: "Chiffrement des conversations" });
    await toggle.waitFor({ state: "visible", timeout: 5000 });
    await toggle.click();

    // Path should be displayed
    await expect(
      page.getByText("encryption.key").first(),
    ).toBeVisible({ timeout: 5000 });
  });

  test("copy key button visible in backup panel", async ({ page }) => {
    await goToSettings(page);

    const toggle = page.getByRole("switch", { name: "Chiffrement des conversations" });
    await toggle.waitFor({ state: "visible", timeout: 5000 });
    await toggle.click();

    // Copy button
    await expect(
      page.getByRole("button", { name: /Copier la cl/ }),
    ).toBeVisible({ timeout: 5000 });
  });

  test("download key button visible in backup panel", async ({ page }) => {
    await goToSettings(page);

    const toggle = page.getByRole("switch", { name: "Chiffrement des conversations" });
    await toggle.waitFor({ state: "visible", timeout: 5000 });
    await toggle.click();

    // Download button
    await expect(
      page.getByRole("button", { name: /charger .key/ }),
    ).toBeVisible({ timeout: 5000 });
  });

  test("acknowledge button dismisses key backup panel", async ({ page }) => {
    await goToSettings(page);

    const toggle = page.getByRole("switch", { name: "Chiffrement des conversations" });
    await toggle.waitFor({ state: "visible", timeout: 5000 });
    await toggle.click();

    // Key backup panel should be visible
    const backupPanel = page.getByText("Sauvegardez votre cl").first();
    await expect(backupPanel).toBeVisible({ timeout: 5000 });

    // Click the "J'ai sauvegardé ma clé" button
    const ackBtn = page.getByRole("button", { name: /sauvegard/ });
    await ackBtn.click();

    // Panel should disappear
    await expect(backupPanel).not.toBeVisible({ timeout: 5000 });
  });
});

// ─── UX Feedback ───────────────────────────────────────────────────

test.describe("Encryption: UX feedback", () => {
  test("lock icon visible on sidebar chats when encryption enabled", async ({ page }) => {
    // The sidebar reads chatInfos (camelCase) from ChatsResponse
    const mockChatInfos = [
      {
        id: "chat-001",
        title: "Conversation recente",
        userExcerpt: "",
        createdAt: "2025-02-20T14:00:00Z",
        updatedAt: "2025-02-20T15:30:00Z",
        pinned: false,
        folder: "",
      },
    ];

    await page.route("**/api/v1/chats", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ chatInfos: mockChatInfos }),
      });
    });

    // Navigate to home first to establish origin for mockSettingsOverride
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    // Enable encryption and reload
    await mockSettingsOverride(page, { EncryptionEnabled: true });

    // Wait for sidebar to render with chats
    await expect(
      page.getByText("Conversation recente").first(),
    ).toBeVisible({ timeout: 15000 });

    // Lock icons (emerald-colored) should be visible next to chat entries
    // The sidebar renders Lock with class text-emerald-500 when encryption is on
    const lockIcons = page.locator(".text-emerald-500");
    await expect(lockIcons.first()).toBeVisible({ timeout: 5000 });
  });

  test("no lock icon on sidebar chats when encryption disabled", async ({ page }) => {
    // The sidebar reads chatInfos (camelCase) from ChatsResponse
    const mockChatInfos = [
      {
        id: "chat-001",
        title: "Conversation recente",
        userExcerpt: "",
        createdAt: "2025-02-20T14:00:00Z",
        updatedAt: "2025-02-20T15:30:00Z",
        pinned: false,
        folder: "",
      },
    ];

    // Default: EncryptionEnabled is false
    await page.route("**/api/v1/chats", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ chatInfos: mockChatInfos }),
      });
    });

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByText("Conversation recente").first(),
    ).toBeVisible({ timeout: 15000 });

    // Lock icons should NOT be visible
    const lockIcons = page.locator("svg.text-emerald-500");
    await expect(lockIcons).not.toBeVisible();
  });

  test("encryption switch reflects enabled state in settings", async ({ page }) => {
    // Navigate first, then override
    await goToSettings(page);
    await mockSettingsOverride(page, { EncryptionEnabled: true });

    // The encryption switch should be ON
    const toggle = page.getByRole("switch", { name: "Chiffrement des conversations" });
    await expect(toggle).toHaveAttribute("aria-checked", "true", { timeout: 5000 });
  });

  test("encryption switch reflects disabled state in settings", async ({ page }) => {
    // Default: EncryptionEnabled is false
    await goToSettings(page);

    const toggle = page.getByRole("switch", { name: "Chiffrement des conversations" });
    await expect(toggle).toHaveAttribute("aria-checked", "false", { timeout: 5000 });
  });
});

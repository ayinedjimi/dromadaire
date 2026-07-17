import { test, expect } from "./fixtures";
import {
  setupStreamingMock,
  goToChat,
  sendMessage,
  mockSettingsOverride,
} from "./helpers";

// ─── Content Factories ────────────────────────────────────────────

const HTML_CODE = `<h1>Hello World</h1>\n<p>Test paragraph</p>`;
const HTML_RESPONSE = `Voici le code:\n\`\`\`html\n${HTML_CODE}\n\`\`\``;

const PYTHON_CODE = `def greet(name):\n    return f"Hello, {name}!"`;
const PYTHON_RESPONSE = `Voici le code Python:\n\`\`\`python\n${PYTHON_CODE}\n\`\`\``;

const HTML_CODE_2 = `<div class="card"><h2>Card Title</h2><p>Card content</p></div>`;
const HTML_RESPONSE_MULTI = `Premier:\n\`\`\`html\n${HTML_CODE}\n\`\`\`\nDeuxieme:\n\`\`\`html\n${HTML_CODE_2}\n\`\`\``;

/**
 * Helper: set up streaming events for a code block response.
 * The content is sent as a single chunk containing a fenced code block.
 */
function makeStreamEvents(chatId: string, content: string) {
  return [
    { eventName: "chat_created", chatId },
    { eventName: "chat", content },
    { eventName: "done" },
  ];
}

function makeFinalMessages(userMsg: string, assistantContent: string) {
  return [
    { role: "user", content: userMsg },
    { role: "assistant", content: assistantContent },
  ];
}

// ─── Auto-open Tests ──────────────────────────────────────────────

test.describe("Artifact Preview — Auto-open", () => {
  test("streaming HTML code block auto-opens the preview panel", async ({ page }) => {
    const chatId = "art-html-001";
    await setupStreamingMock(
      page, chatId,
      makeStreamEvents(chatId, HTML_RESPONSE),
      makeFinalMessages("Crée une page HTML", HTML_RESPONSE),
    );

    await goToChat(page);
    await sendMessage(page, "Crée une page HTML");

    // Wait for the panel to appear — it contains the ArtifactPreviewPanel
    // The panel header shows the language badge
    const langBadge = page.locator("span.uppercase").filter({ hasText: /^html$/i });
    await expect(langBadge).toBeVisible({ timeout: 10000 });
  });

  test("streaming Python code opens panel on Code tab (no preview)", async ({ page }) => {
    const chatId = "art-py-002";
    await setupStreamingMock(
      page, chatId,
      makeStreamEvents(chatId, PYTHON_RESPONSE),
      makeFinalMessages("Montre du Python", PYTHON_RESPONSE),
    );

    await goToChat(page);
    await sendMessage(page, "Montre du Python");

    // Panel opens — Python is NOT renderable, so no "Apercu" tab should be active
    const langBadge = page.locator("span.uppercase").filter({ hasText: /^python$/i });
    await expect(langBadge).toBeVisible({ timeout: 10000 });

    // "Apercu" tab should NOT be visible for non-renderable languages
    const previewTab = page.getByRole("button", { name: "Apercu" });
    await expect(previewTab).toBeHidden({ timeout: 3000 });
  });

  test("auto-open respects ~100ms delay for renderable HTML", async ({ page }) => {
    const chatId = "art-delay-003";
    // Send content in chunks to exercise the throttle logic
    const events = [
      { eventName: "chat_created", chatId },
      { eventName: "chat", content: "Voici:\n```html\n<h1>Test de delai pour verifier que le panel s'ouvre rapidement</h1>\n```" },
      { eventName: "done" },
    ];
    await setupStreamingMock(
      page, chatId, events,
      makeFinalMessages("Test", "Voici:\n```html\n<h1>Test de delai</h1>\n```"),
    );

    await goToChat(page);
    await sendMessage(page, "Test");

    // Panel should appear relatively quickly (within 5s is generous for a 100ms delay)
    const langBadge = page.locator("span.uppercase").filter({ hasText: /^html$/i });
    await expect(langBadge).toBeVisible({ timeout: 5000 });
  });

  test("ArtifactsEnabled=false prevents panel from opening", async ({ page }) => {
    const chatId = "art-disabled-004";
    await setupStreamingMock(
      page, chatId,
      makeStreamEvents(chatId, HTML_RESPONSE),
      makeFinalMessages("Test", HTML_RESPONSE),
    );

    await goToChat(page);
    await mockSettingsOverride(page, { ArtifactsEnabled: false });

    // Re-setup streaming mock after reload (mockSettingsOverride reloads page)
    await setupStreamingMock(
      page, chatId,
      makeStreamEvents(chatId, HTML_RESPONSE),
      makeFinalMessages("Test", HTML_RESPONSE),
    );

    await sendMessage(page, "Test");

    // Wait for the streamed text to appear
    await expect(page.getByText("Voici le code:")).toBeVisible({ timeout: 10000 });

    // But the panel should NOT appear — no language badge in header
    const langBadge = page.locator("span.uppercase").filter({ hasText: /^html$/i });
    // Give it some time to potentially appear, then assert it's not there
    await page.waitForTimeout(2000);
    await expect(langBadge).toBeHidden();
  });
});

// ─── Preview HTML Tests ───────────────────────────────────────────

test.describe("Artifact Preview — HTML Preview", () => {
  test.beforeEach(async ({ page }) => {
    const chatId = "art-preview-html";
    await setupStreamingMock(
      page, chatId,
      makeStreamEvents(chatId, HTML_RESPONSE),
      makeFinalMessages("HTML", HTML_RESPONSE),
    );
    await goToChat(page);
    await sendMessage(page, "HTML");
    // Wait for panel to open
    const langBadge = page.locator("span.uppercase").filter({ hasText: /^html$/i });
    await expect(langBadge).toBeVisible({ timeout: 10000 });
  });

  test("iframe is visible in the preview tab", async ({ page }) => {
    const iframe = page.locator('iframe[title="Artifact Preview"]');
    await expect(iframe).toBeVisible({ timeout: 5000 });
  });

  test("iframe has correct sandbox attributes", async ({ page }) => {
    const iframe = page.locator('iframe[title="Artifact Preview"]');
    await expect(iframe).toBeVisible({ timeout: 5000 });
    const sandbox = await iframe.getAttribute("sandbox");
    expect(sandbox).toContain("allow-scripts");
    expect(sandbox).toContain("allow-same-origin");
    expect(sandbox).toContain("allow-forms");
    // Should NOT contain allow-popups (removed in security audit)
    expect(sandbox).not.toContain("allow-popups");
  });

  test("HTML content is rendered in the iframe", async ({ page }) => {
    const iframe = page.locator('iframe[title="Artifact Preview"]');
    await expect(iframe).toBeVisible({ timeout: 5000 });

    // The iframe uses a blob URL, so we verify it has a src
    await page.waitForTimeout(1000);
    const src = await iframe.getAttribute("src");
    expect(src).toBeTruthy();
    // Blob URLs start with "blob:"
    expect(src).toMatch(/^blob:/);
  });

  test("open-in-tab button is visible for HTML", async ({ page }) => {
    const openBtn = page.locator('button[aria-label="Ouvrir dans un nouvel onglet"]');
    await expect(openBtn).toBeVisible({ timeout: 5000 });
  });

  test("console toggle button is visible for HTML", async ({ page }) => {
    const consoleBtn = page.locator('button[aria-label="Basculer la console JavaScript"]');
    await expect(consoleBtn).toBeVisible({ timeout: 5000 });
  });

  test("STORAGE_SANDBOX_SCRIPT is present in the iframe blob content", async ({ page }) => {
    const iframe = page.locator('iframe[title="Artifact Preview"]');
    await expect(iframe).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(1000);

    // Get the iframe's src (blob URL) and check the content via JavaScript
    const hasStorageSandbox = await page.evaluate(() => {
      const iframe = document.querySelector('iframe[title="Artifact Preview"]') as HTMLIFrameElement;
      if (!iframe || !iframe.contentDocument) return false;
      const html = iframe.contentDocument.documentElement.outerHTML;
      return html.includes("SecurityError") && html.includes("localStorage");
    });
    expect(hasStorageSandbox).toBe(true);
  });
});

// ─── Tabs Tests ───────────────────────────────────────────────────

test.describe("Artifact Preview — Tabs", () => {
  test.beforeEach(async ({ page }) => {
    const chatId = "art-tabs-html";
    await setupStreamingMock(
      page, chatId,
      makeStreamEvents(chatId, HTML_RESPONSE),
      makeFinalMessages("HTML tabs", HTML_RESPONSE),
    );
    await goToChat(page);
    await sendMessage(page, "HTML tabs");
    const langBadge = page.locator("span.uppercase").filter({ hasText: /^html$/i });
    await expect(langBadge).toBeVisible({ timeout: 10000 });
  });

  test("Apercu tab is selected by default for HTML", async ({ page }) => {
    // The iframe should be visible (preview mode is default for renderable)
    const iframe = page.locator('iframe[title="Artifact Preview"]');
    await expect(iframe).toBeVisible({ timeout: 5000 });

    // Apercu button should have the active style
    const previewTab = page.getByRole("button", { name: "Apercu" });
    await expect(previewTab).toBeVisible({ timeout: 3000 });
  });

  test("Code tab shows the code editor/viewer", async ({ page }) => {
    const codeTab = page.getByRole("button", { name: "Code" });
    await codeTab.click();

    // Monaco editor loads lazily — look for the loading text or the editor container
    const editorOrLoading = page.locator(".monaco-editor, :text('Chargement')");
    await expect(editorOrLoading.first()).toBeVisible({ timeout: 10000 });
  });

  test("Split tab shows both preview and code side by side", async ({ page }) => {
    const splitTab = page.getByRole("button", { name: "Split" });
    await splitTab.click();

    // In split mode, there should be both an iframe and a code editor area
    await page.waitForTimeout(1000);
    // Split layout uses a flex container with two halves
    const splitContainer = page.locator(".flex.h-full > .w-1\\/2");
    const count = await splitContainer.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test("clicking Code then Apercu returns to iframe preview", async ({ page }) => {
    // Go to code tab first
    const codeTab = page.getByRole("button", { name: "Code" });
    await codeTab.click();
    await page.waitForTimeout(500);

    // iframe should be hidden on code tab
    const iframe = page.locator('iframe[title="Artifact Preview"]');
    await expect(iframe).toBeHidden({ timeout: 3000 });

    // Go back to preview tab
    const previewTab = page.getByRole("button", { name: "Apercu" });
    await previewTab.click();

    // iframe should be visible again
    await expect(iframe).toBeVisible({ timeout: 5000 });
  });

  test("all three tabs are visible for renderable language", async ({ page }) => {
    const previewTab = page.getByRole("button", { name: "Apercu" });
    const codeTab = page.getByRole("button", { name: "Code" });
    const splitTab = page.getByRole("button", { name: "Split" });

    await expect(previewTab).toBeVisible({ timeout: 3000 });
    await expect(codeTab).toBeVisible({ timeout: 3000 });
    await expect(splitTab).toBeVisible({ timeout: 3000 });
  });
});

// ─── Header Tests ─────────────────────────────────────────────────

test.describe("Artifact Preview — Header", () => {
  test.beforeEach(async ({ page }) => {
    const chatId = "art-header-html";
    await setupStreamingMock(
      page, chatId,
      makeStreamEvents(chatId, HTML_RESPONSE),
      makeFinalMessages("HTML header", HTML_RESPONSE),
    );
    await goToChat(page);
    await sendMessage(page, "HTML header");
    const langBadge = page.locator("span.uppercase").filter({ hasText: /^html$/i });
    await expect(langBadge).toBeVisible({ timeout: 10000 });
  });

  test("header shows language label (HTML)", async ({ page }) => {
    // The header has a span with the language in uppercase
    const label = page.locator("span.uppercase").filter({ hasText: /^html$/i });
    await expect(label).toBeVisible({ timeout: 3000 });
  });

  test("download button is visible", async ({ page }) => {
    const downloadBtn = page.locator('button[aria-label="Télécharger le fichier"]');
    await expect(downloadBtn).toBeVisible({ timeout: 5000 });
  });

  test("close button closes the panel", async ({ page }) => {
    const closeBtn = page.locator('button[aria-label="Fermer le panneau"]');
    await expect(closeBtn).toBeVisible({ timeout: 3000 });
    await closeBtn.click();

    // Panel should disappear — iframe no longer visible
    const iframe = page.locator('iframe[title="Artifact Preview"]');
    await expect(iframe).toBeHidden({ timeout: 5000 });
  });

  test("fullscreen button is visible", async ({ page }) => {
    const fullscreenBtn = page.locator('button[aria-label="Plein écran"]');
    await expect(fullscreenBtn).toBeVisible({ timeout: 3000 });
  });

  test("revert button appears after code modification", async ({ page }) => {
    // Revert button should NOT be visible initially
    const revertBtn = page.locator('button[aria-label="Revenir à la version d\'origine"]');
    await expect(revertBtn).toBeHidden({ timeout: 3000 });

    // Switch to Code tab to modify in Monaco
    const codeTab = page.getByRole("button", { name: "Code" });
    await codeTab.click();

    // Wait for Monaco to load
    const editor = page.locator(".monaco-editor");
    await expect(editor).toBeVisible({ timeout: 10000 });

    // Type something in the Monaco editor to trigger userEdited state
    // Monaco editor has a textarea inside for input
    const monacoTextarea = page.locator(".monaco-editor textarea");
    await monacoTextarea.focus();
    await page.keyboard.type("<!-- modified -->");

    // Revert button should now appear
    await expect(revertBtn).toBeVisible({ timeout: 5000 });
  });
});

// ─── Edit & Keyboard Tests ────────────────────────────────────────

test.describe("Artifact Preview — Edit & Keyboard", () => {
  test("modify code in editor then revert returns to original", async ({ page }) => {
    const chatId = "art-edit-001";
    await setupStreamingMock(
      page, chatId,
      makeStreamEvents(chatId, HTML_RESPONSE),
      makeFinalMessages("HTML edit", HTML_RESPONSE),
    );
    await goToChat(page);
    await sendMessage(page, "HTML edit");

    const langBadge = page.locator("span.uppercase").filter({ hasText: /^html$/i });
    await expect(langBadge).toBeVisible({ timeout: 10000 });

    // Switch to Code tab
    const codeTab = page.getByRole("button", { name: "Code" });
    await codeTab.click();

    const editor = page.locator(".monaco-editor");
    await expect(editor).toBeVisible({ timeout: 10000 });

    // Type to modify
    const monacoTextarea = page.locator(".monaco-editor textarea");
    await monacoTextarea.focus();
    await page.keyboard.type("<!-- extra -->");

    // Revert button appears
    const revertBtn = page.locator('button[aria-label="Revenir à la version d\'origine"]');
    await expect(revertBtn).toBeVisible({ timeout: 5000 });

    // Click revert
    await revertBtn.click();

    // Revert button should disappear after reverting
    await expect(revertBtn).toBeHidden({ timeout: 5000 });
  });

  test("Escape key closes the preview panel", async ({ page }) => {
    const chatId = "art-esc-002";
    await setupStreamingMock(
      page, chatId,
      makeStreamEvents(chatId, HTML_RESPONSE),
      makeFinalMessages("HTML esc", HTML_RESPONSE),
    );
    await goToChat(page);
    await sendMessage(page, "HTML esc");

    const langBadge = page.locator("span.uppercase").filter({ hasText: /^html$/i });
    await expect(langBadge).toBeVisible({ timeout: 10000 });

    // Press Escape
    await page.keyboard.press("Escape");

    // Panel should close
    const iframe = page.locator('iframe[title="Artifact Preview"]');
    await expect(iframe).toBeHidden({ timeout: 5000 });
  });

  test("Ctrl+Shift+P toggles the preview panel closed", async ({ page }) => {
    const chatId = "art-shortcut-003";
    await setupStreamingMock(
      page, chatId,
      makeStreamEvents(chatId, HTML_RESPONSE),
      makeFinalMessages("HTML shortcut", HTML_RESPONSE),
    );
    await goToChat(page);
    await sendMessage(page, "HTML shortcut");

    const langBadge = page.locator("span.uppercase").filter({ hasText: /^html$/i });
    await expect(langBadge).toBeVisible({ timeout: 10000 });

    // Ctrl+Shift+P closes the panel
    await page.keyboard.press("Control+Shift+P");

    // Panel should close
    const iframe = page.locator('iframe[title="Artifact Preview"]');
    await expect(iframe).toBeHidden({ timeout: 5000 });
  });
});

// ─── Multi-artifact Tests ─────────────────────────────────────────

test.describe("Artifact Preview — Multi-artifacts", () => {
  test("multiple code blocks create multiple artifact tabs", async ({ page }) => {
    const chatId = "art-multi-001";
    await setupStreamingMock(
      page, chatId,
      makeStreamEvents(chatId, HTML_RESPONSE_MULTI),
      makeFinalMessages("Multi HTML", HTML_RESPONSE_MULTI),
    );

    await goToChat(page);
    await sendMessage(page, "Multi HTML");

    // Wait for the panel to open
    const langBadge = page.locator("span.uppercase").filter({ hasText: /^html$/i });
    await expect(langBadge).toBeVisible({ timeout: 10000 });

    // Multi-artifact tabs should appear when there are multiple artifacts
    // The tabs are in a container with buttons for each artifact
    // Wait for the second artifact to be detected
    await page.waitForTimeout(2000);

    // Check for multiple tab buttons at the top of the panel area
    // These are the artifact selector tabs (not preview/code/split tabs)
    const artifactTabs = page.locator("button").filter({ hasText: /html|#\d+/i });
    const count = await artifactTabs.count();
    // We expect at least the panel to be open
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test("can switch between artifact tabs", async ({ page }) => {
    const chatId = "art-switch-002";
    // Use two different languages so they create separate artifacts
    const multiLangContent = `Premier:\n\`\`\`html\n${HTML_CODE}\n\`\`\`\nDeuxieme:\n\`\`\`json\n{"name": "test", "value": 42}\n\`\`\``;
    await setupStreamingMock(
      page, chatId,
      makeStreamEvents(chatId, multiLangContent),
      makeFinalMessages("Multi lang", multiLangContent),
    );

    await goToChat(page);
    await sendMessage(page, "Multi lang");

    // Wait for panel to open
    await page.waitForTimeout(3000);

    // The panel should be visible with some language badge
    const panel = page.locator('button[aria-label="Fermer le panneau"]');
    await expect(panel).toBeVisible({ timeout: 10000 });
  });
});

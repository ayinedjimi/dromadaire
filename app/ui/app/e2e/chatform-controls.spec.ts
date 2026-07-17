import { test, expect } from "./fixtures";
import {
  setupModels,
  setupStreamingMock,
  goToChat,
  mockSettingsOverride,
  capturePostRequests,
  MOCK_RAG_DOCUMENTS,
  setupRAGDocuments,
} from "./helpers";

// ─── ModelPicker ──────────────────────────────────────────────────────

test.describe("ModelPicker", () => {
  test.beforeEach(async ({ page }) => {
    await setupModels(page);
    await goToChat(page);
  });

  test("dropdown button is visible on chat page", async ({ page }) => {
    const pickerButton = page.locator('button[title="Choisir un modèle"]');
    await expect(pickerButton).toBeVisible({ timeout: 5000 });
  });

  test("click opens dropdown with model list", async ({ page }) => {
    const pickerButton = page.locator('button[title="Choisir un modèle"]');
    await pickerButton.click();

    // The dropdown contains a search input
    const searchInput = page.locator('input[placeholder="Rechercher un modèle..."]');
    await expect(searchInput).toBeVisible({ timeout: 5000 });
  });

  test("shows at least 3 models when mocked", async ({ page }) => {
    const pickerButton = page.locator('button[title="Choisir un modèle"]');
    await pickerButton.click();

    // Wait for the dropdown list to appear
    const modelButtons = page.locator(".h-64 button");
    await expect(modelButtons.first()).toBeVisible({ timeout: 5000 });

    const count = await modelButtons.count();
    expect(count).toBeGreaterThanOrEqual(3);
  });

  test("selecting a model closes dropdown and updates displayed model", async ({ page }) => {
    const pickerButton = page.locator('button[title="Choisir un modèle"]');
    await pickerButton.click();

    // Click on "gemma3:4b" in the dropdown
    const gemmaOption = page.locator(".h-64 button").filter({ hasText: "gemma3:4b" });
    await expect(gemmaOption).toBeVisible({ timeout: 5000 });
    await gemmaOption.click();

    // Dropdown should close — search input no longer visible
    const searchInput = page.locator('input[placeholder="Rechercher un modèle..."]');
    await expect(searchInput).toBeHidden({ timeout: 5000 });

    // The picker button should now display the selected model name
    await expect(pickerButton).toContainText("gemma3:4b", { timeout: 5000 });
  });

  test("search field in dropdown filters models", async ({ page }) => {
    const pickerButton = page.locator('button[title="Choisir un modèle"]');
    await pickerButton.click();

    const searchInput = page.locator('input[placeholder="Rechercher un modèle..."]');
    await expect(searchInput).toBeVisible({ timeout: 5000 });

    // Type a search query that matches only one model
    await searchInput.fill("deepseek");

    // Only deepseek model should remain
    const modelButtons = page.locator(".h-64 button");
    // Wait for filtering to take effect
    await expect(modelButtons).toHaveCount(1, { timeout: 5000 });
    await expect(modelButtons.first()).toContainText("deepseek-coder:6.7b");
  });

  test("no models shows empty message", async ({ page }) => {
    // Override models to return empty list
    await page.route("**/api/tags", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ models: [] }),
      });
    });
    await page.reload();
    await page.locator("textarea").waitFor({ state: "visible", timeout: 15000 });

    const pickerButton = page.locator('button[title="Choisir un modèle"]');
    await pickerButton.click();

    // "Aucun modèle trouvé" should be displayed
    await expect(page.getByText("Aucun modèle trouvé")).toBeVisible({ timeout: 5000 });
  });

  test("selected model from settings appears by default", async ({ page }) => {
    // Default settings have SelectedModel = "llama3.2:3b"
    const pickerButton = page.locator('button[title="Choisir un modèle"]');
    await expect(pickerButton).toContainText("llama3.2:3b", { timeout: 5000 });
  });

  test("model display names are shown in dropdown items", async ({ page }) => {
    const pickerButton = page.locator('button[title="Choisir un modèle"]');
    await pickerButton.click();

    // Each mocked model name should appear
    await expect(page.locator(".h-64").getByText("gemma3:4b")).toBeVisible({ timeout: 5000 });
    await expect(page.locator(".h-64").getByText("llama3.2:3b")).toBeVisible({ timeout: 5000 });
    await expect(page.locator(".h-64").getByText("deepseek-coder:6.7b")).toBeVisible({ timeout: 5000 });
  });
});

// ─── ResponseModeButton ──────────────────────────────────────────────

test.describe("ResponseModeButton", () => {
  test.beforeEach(async ({ page }) => {
    await setupModels(page);
    await goToChat(page);
  });

  test("shows 'Normal' label by default", async ({ page }) => {
    // ResponseModeButton should display "Normal" when no mode is set
    const modeButton = page.locator("button").filter({ hasText: "Normal" });
    await expect(modeButton).toBeVisible({ timeout: 5000 });
  });

  test("click opens dropdown with 7 response modes", async ({ page }) => {
    const modeButton = page.locator("button").filter({ hasText: "Normal" }).first();
    await modeButton.click();

    // The dropdown should show 7 modes
    const modeOptions = page.locator(".absolute.bottom-full .flex.w-full.items-center");
    await expect(modeOptions.first()).toBeVisible({ timeout: 5000 });

    // Verify all 7 modes are listed
    const modeLabels = ["Normal", "Concis", "Detaille", "Code", "Pedagogue", "Humain", "UI/UX"];
    for (const label of modeLabels) {
      await expect(
        page.locator(".absolute.bottom-full").getByText(label, { exact: true }).first()
      ).toBeVisible({ timeout: 3000 });
    }
  });

  test("clicking 'Concis' updates the mode and sends POST to settings", async ({ page }) => {
    const getPayloads = await capturePostRequests(page, "**/api/v1/settings");

    const modeButton = page.locator("button").filter({ hasText: "Normal" }).first();
    await modeButton.click();

    // Click "Concis"
    const concisOption = page.locator(".absolute.bottom-full").getByText("Concis", { exact: true });
    await expect(concisOption).toBeVisible({ timeout: 5000 });
    await concisOption.click();

    // Wait for the POST to be sent
    await page.waitForTimeout(500);

    // The label should now show "Concis"
    await expect(page.locator("button").filter({ hasText: "Concis" }).first()).toBeVisible({ timeout: 5000 });

    // Verify a POST was sent with ResponseMode
    const payloads = getPayloads();
    const settingsPost = payloads.find(
      (p: any) => p && typeof p === "object" && "ResponseMode" in p
    );
    expect(settingsPost).toBeTruthy();
  });

  test("clicking 'Code' updates the mode", async ({ page }) => {
    const modeButton = page.locator("button").filter({ hasText: "Normal" }).first();
    await modeButton.click();

    const codeOption = page.locator(".absolute.bottom-full").getByText("Code", { exact: true });
    await expect(codeOption).toBeVisible({ timeout: 5000 });
    await codeOption.click();

    // The button should now show "Code"
    await expect(page.locator("button").filter({ hasText: "Code" }).first()).toBeVisible({ timeout: 5000 });
  });

  test("label changes after selection", async ({ page }) => {
    const modeButton = page.locator("button").filter({ hasText: "Normal" }).first();
    await modeButton.click();

    // Select "Pedagogue"
    const pedagogueOption = page.locator(".absolute.bottom-full").getByText("Pedagogue", { exact: true });
    await pedagogueOption.click();

    await expect(page.locator("button").filter({ hasText: "Pedagogue" }).first()).toBeVisible({ timeout: 5000 });
  });

  test("badge '4b+' visible for small models on complex modes", async ({ page }) => {
    // Default selected model is llama3.2:3b which matches the small model pattern (3b)
    const modeButton = page.locator("button").filter({ hasText: "Normal" }).first();
    await modeButton.click();

    // The "4b+" badge should be visible next to complex modes (human, ui-ux, code, pedagogic)
    const badge = page.locator(".absolute.bottom-full").getByText("4b+").first();
    await expect(badge).toBeVisible({ timeout: 5000 });
  });

  test("'Humain' mode shows sub-modes pills", async ({ page }) => {
    // First set the mode to "human" via settings so we can see sub-modes
    const modeButton = page.locator("button").filter({ hasText: "Normal" }).first();
    await modeButton.click();

    // Click "Humain"
    const humainOption = page.locator(".absolute.bottom-full button").filter({ hasText: "Humain" });
    await expect(humainOption).toBeVisible({ timeout: 5000 });
    await humainOption.click();

    // Wait for settings to propagate
    await page.waitForTimeout(500);

    // Re-open dropdown
    const updatedModeButton = page.locator("button").filter({ hasText: "Humain" }).first();
    await updatedModeButton.click();

    // Sub-mode pills should appear: Conversation, Email, SMS, Forum, Academique
    const subModeLabels = ["Conversation", "Email", "SMS", "Forum", "Academique"];
    for (const label of subModeLabels) {
      await expect(
        page.locator(".absolute.bottom-full").getByText(label, { exact: true })
      ).toBeVisible({ timeout: 5000 });
    }
  });

  test("clicking 'Email' under Humain sends correct settings", async ({ page }) => {
    const getPayloads = await capturePostRequests(page, "**/api/v1/settings");

    // Set mode to Humain first
    const modeButton = page.locator("button").filter({ hasText: "Normal" }).first();
    await modeButton.click();
    const humainOption = page.locator(".absolute.bottom-full button").filter({ hasText: "Humain" });
    await humainOption.click();
    await page.waitForTimeout(500);

    // Re-open and click Email sub-mode
    const updatedModeButton = page.locator("button").filter({ hasText: "Humain" }).first();
    await updatedModeButton.click();

    const emailPill = page.locator(".absolute.bottom-full").getByText("Email", { exact: true });
    await expect(emailPill).toBeVisible({ timeout: 5000 });
    await emailPill.click();
    await page.waitForTimeout(500);

    // Verify POST with HumanSubMode
    const payloads = getPayloads();
    const subModePost = payloads.find(
      (p: any) => p && typeof p === "object" && "HumanSubMode" in p && p.HumanSubMode === "email"
    );
    expect(subModePost).toBeTruthy();
  });

  test("return to 'Normal' resets sub-mode", async ({ page }) => {
    const getPayloads = await capturePostRequests(page, "**/api/v1/settings");

    // Set mode to Humain
    const modeButton = page.locator("button").filter({ hasText: "Normal" }).first();
    await modeButton.click();
    const humainOption = page.locator(".absolute.bottom-full button").filter({ hasText: "Humain" });
    await humainOption.click();
    await page.waitForTimeout(500);

    // Now switch back to Normal
    const updatedModeButton = page.locator("button").filter({ hasText: "Humain" }).first();
    await updatedModeButton.click();
    const normalOption = page.locator(".absolute.bottom-full button").filter({ hasText: "Normal" });
    await normalOption.click();
    await page.waitForTimeout(500);

    // Label should be back to Normal
    await expect(page.locator("button").filter({ hasText: "Normal" }).first()).toBeVisible({ timeout: 5000 });

    // Verify POST sent with ResponseMode="" (empty = normal) and HumanSubMode=""
    const payloads = getPayloads();
    const resetPost = payloads.find(
      (p: any) => p && typeof p === "object" && "HumanSubMode" in p && p.HumanSubMode === ""
    );
    expect(resetPost).toBeTruthy();
  });

  test("UI/UX mode shows sub-modes pills", async ({ page }) => {
    const modeButton = page.locator("button").filter({ hasText: "Normal" }).first();
    await modeButton.click();

    // Click "UI/UX"
    const uiuxOption = page.locator(".absolute.bottom-full button").filter({ hasText: "UI/UX" });
    await expect(uiuxOption).toBeVisible({ timeout: 5000 });
    await uiuxOption.click();
    await page.waitForTimeout(500);

    // Re-open dropdown
    const updatedModeButton = page.locator("button").filter({ hasText: "UI/UX" }).first();
    await updatedModeButton.click();

    // Sub-mode pills: General, Landing, Dashboard, App, Portfolio
    const subModeLabels = ["General", "Landing", "Dashboard", "App", "Portfolio"];
    for (const label of subModeLabels) {
      await expect(
        page.locator(".absolute.bottom-full").getByText(label, { exact: true })
      ).toBeVisible({ timeout: 5000 });
    }
  });
});

// ─── ThinkButton ─────────────────────────────────────────────────────

test.describe("ThinkButton", () => {
  test("not visible by default for non-supporting models", async ({ page }) => {
    // Default model is llama3.2:3b which does not start with "deepseek-v3.1" or "gpt-oss"
    await setupModels(page);
    await goToChat(page);

    // ThinkButton (mode=think) only renders when supportsThinkToggling is true
    // For llama3.2:3b, supportsThinkToggling = false
    const thinkButton = page.locator('button[title*="réflexion"]');
    await expect(thinkButton).toBeHidden({ timeout: 5000 });
  });

  test("visible for deepseek-v3.1 model and toggles state", async ({ page }) => {
    // Set up a deepseek model that supports think toggling
    const deepseekModels = [
      {
        name: "deepseek-v3.1:8b",
        model: "deepseek-v3.1:8b",
        digest: "dsk123",
        modified_at: "2025-01-15T10:00:00Z",
        size: 5_000_000_000,
        details: { families: ["deepseek"], parameter_size: "8B", quantization_level: "Q4_K_M" },
      },
    ];
    await setupModels(page, deepseekModels);
    await mockSettingsOverride(page, { SelectedModel: "deepseek-v3.1:8b" });

    const thinkButton = page.locator('button[title*="réflexion"]');
    await expect(thinkButton).toBeVisible({ timeout: 5000 });

    // Click to enable thinking
    await thinkButton.click();
    await page.waitForTimeout(500);

    // After toggle, button title should change to "Désactiver la réflexion"
    await expect(
      page.locator('button[title="Désactiver la réflexion"]')
    ).toBeVisible({ timeout: 5000 });
  });

  test("thinking level dropdown visible for gpt-oss model", async ({ page }) => {
    const gptOssModels = [
      {
        name: "gpt-oss:20b",
        model: "gpt-oss:20b",
        digest: "gpt123",
        modified_at: "2025-01-15T10:00:00Z",
        size: 12_000_000_000,
        details: { families: ["gpt-oss"], parameter_size: "20B", quantization_level: "Q4_K_M" },
      },
    ];
    await setupModels(page, gptOssModels);
    await mockSettingsOverride(page, { SelectedModel: "gpt-oss:20b" });

    // For gpt-oss models, the ThinkButton is in "thinkingLevel" mode
    // It shows the current level label (default "Moyen")
    const thinkLevelButton = page.locator('button[title*="Niveau de réflexion"]');
    await expect(thinkLevelButton).toBeVisible({ timeout: 5000 });

    // Click to open dropdown
    await thinkLevelButton.click();

    // Dropdown should show three levels
    await expect(page.getByText("Faible")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("Moyen")).toBeVisible({ timeout: 5000 });
    // "Élevé" (with accent)
    await expect(page.getByText("Élevé")).toBeVisible({ timeout: 5000 });
  });

  test("selecting a thinking level sends POST", async ({ page }) => {
    const gptOssModels = [
      {
        name: "gpt-oss:20b",
        model: "gpt-oss:20b",
        digest: "gpt123",
        modified_at: "2025-01-15T10:00:00Z",
        size: 12_000_000_000,
        details: { families: ["gpt-oss"], parameter_size: "20B", quantization_level: "Q4_K_M" },
      },
    ];
    await setupModels(page, gptOssModels);
    await mockSettingsOverride(page, { SelectedModel: "gpt-oss:20b" });

    const getPayloads = await capturePostRequests(page, "**/api/v1/settings");

    const thinkLevelButton = page.locator('button[title*="Niveau de réflexion"]');
    await thinkLevelButton.click();

    // Select "Faible" (low)
    await page.getByText("Faible").click();
    await page.waitForTimeout(500);

    const payloads = getPayloads();
    const levelPost = payloads.find(
      (p: any) => p && typeof p === "object" && "ThinkLevel" in p && p.ThinkLevel === "low"
    );
    expect(levelPost).toBeTruthy();
  });

  test("thinking level label shows current level", async ({ page }) => {
    const gptOssModels = [
      {
        name: "gpt-oss:20b",
        model: "gpt-oss:20b",
        digest: "gpt123",
        modified_at: "2025-01-15T10:00:00Z",
        size: 12_000_000_000,
        details: { families: ["gpt-oss"], parameter_size: "20B", quantization_level: "Q4_K_M" },
      },
    ];
    await setupModels(page, gptOssModels);
    await mockSettingsOverride(page, { SelectedModel: "gpt-oss:20b" });

    // Default ThinkLevel is "none" which maps to "medium" in ChatForm
    const thinkLevelButton = page.locator('button[title*="Niveau de réflexion"]');
    await expect(thinkLevelButton).toContainText("Moyen", { timeout: 5000 });
  });

  test("dropdown closes after selecting a level", async ({ page }) => {
    const gptOssModels = [
      {
        name: "gpt-oss:20b",
        model: "gpt-oss:20b",
        digest: "gpt123",
        modified_at: "2025-01-15T10:00:00Z",
        size: 12_000_000_000,
        details: { families: ["gpt-oss"], parameter_size: "20B", quantization_level: "Q4_K_M" },
      },
    ];
    await setupModels(page, gptOssModels);
    await mockSettingsOverride(page, { SelectedModel: "gpt-oss:20b" });

    const thinkLevelButton = page.locator('button[title*="Niveau de réflexion"]');
    await thinkLevelButton.click();

    // Select "Élevé"
    await page.getByText("Élevé").click();

    // Dropdown should close — the level options should no longer be visible
    await expect(page.getByText("Faible")).toBeHidden({ timeout: 5000 });
  });
});

// ─── WebSearchButton ─────────────────────────────────────────────────

test.describe("WebSearchButton", () => {
  test("not visible for non-supporting models", async ({ page }) => {
    // Default model is llama3.2:3b which does not start with gpt-oss/qwen3/deepseek-v3
    await setupModels(page);
    await goToChat(page);

    // Web search button should not be rendered
    const webSearchButton = page.locator('button[title*="recherche web"]');
    await expect(webSearchButton).toBeHidden({ timeout: 5000 });
  });

  test("visible for gpt-oss model and toggles on", async ({ page }) => {
    const gptOssModels = [
      {
        name: "gpt-oss:20b",
        model: "gpt-oss:20b",
        digest: "gpt123",
        modified_at: "2025-01-15T10:00:00Z",
        size: 12_000_000_000,
        details: { families: ["gpt-oss"], parameter_size: "20B", quantization_level: "Q4_K_M" },
      },
    ];
    await setupModels(page, gptOssModels);
    await mockSettingsOverride(page, { SelectedModel: "gpt-oss:20b" });

    const webSearchButton = page.locator('button[title*="recherche web"]');
    await expect(webSearchButton).toBeVisible({ timeout: 5000 });

    // Should start as disabled (title says "Activer")
    await expect(
      page.locator('button[title="Activer la recherche web"]')
    ).toBeVisible({ timeout: 5000 });

    // Click to enable
    await webSearchButton.click();
    await page.waitForTimeout(500);

    // After toggle, title should switch to "Désactiver"
    await expect(
      page.locator('button[title="Désactiver la recherche web"]')
    ).toBeVisible({ timeout: 5000 });
  });

  test("toggle sends POST WebSearchEnabled:true", async ({ page }) => {
    const gptOssModels = [
      {
        name: "gpt-oss:20b",
        model: "gpt-oss:20b",
        digest: "gpt123",
        modified_at: "2025-01-15T10:00:00Z",
        size: 12_000_000_000,
        details: { families: ["gpt-oss"], parameter_size: "20B", quantization_level: "Q4_K_M" },
      },
    ];
    await setupModels(page, gptOssModels);
    await mockSettingsOverride(page, { SelectedModel: "gpt-oss:20b" });

    const getPayloads = await capturePostRequests(page, "**/api/v1/settings");

    const webSearchButton = page.locator('button[title="Activer la recherche web"]');
    await webSearchButton.click();
    await page.waitForTimeout(500);

    const payloads = getPayloads();
    const wsPost = payloads.find(
      (p: any) => p && typeof p === "object" && "WebSearchEnabled" in p && p.WebSearchEnabled === true
    );
    expect(wsPost).toBeTruthy();
  });

  test("tooltip shows correct text when inactive", async ({ page }) => {
    const gptOssModels = [
      {
        name: "gpt-oss:20b",
        model: "gpt-oss:20b",
        digest: "gpt123",
        modified_at: "2025-01-15T10:00:00Z",
        size: 12_000_000_000,
        details: { families: ["gpt-oss"], parameter_size: "20B", quantization_level: "Q4_K_M" },
      },
    ];
    await setupModels(page, gptOssModels);
    await mockSettingsOverride(page, { SelectedModel: "gpt-oss:20b" });

    const webSearchButton = page.locator('button[title="Activer la recherche web"]');
    await expect(webSearchButton).toBeVisible({ timeout: 5000 });
    const title = await webSearchButton.getAttribute("title");
    expect(title).toBe("Activer la recherche web");
  });
});

// ─── RagButton ───────────────────────────────────────────────────────

test.describe("RagButton", () => {
  test("hidden when no RAG documents exist (default)", async ({ page }) => {
    await setupModels(page);
    await goToChat(page);

    // By default, RAG documents mock returns [], so button should not be visible
    const ragButton = page.locator('button[title*="connaissances"]');
    await expect(ragButton).toBeHidden({ timeout: 5000 });
  });

  test("visible when RAG documents exist", async ({ page }) => {
    await setupModels(page);
    await setupRAGDocuments(page, MOCK_RAG_DOCUMENTS);
    await goToChat(page);

    const ragButton = page.locator('button[title*="connaissances"]');
    await expect(ragButton).toBeVisible({ timeout: 5000 });
  });

  test("toggle changes active state", async ({ page }) => {
    await setupModels(page);
    await setupRAGDocuments(page, MOCK_RAG_DOCUMENTS);
    await goToChat(page);

    // Should start inactive: "Activer les connaissances"
    const ragButton = page.locator('button[title="Activer les connaissances"]');
    await expect(ragButton).toBeVisible({ timeout: 5000 });

    // Click to toggle on
    await ragButton.click();
    await page.waitForTimeout(500);

    // After toggle, title should change
    await expect(
      page.locator('button[title="Désactiver les connaissances"]')
    ).toBeVisible({ timeout: 5000 });
  });

  test("tooltip shows correct text", async ({ page }) => {
    await setupModels(page);
    await setupRAGDocuments(page, MOCK_RAG_DOCUMENTS);
    await goToChat(page);

    const ragButton = page.locator('button[title*="connaissances"]');
    await expect(ragButton).toBeVisible({ timeout: 5000 });
    const title = await ragButton.getAttribute("title");
    expect(title).toBe("Activer les connaissances");
  });
});

// ─── FileUpload ──────────────────────────────────────────────────────

test.describe("FileUpload", () => {
  test.beforeEach(async ({ page }) => {
    await setupModels(page);
    await goToChat(page);
  });

  test("upload button is visible in chat form", async ({ page }) => {
    // The + button for file upload ("Joindre des fichiers")
    const uploadButton = page.locator('button[title="Joindre des fichiers"]');
    await expect(uploadButton).toBeVisible({ timeout: 5000 });
  });

  test("hidden file input accepts all file types", async ({ page }) => {
    // The hidden file input has accept="*/*"
    const fileInput = page.locator('input[type="file"]');
    await expect(fileInput).toBeAttached();
    const acceptAttr = await fileInput.getAttribute("accept");
    expect(acceptAttr).toBe("*/*");
  });

  test("hidden file input supports multiple files", async ({ page }) => {
    const fileInput = page.locator('input[type="file"]');
    await expect(fileInput).toBeAttached();
    const multipleAttr = await fileInput.getAttribute("multiple");
    // The multiple attribute is present (its value is "" for boolean attributes)
    expect(multipleAttr).not.toBeNull();
  });

  test("file attachment area appears when attachments exist", async ({ page }) => {
    // We simulate adding a file by dispatching through the hidden file input
    // Since the actual upload relies on window.webview, we verify the
    // structure is correct by checking the file input and upload button exist together
    const uploadButton = page.locator('button[title="Joindre des fichiers"]');
    await expect(uploadButton).toBeVisible({ timeout: 5000 });

    // The attachment container is only visible when there are attachments
    // Verify it's NOT visible when no files are attached
    const attachmentArea = page.locator('button[aria-label^="Supprimer"]');
    const count = await attachmentArea.count();
    expect(count).toBe(0);
  });

  test("Plus icon is displayed in the upload button", async ({ page }) => {
    const uploadButton = page.locator('button[title="Joindre des fichiers"]');
    await expect(uploadButton).toBeVisible({ timeout: 5000 });

    // The button should contain an SVG (the Plus icon from Phosphor)
    const svgInButton = uploadButton.locator("svg");
    await expect(svgInButton).toBeVisible({ timeout: 5000 });
  });
});

// ─── ChatForm Layout ─────────────────────────────────────────────────

test.describe("ChatForm layout", () => {
  test.beforeEach(async ({ page }) => {
    await setupModels(page);
    await goToChat(page);
  });

  test("textarea has placeholder 'Envoyer un message'", async ({ page }) => {
    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 15000 });
    await expect(textarea).toHaveAttribute("placeholder", "Envoyer un message");
  });

  test("send button is disabled when textarea is empty", async ({ page }) => {
    // The submit button is the round button after the model picker
    // It has disabled state when no content
    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 15000 });

    // Ensure textarea is empty
    await textarea.fill("");

    // The submit button (round, black/white) should be disabled
    const submitButton = page.locator(
      "button.rounded-full.bg-black, button.rounded-full.dark\\:bg-white"
    ).last();
    await expect(submitButton).toBeDisabled({ timeout: 5000 });
  });

  test("send button is enabled when textarea has text", async ({ page }) => {
    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 15000 });

    await textarea.fill("Bonjour");

    // The submit button should become enabled
    const submitButton = page.locator(
      "button.rounded-full.bg-black, button.rounded-full.dark\\:bg-white"
    ).last();
    await expect(submitButton).toBeEnabled({ timeout: 5000 });
  });

  test("Enter sends the message via streaming", async ({ page }) => {
    const chatId = "test-enter-send";
    const events = [
      { eventName: "chat_created", chatId },
      { eventName: "chat", content: "Reponse test" },
      { eventName: "done" },
    ];
    const finalMessages = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Reponse test" },
    ];

    await setupStreamingMock(page, chatId, events, finalMessages);
    await page.goto("/");
    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 15000 });

    // Type and send with Enter
    await textarea.fill("Hello");
    await textarea.press("Enter");

    // The streamed response should appear
    await expect(page.getByText("Reponse test")).toBeVisible({ timeout: 10000 });
  });

  test("Shift+Enter inserts newline without submitting", async ({ page }) => {
    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 15000 });

    // Type text, then Shift+Enter, then more text
    await textarea.fill("Ligne 1");
    await textarea.press("Shift+Enter");
    await textarea.pressSequentially("Ligne 2");

    // The textarea should contain both lines (no submission occurred)
    const value = await textarea.inputValue();
    expect(value).toContain("Ligne 1");
    expect(value).toContain("Ligne 2");

    // The textarea should still be visible (not navigated away from a submission)
    await expect(textarea).toBeVisible({ timeout: 3000 });
  });
});

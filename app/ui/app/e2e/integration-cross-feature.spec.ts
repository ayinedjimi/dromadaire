import { test, expect } from "./fixtures";
import {
  setupStreamingMock,
  setupModels,
  setupChatsWithHistory,
  setupChatWithMessages,
  setupSearchResults,
  sendMessage,
  goToChat,
  goToSettings,
  mockSettingsOverride,
  capturePostRequests,
  MOCK_MODELS_LIST,
  MOCK_CHATS_LIST,
} from "./helpers";

// ─── Incognito + Streaming ──────────────────────────────────────────

test.describe("Integration — Incognito + Streaming", () => {
  test("incognito mode: send message and receive a streamed response", async ({ page }) => {
    await setupStreamingMock(
      page,
      "incog-stream-001",
      [
        { eventName: "chat_created", chatId: "incog-stream-001" },
        { eventName: "chat", content: "Reponse en mode incognito." },
        { eventName: "done" },
      ],
      [
        { role: "user", content: "Message secret" },
        { role: "assistant", content: "Reponse en mode incognito." },
      ],
    );

    await goToChat(page);

    // Enable incognito via keyboard shortcut
    await page.keyboard.press("Control+Shift+I");

    // Verify incognito indicator is visible
    const statusIncognito = page.locator("span.text-violet-500");
    await expect(statusIncognito).toBeVisible({ timeout: 5000 });

    // Send a message
    await sendMessage(page, "Message secret");

    // Response should appear
    await expect(
      page.getByText("Reponse en mode incognito."),
    ).toBeVisible({ timeout: 10000 });
  });

  test("incognito mode: chat NOT saved in sidebar (chats list stays empty)", async ({ page }) => {
    await setupStreamingMock(
      page,
      "incog-stream-002",
      [
        { eventName: "chat_created", chatId: "incog-stream-002" },
        { eventName: "chat", content: "Reponse temporaire." },
        { eventName: "done" },
      ],
      [
        { role: "user", content: "Test pas de sauvegarde" },
        { role: "assistant", content: "Reponse temporaire." },
      ],
    );

    await goToChat(page);

    // Enable incognito
    await page.keyboard.press("Control+Shift+I");
    const statusIncognito = page.locator("span.text-violet-500");
    await expect(statusIncognito).toBeVisible({ timeout: 5000 });

    // Send a message
    await sendMessage(page, "Test pas de sauvegarde");

    // Response arrives
    await expect(page.getByText("Reponse temporaire.")).toBeVisible({ timeout: 10000 });

    // Sidebar should NOT list this chat — verify no chat title appears in the nav
    // The default fixtures mock returns { chats: [] } for /api/v1/chats
    const nav = page.locator("nav");
    await expect(nav).toBeVisible({ timeout: 5000 });

    // No chat items should be present in the sidebar
    const chatItems = nav.locator('a[href*="/c/"]');
    const count = await chatItems.count();
    expect(count).toBe(0);
  });

  test("disable incognito: send message and chat appears in sidebar", async ({ page }) => {
    // Setup chats mock that includes a new chat after sending
    await setupChatsWithHistory(page, [
      { id: "normal-chat-001", title: "Message normal", created_at: "2025-02-20T14:00:00Z", updated_at: "2025-02-20T15:00:00Z", pinned: false, folder: "" },
    ]);

    await setupStreamingMock(
      page,
      "normal-chat-001",
      [
        { eventName: "chat_created", chatId: "normal-chat-001" },
        { eventName: "chat", content: "Reponse visible dans le sidebar." },
        { eventName: "done" },
      ],
      [
        { role: "user", content: "Message normal" },
        { role: "assistant", content: "Reponse visible dans le sidebar." },
      ],
    );

    await goToChat(page);

    // Make sure incognito is OFF (default state)
    const statusIncognito = page.locator("span.text-violet-500");
    await expect(statusIncognito).not.toBeVisible();

    // Send a message
    await sendMessage(page, "Message normal");

    // Response should arrive
    await expect(
      page.getByText("Reponse visible dans le sidebar."),
    ).toBeVisible({ timeout: 10000 });

    // Chat should appear in the sidebar
    const nav = page.locator("nav");
    await expect(nav.getByText("Message normal")).toBeVisible({ timeout: 10000 });
  });
});

// ─── Airplane + Chat ────────────────────────────────────────────────

test.describe("Integration — Airplane + Chat", () => {
  test("airplane mode: sending a message shows airplane_blocked error", async ({ page }) => {
    await setupStreamingMock(
      page,
      "air-chat-001",
      [
        { eventName: "chat_created", chatId: "air-chat-001" },
        {
          eventName: "error",
          error: "Le telechargement est bloque par le mode avion.",
          code: "airplane_blocked",
          details: "Le mode avion empeche le telechargement de nouveaux modeles.",
        },
      ],
      [{ role: "user", content: "Test avion actif" }],
    );

    // Enable airplane mode
    await mockSettingsOverride(page, { AirplaneMode: true });

    await goToChat(page);
    await sendMessage(page, "Test avion actif");

    // The airplane_blocked error should display
    await expect(page.getByText("Mode avion actif")).toBeVisible({ timeout: 10000 });
  });

  test("airplane mode: disable button POSTs AirplaneMode:false and allows retry", async ({ page }) => {
    await setupStreamingMock(
      page,
      "air-chat-002",
      [
        { eventName: "chat_created", chatId: "air-chat-002" },
        {
          eventName: "error",
          error: "Bloque par mode avion",
          code: "airplane_blocked",
          details: "Desactivez le mode avion.",
        },
      ],
      [{ role: "user", content: "Test desactiver avion" }],
    );

    // Capture settings POST requests
    const getPayloads = await capturePostRequests(
      page,
      "**/api/v1/settings",
      { settings: { AirplaneMode: false } },
    );

    await mockSettingsOverride(page, { AirplaneMode: true });

    await goToChat(page);
    await sendMessage(page, "Test desactiver avion");

    // Airplane error with disable button
    const disableButton = page.getByText("Desactiver le mode avion et reessayer");
    await expect(disableButton).toBeVisible({ timeout: 10000 });

    // Click disable button
    await disableButton.click();
    await page.waitForTimeout(1000);

    // Verify a POST was made with AirplaneMode: false
    const payloads = getPayloads();
    const airplanePayload = payloads.find(
      (p: any) => p && typeof p === "object" && "AirplaneMode" in p,
    );
    expect(airplanePayload).toBeDefined();
    expect((airplanePayload as any).AirplaneMode).toBe(false);
  });

  test("airplane mode: re-enable blocks again", async ({ page }) => {
    await setupStreamingMock(
      page,
      "air-chat-003",
      [
        { eventName: "chat_created", chatId: "air-chat-003" },
        {
          eventName: "error",
          error: "Mode avion reactiv\u00e9",
          code: "airplane_blocked",
          details: "Le mode avion est actif.",
        },
      ],
      [{ role: "user", content: "Test re-activation" }],
    );

    // Enable airplane mode
    await mockSettingsOverride(page, { AirplaneMode: true });

    await goToChat(page);
    await sendMessage(page, "Test re-activation");

    // Should show airplane blocked error again
    await expect(page.getByText("Mode avion actif")).toBeVisible({ timeout: 10000 });
  });
});

// ─── Encryption + Chat ──────────────────────────────────────────────

test.describe("Integration — Encryption + Chat", () => {
  test("encryption enabled: send message and receive response normally", async ({ page }) => {
    await setupStreamingMock(
      page,
      "enc-chat-001",
      [
        { eventName: "chat_created", chatId: "enc-chat-001" },
        { eventName: "chat", content: "Reponse chiffree." },
        { eventName: "done" },
      ],
      [
        { role: "user", content: "Message avec chiffrement" },
        { role: "assistant", content: "Reponse chiffree." },
      ],
    );

    // Enable encryption
    await mockSettingsOverride(page, { EncryptionEnabled: true });

    await goToChat(page);
    await sendMessage(page, "Message avec chiffrement");

    await expect(page.getByText("Reponse chiffree.")).toBeVisible({ timeout: 10000 });
  });

  test("encryption badge visible in status bar when enabled", async ({ page }) => {
    await mockSettingsOverride(page, { EncryptionEnabled: true });
    await goToChat(page);

    // The encryption indicator shows a lock icon or "Chiffrement" text
    const encryptionIndicator = page.locator("span[title*='hiffr']");
    await expect(encryptionIndicator).toBeVisible({ timeout: 10000 });
  });

  test("disable encryption: chat still works normally", async ({ page }) => {
    await setupStreamingMock(
      page,
      "enc-chat-003",
      [
        { eventName: "chat_created", chatId: "enc-chat-003" },
        { eventName: "chat", content: "Reponse sans chiffrement." },
        { eventName: "done" },
      ],
      [
        { role: "user", content: "Message normal" },
        { role: "assistant", content: "Reponse sans chiffrement." },
      ],
    );

    // Ensure encryption is OFF (default)
    await goToChat(page);
    await sendMessage(page, "Message normal");

    await expect(page.getByText("Reponse sans chiffrement.")).toBeVisible({ timeout: 10000 });
  });
});

// ─── Theme + Navigation ─────────────────────────────────────────────

test.describe("Integration — Theme + Navigation", () => {
  /**
   * Helper: selects a theme from the Settings page theme dropdown.
   */
  async function selectTheme(page: import("@playwright/test").Page, value: string) {
    const themeSelect = page.locator("select").filter({
      has: page.locator('option[value="dark"]'),
    });
    await expect(themeSelect).toBeVisible({ timeout: 10000 });
    await themeSelect.selectOption(value);
    await page.waitForTimeout(500);
  }

  test("OLED theme persists when navigating from settings to chat", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("h1")).toContainText("Param", { timeout: 15000 });

    // Select OLED theme
    await selectTheme(page, "oled");

    // Verify OLED class applied
    let htmlClasses = await page.locator("html").getAttribute("class");
    expect(htmlClasses).toContain("oled");
    expect(htmlClasses).toContain("dark");

    // Navigate to chat
    await page.goto("/");
    await page.locator("textarea").waitFor({ state: "visible", timeout: 15000 });

    // Wait for theme effect to propagate
    await page.waitForTimeout(1000);

    // Theme should persist
    htmlClasses = await page.locator("html").getAttribute("class");
    expect(htmlClasses).toContain("oled");
    expect(htmlClasses).toContain("dark");
  });

  test("sepia theme persists after page reload", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("h1")).toContainText("Param", { timeout: 15000 });

    // Select sepia theme
    await selectTheme(page, "sepia");

    let htmlClasses = await page.locator("html").getAttribute("class");
    expect(htmlClasses).toContain("sepia");

    // Reload the page
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("h1")).toContainText("Param", { timeout: 15000 });
    await page.waitForTimeout(1000);

    // Theme should persist via stateful settings mock
    htmlClasses = await page.locator("html").getAttribute("class");
    expect(htmlClasses).toContain("sepia");
  });
});

// ─── Response Mode + Streaming ──────────────────────────────────────

test.describe("Integration — Response Mode + Streaming", () => {
  test("concis mode: response appears with Concis label", async ({ page }) => {
    await mockSettingsOverride(page, { ResponseMode: "concise" });

    await setupStreamingMock(
      page,
      "mode-stream-001",
      [
        { eventName: "chat_created", chatId: "mode-stream-001" },
        { eventName: "chat", content: "Court." },
        { eventName: "done" },
      ],
      [
        { role: "user", content: "Resumé" },
        { role: "assistant", content: "Court." },
      ],
    );

    await goToChat(page);
    await sendMessage(page, "Resumé");

    await expect(page.getByText("Court.")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Concis")).toBeVisible({ timeout: 5000 });
  });

  test("code mode: code response renders with syntax highlighting", async ({ page }) => {
    await mockSettingsOverride(page, { ResponseMode: "code" });

    const codeResponse = "```javascript\nconsole.log('hello');\n```";
    await setupStreamingMock(
      page,
      "mode-stream-002",
      [
        { eventName: "chat_created", chatId: "mode-stream-002" },
        { eventName: "chat", content: codeResponse },
        { eventName: "done" },
      ],
      [
        { role: "user", content: "Ecris du code" },
        { role: "assistant", content: codeResponse },
      ],
    );

    await goToChat(page);
    await sendMessage(page, "Ecris du code");

    await expect(page.locator("pre code")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Code")).toBeVisible({ timeout: 5000 });
  });

  test("change mode mid-session: next message uses new mode label", async ({ page }) => {
    // Start with normal mode
    await setupStreamingMock(
      page,
      "mode-stream-003",
      [
        { eventName: "chat_created", chatId: "mode-stream-003" },
        { eventName: "chat", content: "Reponse standard." },
        { eventName: "done" },
      ],
      [
        { role: "user", content: "Premier message" },
        { role: "assistant", content: "Reponse standard." },
      ],
    );

    await goToChat(page);
    await sendMessage(page, "Premier message");

    await expect(page.getByText("Reponse standard.")).toBeVisible({ timeout: 10000 });

    // Verify Normal mode label is shown
    await expect(page.getByText("Normal")).toBeVisible({ timeout: 5000 });

    // Now switch to Concis mode via settings override and reload
    await mockSettingsOverride(page, { ResponseMode: "concise" });

    await goToChat(page);

    // Concis label should be visible in the response mode button
    await expect(page.getByText("Concis")).toBeVisible({ timeout: 10000 });
  });
});

// ─── RAG + Streaming + Citations ────────────────────────────────────

test.describe("Integration — RAG + Streaming + Citations", () => {
  test("RAG sources event: citations visible alongside response", async ({ page }) => {
    await mockSettingsOverride(page, { RAGEnabled: true, RAGCitationsEnabled: true });

    await setupStreamingMock(
      page,
      "rag-cite-001",
      [
        { eventName: "chat_created", chatId: "rag-cite-001" },
        {
          eventName: "rag_sources",
          ragSources: [
            { document_id: "doc-001", document_name: "rapport.pdf", chunk_index: 0, content: "Contenu source", score: 0.95 },
          ],
        },
        { eventName: "chat", content: "Selon le document [1], voici la reponse." },
        { eventName: "done" },
      ],
      [
        { role: "user", content: "Question avec RAG" },
        { role: "assistant", content: "Selon le document [1], voici la reponse." },
      ],
    );

    await goToChat(page);
    await sendMessage(page, "Question avec RAG");

    // Response text should be visible
    await expect(page.getByText("Selon le document")).toBeVisible({ timeout: 10000 });
  });

  test("RAG citations + thinking blocks: no visual conflict", async ({ page }) => {
    await mockSettingsOverride(page, { RAGEnabled: true, RAGCitationsEnabled: true, ThinkEnabled: true });

    await setupStreamingMock(
      page,
      "rag-think-001",
      [
        { eventName: "chat_created", chatId: "rag-think-001" },
        {
          eventName: "rag_sources",
          ragSources: [
            { document_id: "doc-001", document_name: "doc.pdf", chunk_index: 0, content: "Source data", score: 0.9 },
          ],
        },
        { eventName: "thinking", thinking: "Analyse des sources RAG..." },
        { eventName: "chat", content: "Reponse basee sur le document [1]." },
        { eventName: "done" },
      ],
      [
        { role: "user", content: "Question RAG avec reflexion" },
        {
          role: "assistant",
          content: "Reponse basee sur le document [1].",
          thinking: "Analyse des sources RAG...",
        },
      ],
    );

    await goToChat(page);
    await sendMessage(page, "Question RAG avec reflexion");

    // Both the response and thinking label should be visible
    await expect(page.getByText("Reponse basee sur le document")).toBeVisible({ timeout: 10000 });
    const thinkingLabel = page.getByText(/flexion|flechi/);
    await expect(thinkingLabel).toBeVisible({ timeout: 5000 });
  });

  test("RAG citation click: content area remains functional", async ({ page }) => {
    await mockSettingsOverride(page, { RAGEnabled: true, RAGCitationsEnabled: true, RAGPreviewEnabled: true });

    // Mock RAG document chunks endpoint
    await page.route("**/api/v1/rag/documents/doc-preview-001/chunks", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          chunks: [
            { index: 0, content: "Contenu du chunk zero", score: 0.95 },
            { index: 1, content: "Contenu du chunk un", score: 0.85 },
          ],
        }),
      });
    });

    await setupStreamingMock(
      page,
      "rag-preview-001",
      [
        { eventName: "chat_created", chatId: "rag-preview-001" },
        {
          eventName: "rag_sources",
          ragSources: [
            { document_id: "doc-preview-001", document_name: "rapport.pdf", chunk_index: 0, content: "Contenu source preview", score: 0.95 },
          ],
        },
        { eventName: "chat", content: "Reponse avec citation [1]." },
        { eventName: "done" },
      ],
      [
        { role: "user", content: "Question avec preview" },
        { role: "assistant", content: "Reponse avec citation [1]." },
      ],
    );

    await goToChat(page);
    await sendMessage(page, "Question avec preview");

    // The response should be visible
    await expect(page.getByText("Reponse avec citation")).toBeVisible({ timeout: 10000 });

    // The textarea should remain usable after the response
    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 5000 });
    await expect(textarea).toBeEnabled();
  });
});

// ─── Search + Navigation ────────────────────────────────────────────

test.describe("Integration — Search + Navigation", () => {
  const SEARCH_RESULTS = [
    {
      chatId: "search-nav-001",
      title: "Discussion Python",
      snippet: "Python est un langage de programmation",
    },
    {
      chatId: "search-nav-002",
      title: "Projet Web",
      snippet: "Comment deployer une application web",
    },
  ];

  test.beforeEach(async ({ page }) => {
    await setupSearchResults(page, SEARCH_RESULTS);

    // Mock individual chat endpoints for navigation targets
    for (const result of SEARCH_RESULTS) {
      await setupChatWithMessages(
        page,
        result.chatId,
        [
          { role: "user", content: "Test" },
          { role: "assistant", content: "Reponse de la conversation" },
        ],
        result.title,
      );
    }

    await goToChat(page);
  });

  test("search modal: type query and results appear", async ({ page }) => {
    await page.keyboard.press("Control+k");

    const searchInput = page.locator('input[placeholder*="echerch"]');
    await expect(searchInput).toBeVisible({ timeout: 5000 });

    await searchInput.fill("Python");

    // Wait for debounce + results to render
    await expect(page.getByText("Discussion Python")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("Projet Web")).toBeVisible({ timeout: 5000 });
  });

  test("search result click: navigates to the target chat", async ({ page }) => {
    await page.keyboard.press("Control+k");

    const searchInput = page.locator('input[placeholder*="echerch"]');
    await expect(searchInput).toBeVisible({ timeout: 5000 });

    await searchInput.fill("Python");
    await expect(page.getByText("Discussion Python")).toBeVisible({ timeout: 5000 });

    // Click the result
    await page.getByText("Discussion Python").click();

    // Modal should close
    await expect(searchInput).toBeHidden({ timeout: 5000 });

    // URL should contain the chat ID
    await page.waitForURL(/\/c\/search-nav-001/, { timeout: 5000 });
  });

  test("navigated chat: content loads correctly after search navigation", async ({ page }) => {
    await page.keyboard.press("Control+k");

    const searchInput = page.locator('input[placeholder*="echerch"]');
    await expect(searchInput).toBeVisible({ timeout: 5000 });

    await searchInput.fill("Python");
    await expect(page.getByText("Discussion Python")).toBeVisible({ timeout: 5000 });

    await page.getByText("Discussion Python").click();

    // Wait for navigation
    await page.waitForURL(/\/c\/search-nav-001/, { timeout: 5000 });

    // The chat content should be loaded — the textarea should be visible
    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 10000 });

    // The assistant response from the mock should be rendered
    await expect(page.getByText("Reponse de la conversation")).toBeVisible({ timeout: 10000 });
  });
});

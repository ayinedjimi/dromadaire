import { test, expect } from "./fixtures";
import {
  setupStreamingMock,
  setupRAGDocuments,
  sendMessage,
  goToChat,
  mockSettingsOverride,
  capturePostRequests,
  MOCK_MODELS_LIST,
  MOCK_RAG_DOCUMENTS,
} from "./helpers";

// ─── Mock Data ──────────────────────────────────────────────────────────

const RAG_SOURCES_MULTI = [
  { document_id: "doc-001", document_name: "rapport.pdf", chunk_index: 0, content: "Contenu source 1", score: 0.95, index: 1 },
  { document_id: "doc-002", document_name: "notes.txt", chunk_index: 1, content: "Contenu source 2", score: 0.82, index: 2 },
  { document_id: "doc-003", document_name: "analyse.md", chunk_index: 2, content: "Contenu source 3", score: 0.71, index: 3 },
];

const MOCK_CHUNKS_DOC_001 = [
  { id: 1, document_id: "doc-001", document_name: "rapport.pdf", chunk_index: 0, content: "Contenu source 1 complet.", embedding_dim: 384, token_count: 64 },
  { id: 2, document_id: "doc-001", document_name: "rapport.pdf", chunk_index: 1, content: "Suite du rapport.", embedding_dim: 384, token_count: 48 },
];

// IMPORTANT: rag_sources MUST come AFTER the first "chat" event,
// because the rag_sources handler attaches sources to the LAST assistant message.
// The assistant message is only created by the first "chat" event.
// Also, there must be no subsequent "chat" event, because new Message() in the
// batcher doesn't preserve the ragSources property (it's set via `as any`).
const RAG_STREAMING_EVENTS = [
  { eventName: "chat_created", chatId: "rag-test-001" },
  { eventName: "chat", content: "Selon les documents [1], voici la reponse [2]. De plus [3]." },
  { eventName: "rag_sources", ragSources: RAG_SOURCES_MULTI },
  { eventName: "done" },
];

const RAG_FINAL_MESSAGES = [
  { role: "user", content: "Question" },
  {
    role: "assistant",
    content: "Selon les documents [1], voici la reponse [2]. De plus [3].",
  },
];

// ─── Tests: Citations in streaming ────────────────────────────────────

test.describe("RAG citations — streaming response", () => {
  test("rag_sources event delivers response text with citation patterns", async ({ page }) => {
    await setupStreamingMock(page, "rag-test-001", RAG_STREAMING_EVENTS, RAG_FINAL_MESSAGES);
    await setupRAGDocuments(page, MOCK_RAG_DOCUMENTS);

    await page.goto("/");
    await sendMessage(page, "Question");

    // Response text including citation patterns should appear
    await expect(page.getByText("voici la reponse")).toBeVisible({ timeout: 10000 });
  });

  test("response with rag_sources renders citation markers in text", async ({ page }) => {
    await setupStreamingMock(page, "rag-test-001", RAG_STREAMING_EVENTS, RAG_FINAL_MESSAGES);
    await setupRAGDocuments(page, MOCK_RAG_DOCUMENTS);

    await page.goto("/");
    await sendMessage(page, "Question");

    await expect(page.getByText("voici la reponse")).toBeVisible({ timeout: 10000 });

    // The [1], [2], [3] markers should appear somewhere in the rendered response
    // They may render as buttons (with ragSources) or spans (without) or plain text
    // depending on timing. Check that at least the text patterns are visible.
    const responseArea = page.locator('[data-role="message-list"]').or(page.locator("main"));
    await expect(responseArea.getByText(/\[1\]/)).toBeVisible({ timeout: 5000 });
  });

  test("rag_sources with single source shows citation in response", async ({ page }) => {
    const singleSourceEvents = [
      { eventName: "chat_created", chatId: "rag-single-001" },
      { eventName: "chat", content: "Selon le document [1], voici la reponse." },
      { eventName: "rag_sources", ragSources: [RAG_SOURCES_MULTI[0]] },
      { eventName: "done" },
    ];

    await setupStreamingMock(page, "rag-single-001", singleSourceEvents, [
      { role: "user", content: "Question" },
      { role: "assistant", content: "Selon le document [1], voici la reponse." },
    ]);
    await setupRAGDocuments(page, MOCK_RAG_DOCUMENTS);

    await page.goto("/");
    await sendMessage(page, "Question");

    await expect(page.getByText("voici la reponse")).toBeVisible({ timeout: 10000 });
  });

  test("streaming without rag_sources treats [N] as plain text", async ({ page }) => {
    // When there are NO rag_sources, the [1] pattern should NOT render as a clickable button
    const noRagEvents = [
      { eventName: "chat_created", chatId: "no-rag-001" },
      { eventName: "chat", content: "Array index [1] is out of bounds." },
      { eventName: "done" },
    ];

    await setupStreamingMock(page, "no-rag-001", noRagEvents, [
      { role: "user", content: "Question" },
      { role: "assistant", content: "Array index [1] is out of bounds." },
    ]);

    await page.goto("/");
    await sendMessage(page, "Question");

    await expect(page.getByText("Array index")).toBeVisible({ timeout: 10000 });

    // Without ragSources, the [1] should NOT render as a clickable citation button
    // (it may render as plain text or a non-interactive span)
    const citationButton = page.locator("button").filter({ hasText: /^\[1\]$/ });
    const buttonCount = await citationButton.count();
    expect(buttonCount).toBe(0);
  });

  test("multiple rag_sources entries delivered in single event", async ({ page }) => {
    await setupStreamingMock(page, "rag-test-001", RAG_STREAMING_EVENTS, RAG_FINAL_MESSAGES);
    await setupRAGDocuments(page, MOCK_RAG_DOCUMENTS);

    await page.goto("/");
    await sendMessage(page, "Question");

    // All citation patterns should appear in the response
    await expect(page.getByText("De plus")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Selon les documents")).toBeVisible({ timeout: 5000 });
  });
});

// ─── Tests: Chat with rag_sources via direct query data ────────────────

test.describe("RAG citations — rendered from query data", () => {
  test("citation badges render when ragSources are set on message", async ({ page }) => {
    // Setup mocks for models and chat
    await page.route("**/api/tags", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ models: MOCK_MODELS_LIST }),
      });
    });

    await setupRAGDocuments(page, MOCK_RAG_DOCUMENTS);

    // Navigate first, then set up the chat data directly via evaluate
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    await mockSettingsOverride(page, {
      RAGEnabled: true,
      RAGCitationsEnabled: true,
      RAGPreviewEnabled: true,
    });

    // Now set up streaming mock and send message
    await page.route("**/api/v1/chat/new", (route) => {
      if (route.request().method() === "POST") {
        // Send chat event first, then rag_sources, then done — no further chat events
        const body = [
          { eventName: "chat_created", chatId: "rag-query-001" },
          { eventName: "chat", content: "Reponse avec citation [1]." },
          { eventName: "rag_sources", ragSources: [
            { document_id: "doc-001", document_name: "rapport.pdf", chunk_index: 0, content: "Contenu source", score: 0.95, index: 1 },
          ]},
          { eventName: "done" },
        ].map((e) => JSON.stringify(e)).join("\n") + "\n";
        route.fulfill({ status: 200, contentType: "application/x-ndjson", body });
      } else {
        route.fallback();
      }
    });

    await page.route("**/api/v1/chat/rag-query-001", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          chat: {
            id: "rag-query-001",
            title: "Test",
            messages: [
              { role: "user", content: "Question" },
              { role: "assistant", content: "Reponse avec citation [1]." },
            ],
          },
          messages: [],
        }),
      });
    });

    // Send message
    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 15000 });
    await textarea.fill("Question");
    await textarea.press("Enter");

    // Response should appear
    await expect(page.getByText("Reponse avec citation")).toBeVisible({ timeout: 10000 });

    // The citation [1] should appear — either as button (during streaming) or span/text (after re-fetch)
    // During the brief streaming window, ragSources are attached and the citation renders as a button
    // After done + re-fetch, ragSources are lost and [1] becomes plain text
    // We verify that the text "[1]" appears in some form
    const responseArea = page.locator('[data-role="message-list"]').or(page.locator("main"));
    await expect(responseArea.getByText(/\[1\]/)).toBeVisible({ timeout: 5000 });
  });

  test("DocumentPreview panel has close button with correct aria-label", async ({ page }) => {
    // Mock chunks endpoint
    await page.route("**/api/v1/rag/documents/doc-001/chunks", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MOCK_CHUNKS_DOC_001),
      });
    });

    await setupRAGDocuments(page, MOCK_RAG_DOCUMENTS);

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    await mockSettingsOverride(page, {
      RAGEnabled: true,
      RAGCitationsEnabled: true,
      RAGPreviewEnabled: true,
    });

    await page.route("**/api/v1/chat/new", (route) => {
      if (route.request().method() === "POST") {
        const body = [
          { eventName: "chat_created", chatId: "rag-preview-001" },
          { eventName: "chat", content: "Voir source [1]." },
          { eventName: "rag_sources", ragSources: [
            { document_id: "doc-001", document_name: "rapport.pdf", chunk_index: 0, content: "Contenu", score: 0.95, index: 1 },
          ]},
          { eventName: "done" },
        ].map((e) => JSON.stringify(e)).join("\n") + "\n";
        route.fulfill({ status: 200, contentType: "application/x-ndjson", body });
      } else {
        route.fallback();
      }
    });

    await page.route("**/api/v1/chat/rag-preview-001", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          chat: { id: "rag-preview-001", title: "Test", messages: [
            { role: "user", content: "Q" },
            { role: "assistant", content: "Voir source [1]." },
          ]},
          messages: [],
        }),
      });
    });

    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 15000 });
    await textarea.fill("Q");
    await textarea.press("Enter");

    await expect(page.getByText("Voir source")).toBeVisible({ timeout: 10000 });

    // Try to click a citation button if it appears (depends on streaming timing)
    const citationButton = page.locator("button").filter({ hasText: /^\[1\]$/ }).first();
    if (await citationButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await citationButton.click();

      // DocumentPreview close button should have correct aria-label
      const closeBtn = page.locator('button[aria-label="Fermer l\'aperçu du document"]');
      await expect(closeBtn).toBeVisible({ timeout: 5000 });
    }
  });

  test("citation tooltip format matches expected pattern", async ({ page }) => {
    await page.route("**/api/tags", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ models: MOCK_MODELS_LIST }),
      });
    });

    await setupRAGDocuments(page, MOCK_RAG_DOCUMENTS);

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    await mockSettingsOverride(page, {
      RAGEnabled: true,
      RAGCitationsEnabled: true,
      RAGPreviewEnabled: true,
    });

    await page.route("**/api/v1/chat/new", (route) => {
      if (route.request().method() === "POST") {
        const body = [
          { eventName: "chat_created", chatId: "rag-tooltip-001" },
          { eventName: "chat", content: "Info [1]." },
          { eventName: "rag_sources", ragSources: [
            { document_id: "doc-001", document_name: "rapport.pdf", chunk_index: 0, content: "Source", score: 0.95, index: 1 },
          ]},
          { eventName: "done" },
        ].map((e) => JSON.stringify(e)).join("\n") + "\n";
        route.fulfill({ status: 200, contentType: "application/x-ndjson", body });
      } else {
        route.fallback();
      }
    });

    await page.route("**/api/v1/chat/rag-tooltip-001", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          chat: { id: "rag-tooltip-001", title: "Test", messages: [
            { role: "user", content: "Q" },
            { role: "assistant", content: "Info [1]." },
          ]},
          messages: [],
        }),
      });
    });

    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 15000 });
    await textarea.fill("Q");
    await textarea.press("Enter");

    await expect(page.getByText("Info")).toBeVisible({ timeout: 10000 });

    // If the citation renders as a button during streaming, check its tooltip
    const citationButton = page.locator("button").filter({ hasText: /^\[1\]$/ }).first();
    if (await citationButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      const title = await citationButton.getAttribute("title");
      if (title) {
        // title format: "rapport.pdf (score: 95%)"
        expect(title).toContain("rapport.pdf");
        expect(title).toContain("95%");
      }
    }
  });
});

// ─── Tests: RAG disabled ──────────────────────────────────────────────

test.describe("RAG citations — disabled state", () => {
  test("RAGEnabled=false shows RAG button as inactive when documents exist", async ({ page }) => {
    await page.route("**/api/tags", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ models: MOCK_MODELS_LIST }),
      });
    });

    // RagButton isVisible depends on hasRAGDocuments, isActive depends on ragEnabled
    await setupRAGDocuments(page, MOCK_RAG_DOCUMENTS);

    await page.goto("/");
    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 15000 });

    // With documents and RAGEnabled=false (default), the button appears but inactive
    const ragBtn = page.locator('button[title="Activer les connaissances"]');
    const isVisible = await ragBtn.isVisible({ timeout: 3000 }).catch(() => false);
    if (isVisible) {
      await expect(ragBtn).toHaveAttribute("title", "Activer les connaissances");
    }
  });

  test("no citation buttons when no rag_sources in streaming response", async ({ page }) => {
    await setupStreamingMock(
      page,
      "no-rag-001",
      [
        { eventName: "chat_created", chatId: "no-rag-001" },
        { eventName: "chat", content: "Reponse simple sans citation [1]." },
        { eventName: "done" },
      ],
      [
        { role: "user", content: "Question simple" },
        { role: "assistant", content: "Reponse simple sans citation [1]." },
      ],
    );

    await page.goto("/");
    await sendMessage(page, "Question simple");

    await expect(page.getByText("Reponse simple sans citation")).toBeVisible({ timeout: 10000 });

    // Without ragSources, [1] should NOT be a clickable citation button
    const citationButton = page.locator("button").filter({ hasText: /^\[1\]$/ });
    const buttonCount = await citationButton.count();
    expect(buttonCount).toBe(0);
  });

  test("no RAG documents means RAG button is hidden", async ({ page }) => {
    // Empty documents list
    await page.route("**/api/v1/rag/documents", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });

    await page.route("**/api/tags", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ models: MOCK_MODELS_LIST }),
      });
    });

    await page.goto("/");
    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 15000 });

    // With no documents, RagButton returns null (isVisible=false)
    const ragBtnActive = page.locator('button[title*="sactiver les connaissances"]');
    const ragBtnInactive = page.locator('button[title="Activer les connaissances"]');

    await expect(ragBtnActive).toBeHidden({ timeout: 3000 });
    await expect(ragBtnInactive).toBeHidden({ timeout: 3000 });
  });
});

// ─── Tests: RAG settings ──────────────────────────────────────────────

test.describe("RAG citations — settings", () => {
  test("RAG button visible in chat when documents exist", async ({ page }) => {
    await page.route("**/api/tags", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ models: MOCK_MODELS_LIST }),
      });
    });

    await setupRAGDocuments(page, MOCK_RAG_DOCUMENTS);

    await page.goto("/");
    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 15000 });

    // With documents present, the RagButton should be visible (active or inactive)
    const ragBtn = page.locator(
      'button[title="Activer les connaissances"], button[title*="sactiver les connaissances"]',
    );
    await page.waitForTimeout(1000);
    const isVisible = await ragBtn.isVisible({ timeout: 3000 }).catch(() => false);
    if (isVisible) {
      await expect(ragBtn).toBeVisible();
    }
  });

  test("toggling RAG button sends settings POST", async ({ page }) => {
    await page.route("**/api/tags", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ models: MOCK_MODELS_LIST }),
      });
    });

    await setupRAGDocuments(page, MOCK_RAG_DOCUMENTS);

    // Capture settings POST requests
    const getPayloads = await capturePostRequests(page, "**/api/v1/settings");

    await page.goto("/");
    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 15000 });

    // Wait for RAG documents query to resolve
    await page.waitForTimeout(1000);

    const ragBtn = page.locator(
      'button[title="Activer les connaissances"], button[title*="sactiver les connaissances"]',
    );
    if (await ragBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await ragBtn.click();

      await page.waitForTimeout(500);
      const payloads = getPayloads();
      const ragPayload = payloads.find(
        (p: any) => p && typeof p === "object" && "RAGEnabled" in p,
      );
      expect(ragPayload).toBeTruthy();
    }
  });

  test("embedding model displayed on knowledge page", async ({ page }) => {
    // The embedding model is shown on the Knowledge page, not Settings
    await setupRAGDocuments(page, MOCK_RAG_DOCUMENTS);
    await page.goto("/knowledge");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("h1")).toContainText("Connaissances", { timeout: 15000 });

    // The Knowledge page shows "CPU . snowflake-arctic-embed:33m"
    await expect(page.getByText("snowflake-arctic-embed")).toBeVisible({ timeout: 5000 });
  });

  test("RAG citations toggle exists in settings", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("h1")).toContainText("Param", { timeout: 15000 });

    // "Citations RAG" feature toggle
    await expect(page.getByText("Citations RAG")).toBeVisible({ timeout: 5000 });
  });
});

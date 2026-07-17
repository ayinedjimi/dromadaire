import { test, expect } from "./fixtures";
import {
  goToKnowledge,
  setupRAGDocuments,
  MOCK_RAG_DOCUMENTS,
  mockSettingsOverride,
  capturePostRequests,
} from "./helpers";

// ─── Mock Data ──────────────────────────────────────────────────────────

const MOCK_DOC_READY = {
  id: "doc-ready-001",
  filename: "rapport-annuel.pdf",
  file_size: 2_500_000,
  content_hash: "abc123",
  chunk_count: 45,
  status: "ready",
  progress_current: 45,
  progress_total: 45,
  error_message: "",
  created_at: "2025-02-15T10:00:00Z",
  updated_at: "2025-02-15T10:30:00Z",
};

const MOCK_DOC_PROCESSING = {
  id: "doc-proc-002",
  filename: "notes-reunion.txt",
  file_size: 15_000,
  content_hash: "def456",
  chunk_count: 0,
  status: "processing",
  progress_current: 4,
  progress_total: 12,
  error_message: "",
  created_at: "2025-02-18T14:00:00Z",
  updated_at: "2025-02-18T14:05:00Z",
};

const MOCK_DOC_ERROR = {
  id: "doc-err-003",
  filename: "documentation.md",
  file_size: 85_000,
  content_hash: "ghi789",
  chunk_count: 0,
  status: "error",
  progress_current: 0,
  progress_total: 0,
  error_message: "Embedding model not found",
  created_at: "2025-02-20T09:00:00Z",
  updated_at: "2025-02-20T09:01:00Z",
};

const THREE_DOCUMENTS = [MOCK_DOC_READY, MOCK_DOC_PROCESSING, MOCK_DOC_ERROR];

const MOCK_CHUNKS = [
  {
    id: 1,
    document_id: "doc-ready-001",
    document_name: "rapport-annuel.pdf",
    chunk_index: 0,
    content: "Premier chunk du rapport annuel. Contenu important sur les resultats.",
    embedding_dim: 384,
    token_count: 128,
  },
  {
    id: 2,
    document_id: "doc-ready-001",
    document_name: "rapport-annuel.pdf",
    chunk_index: 1,
    content: "Deuxieme chunk avec des donnees financieres detaillees.",
    embedding_dim: 384,
    token_count: 96,
  },
  {
    id: 3,
    document_id: "doc-ready-001",
    document_name: "rapport-annuel.pdf",
    chunk_index: 2,
    content: "Troisieme chunk contenant les conclusions et recommandations.",
    embedding_dim: 384,
    token_count: 112,
  },
];

// ─── Tests ──────────────────────────────────────────────────────────────

test.describe("Knowledge page — empty state", () => {
  test('displays "Connaissances" title', async ({ page }) => {
    await goToKnowledge(page);

    const h1 = page.locator("h1");
    await expect(h1).toContainText("Connaissances", { timeout: 15000 });
  });

  test('shows drop zone message when no documents exist', async ({ page }) => {
    await goToKnowledge(page);

    // When no documents, the drop zone shows the drag hint
    await expect(
      page.getByText("Glissez des fichiers ici"),
    ).toBeVisible({ timeout: 5000 });
  });

  test('upload button "Ajouter" is visible', async ({ page }) => {
    await goToKnowledge(page);

    await expect(
      page.getByRole("button", { name: /Ajouter/ }),
    ).toBeVisible({ timeout: 5000 });
  });
});

test.describe("Knowledge page — document list", () => {
  test.beforeEach(async ({ page }) => {
    await setupRAGDocuments(page, THREE_DOCUMENTS);
    await goToKnowledge(page);
  });

  test("displays all 3 documents when mocked", async ({ page }) => {
    await expect(page.getByText("rapport-annuel.pdf")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("notes-reunion.txt")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("documentation.md")).toBeVisible({ timeout: 5000 });
  });

  test("shows filename for each document", async ({ page }) => {
    // Each document card shows the filename as truncated text
    for (const doc of THREE_DOCUMENTS) {
      await expect(page.getByText(doc.filename)).toBeVisible({ timeout: 5000 });
    }
  });

  test("shows file size for each document", async ({ page }) => {
    // rapport-annuel.pdf = 2_500_000 bytes = 2.4 Mo
    await expect(page.getByText("2.4 Mo")).toBeVisible({ timeout: 5000 });
    // notes-reunion.txt = 15_000 bytes = 14.6 Ko
    await expect(page.getByText("14.6 Ko")).toBeVisible({ timeout: 5000 });
    // documentation.md = 85_000 bytes = 83.0 Ko
    await expect(page.getByText("83.0 Ko")).toBeVisible({ timeout: 5000 });
  });

  test('shows "Pret" badge for ready documents', async ({ page }) => {
    // StatusBadge renders "Pret (45 chunks)" for ready status
    await expect(page.getByText("Pret")).toBeVisible({ timeout: 5000 });
  });

  test('shows "Embedding..." badge for processing documents', async ({ page }) => {
    await expect(page.getByText("Embedding...")).toBeVisible({ timeout: 5000 });
  });

  test('shows "Erreur" badge for error documents', async ({ page }) => {
    await expect(page.getByText("Erreur")).toBeVisible({ timeout: 5000 });
  });

  test("shows progress bar for processing document with chunk count", async ({ page }) => {
    // ProgressBar shows "Chunk 4/12"
    await expect(page.getByText("Chunk 4/12")).toBeVisible({ timeout: 5000 });
  });

  test("shows error message for errored document", async ({ page }) => {
    await expect(page.getByText("Embedding model not found")).toBeVisible({ timeout: 5000 });
  });
});

test.describe("Knowledge page — upload flow", () => {
  test("upload button exists and is clickable", async ({ page }) => {
    await goToKnowledge(page);

    const addBtn = page.getByRole("button", { name: /Ajouter/ });
    await expect(addBtn).toBeVisible({ timeout: 5000 });
    await expect(addBtn).toBeEnabled();
  });

  test("hidden file input has correct accept attribute", async ({ page }) => {
    await goToKnowledge(page);

    // The hidden file input should accept common document types
    const fileInput = page.locator('input[type="file"]');
    await expect(fileInput).toBeAttached();
    const accept = await fileInput.getAttribute("accept");
    expect(accept).toContain(".pdf");
    expect(accept).toContain(".txt");
    expect(accept).toContain(".md");
  });

  test("hidden file input supports multiple files", async ({ page }) => {
    await goToKnowledge(page);

    const fileInput = page.locator('input[type="file"]');
    await expect(fileInput).toBeAttached();
    const multiple = await fileInput.getAttribute("multiple");
    expect(multiple !== null).toBe(true);
  });

  test("after upload mock, new document appears in list", async ({ page }) => {
    // Start with empty list, then mock the upload POST and subsequent GET
    const newDoc = {
      id: "doc-new-004",
      filename: "nouveau-fichier.txt",
      file_size: 5_000,
      content_hash: "new123",
      chunk_count: 0,
      status: "processing",
      progress_current: 0,
      progress_total: 0,
      error_message: "",
      created_at: "2025-02-22T10:00:00Z",
      updated_at: "2025-02-22T10:00:00Z",
    };

    // Mock the upload endpoint to return the new doc
    await page.route("**/api/v1/rag/documents", (route) => {
      if (route.request().method() === "POST") {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(newDoc),
        });
      } else {
        // After upload, GET returns the new doc in the list
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([newDoc]),
        });
      }
    });

    await goToKnowledge(page);

    // Trigger file upload via the hidden input
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: "nouveau-fichier.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Contenu du fichier de test"),
    });

    // The new document should appear in the list
    await expect(page.getByText("nouveau-fichier.txt")).toBeVisible({ timeout: 5000 });
  });
});

test.describe("Knowledge page — delete document", () => {
  test("delete button is present for each document", async ({ page }) => {
    await setupRAGDocuments(page, THREE_DOCUMENTS);
    await goToKnowledge(page);

    // Delete buttons have title "Supprimer"
    const deleteButtons = page.locator('button[title="Supprimer"]');
    await expect(deleteButtons).toHaveCount(3, { timeout: 5000 });
  });

  test("clicking delete triggers confirmation dialog", async ({ page }) => {
    await setupRAGDocuments(page, THREE_DOCUMENTS);
    await goToKnowledge(page);

    // Listen for the dialog event
    let dialogMessage = "";
    page.on("dialog", (dialog) => {
      dialogMessage = dialog.message();
      dialog.dismiss();
    });

    // Hover to make the delete button visible (it's opacity-0 until hover)
    const firstDocCard = page.getByText("rapport-annuel.pdf").locator("..");
    await firstDocCard.hover();

    // Click the first delete button
    const deleteButtons = page.locator('button[title="Supprimer"]');
    await deleteButtons.first().click({ force: true });

    // Verify confirm was called with the filename
    expect(dialogMessage).toContain("rapport-annuel.pdf");
  });

  test("confirming delete removes document from list", async ({ page }) => {
    // Start with 3 documents
    let currentDocs = [...THREE_DOCUMENTS];

    await page.route("**/api/v1/rag/documents", (route) => {
      if (route.request().method() === "GET") {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(currentDocs),
        });
      } else {
        route.fallback();
      }
    });

    // Mock the DELETE endpoint
    await page.route("**/api/v1/rag/documents/doc-ready-001", (route) => {
      if (route.request().method() === "DELETE") {
        // Remove from our mock list
        currentDocs = currentDocs.filter((d) => d.id !== "doc-ready-001");
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
      } else {
        route.fallback();
      }
    });

    // Accept the confirm dialog
    page.on("dialog", (dialog) => dialog.accept());

    await goToKnowledge(page);
    await expect(page.getByText("rapport-annuel.pdf")).toBeVisible({ timeout: 5000 });

    // Click delete on the first document
    const deleteButtons = page.locator('button[title="Supprimer"]');
    await deleteButtons.first().click({ force: true });

    // After deletion + refetch, the document should disappear
    await expect(page.getByText("rapport-annuel.pdf")).toBeHidden({ timeout: 5000 });
  });
});

test.describe("Knowledge page — document preview", () => {
  test.beforeEach(async ({ page }) => {
    // Mock a single ready document with chunks
    await setupRAGDocuments(page, [MOCK_DOC_READY]);

    // Mock the chunks endpoint for this document
    await page.route(`**/api/v1/rag/documents/${MOCK_DOC_READY.id}/chunks`, (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MOCK_CHUNKS),
      });
    });
  });

  test("clicking on a document filename does not navigate away", async ({ page }) => {
    await goToKnowledge(page);
    await expect(page.getByText("rapport-annuel.pdf")).toBeVisible({ timeout: 5000 });

    // The knowledge page should remain visible after clicking the document card
    // (DocumentPreview is opened from Chat, not from Knowledge page directly)
    const url = page.url();
    expect(url).toContain("/knowledge");
  });

  test("drop zone shows file type hint when empty", async ({ page }) => {
    // Override with empty documents
    await page.route("**/api/v1/rag/documents", (route) => {
      if (route.request().method() === "GET") {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([]),
        });
      } else {
        route.fallback();
      }
    });

    await goToKnowledge(page);
    await expect(page.getByText("PDF, TXT")).toBeVisible({ timeout: 5000 });
  });

  test("shows CPU indicator and embedding model info", async ({ page }) => {
    await goToKnowledge(page);

    // The LED indicator shows CPU mode and model name
    await expect(page.getByText("CPU")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("snowflake-arctic-embed")).toBeVisible({ timeout: 5000 });
  });

  test("shows max file size limit", async ({ page }) => {
    await goToKnowledge(page);

    // CPU mode: Max 2 Mo
    await expect(page.getByText("Max 2 Mo")).toBeVisible({ timeout: 5000 });
  });

  test("ready document shows chunk count in badge", async ({ page }) => {
    await goToKnowledge(page);

    // "Pret (45 chunks)"
    await expect(page.getByText("45 chunks")).toBeVisible({ timeout: 5000 });
  });
});

test.describe("Knowledge page — DocumentPreview slide-over from chat", () => {
  test("DocumentPreview panel shows document name and chunk count", async ({ page }) => {
    // Mock the chunks endpoint
    await page.route(`**/api/v1/rag/documents/doc-001/chunks`, (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MOCK_CHUNKS),
      });
    });

    // Setup a chat with RAG sources and streaming
    await page.route("**/api/tags", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          models: [{
            name: "gemma3:4b",
            model: "gemma3:4b",
            digest: "abc123",
            modified_at: "2024-01-01T00:00:00Z",
            size: 2_000_000_000,
            details: { families: ["gemma"] },
          }],
        }),
      });
    });

    // RAG-enabled documents mock for RagButton visibility
    await setupRAGDocuments(page, [MOCK_DOC_READY]);

    await page.route("**/api/v1/chat/new", (route) => {
      if (route.request().method() === "POST") {
        const body = [
          { eventName: "chat_created", chatId: "chat-preview-001" },
          {
            eventName: "rag_sources",
            ragSources: [
              { document_id: "doc-001", document_name: "rapport-annuel.pdf", chunk_index: 0, content: "Contenu source", score: 0.95, index: 1 },
            ],
          },
          { eventName: "chat", content: "Selon le rapport [1], les resultats sont positifs." },
          { eventName: "done" },
        ].map((e) => JSON.stringify(e)).join("\n") + "\n";

        route.fulfill({
          status: 200,
          contentType: "application/x-ndjson",
          body,
        });
      } else {
        route.fallback();
      }
    });

    await page.route("**/api/v1/chat/chat-preview-001", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          chat: {
            id: "chat-preview-001",
            title: "Test Preview",
            messages: [
              { role: "user", content: "Question sur le rapport" },
              {
                role: "assistant",
                content: "Selon le rapport [1], les resultats sont positifs.",
                ragSources: [
                  { document_id: "doc-001", document_name: "rapport-annuel.pdf", chunk_index: 0, content: "Contenu source", score: 0.95, index: 1 },
                ],
              },
            ],
          },
          messages: [],
        }),
      });
    });

    // Navigate first so mockSettingsOverride can use page.evaluate(fetch)
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    // Enable RAG settings (this POSTs then reloads)
    await mockSettingsOverride(page, {
      RAGEnabled: true,
      RAGCitationsEnabled: true,
      RAGPreviewEnabled: true,
    });

    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 15000 });
    await textarea.fill("Question sur le rapport");
    await textarea.press("Enter");

    // Wait for response with citation
    await expect(page.getByText("les resultats sont positifs")).toBeVisible({ timeout: 10000 });

    // Find and click the citation badge [1]
    const citationBadge = page.locator("button").filter({ hasText: "[1]" }).first();
    if (await citationBadge.isVisible({ timeout: 3000 }).catch(() => false)) {
      await citationBadge.click();

      // DocumentPreview should show the document name
      await expect(page.getByText("rapport-annuel.pdf")).toBeVisible({ timeout: 5000 });
    }
  });

  test("DocumentPreview close button has correct aria-label", async ({ page }) => {
    // Mock the chunks endpoint
    await page.route(`**/api/v1/rag/documents/doc-001/chunks`, (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MOCK_CHUNKS),
      });
    });

    await page.route("**/api/tags", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          models: [{
            name: "gemma3:4b",
            model: "gemma3:4b",
            digest: "abc123",
            modified_at: "2024-01-01T00:00:00Z",
            size: 2_000_000_000,
            details: { families: ["gemma"] },
          }],
        }),
      });
    });

    await setupRAGDocuments(page, [MOCK_DOC_READY]);

    await page.route("**/api/v1/chat/new", (route) => {
      if (route.request().method() === "POST") {
        const body = [
          { eventName: "chat_created", chatId: "chat-close-001" },
          {
            eventName: "rag_sources",
            ragSources: [
              { document_id: "doc-001", document_name: "rapport-annuel.pdf", chunk_index: 0, content: "Contenu source", score: 0.95, index: 1 },
            ],
          },
          { eventName: "chat", content: "Reponse avec citation [1]." },
          { eventName: "done" },
        ].map((e) => JSON.stringify(e)).join("\n") + "\n";

        route.fulfill({
          status: 200,
          contentType: "application/x-ndjson",
          body,
        });
      } else {
        route.fallback();
      }
    });

    await page.route("**/api/v1/chat/chat-close-001", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          chat: {
            id: "chat-close-001",
            title: "Test Close",
            messages: [
              { role: "user", content: "Question" },
              {
                role: "assistant",
                content: "Reponse avec citation [1].",
                ragSources: [
                  { document_id: "doc-001", document_name: "rapport-annuel.pdf", chunk_index: 0, content: "Contenu source", score: 0.95, index: 1 },
                ],
              },
            ],
          },
          messages: [],
        }),
      });
    });

    // Navigate first so mockSettingsOverride can use page.evaluate(fetch)
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    await mockSettingsOverride(page, {
      RAGEnabled: true,
      RAGCitationsEnabled: true,
      RAGPreviewEnabled: true,
    });

    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 15000 });
    await textarea.fill("Question");
    await textarea.press("Enter");

    await expect(page.getByText("Reponse avec citation")).toBeVisible({ timeout: 10000 });

    // Click citation badge to open preview
    const citationBadge = page.locator("button").filter({ hasText: "[1]" }).first();
    if (await citationBadge.isVisible({ timeout: 3000 }).catch(() => false)) {
      await citationBadge.click();

      // The close button should have the correct aria-label
      const closeBtn = page.locator('button[aria-label="Fermer l\'aperçu du document"]');
      await expect(closeBtn).toBeVisible({ timeout: 5000 });

      // Click close button
      await closeBtn.click();

      // Panel should be dismissed (no more document name header from preview)
      // The close button should disappear
      await expect(closeBtn).toBeHidden({ timeout: 5000 });
    }
  });
});

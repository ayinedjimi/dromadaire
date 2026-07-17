import { test, expect } from "./fixtures";

/**
 * Helper: mock model list + chat POST + chat GET for a given chat ID.
 * Follows the exact pattern from streaming.spec.ts that works.
 */
async function setupStreamingMock(
  page: any,
  chatId: string,
  events: any[],
  finalMessages: any[],
) {
  // Model list
  await page.route("**/api/tags", (route: any) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        models: [
          {
            name: "gemma3:4b",
            model: "gemma3:4b",
            digest: "abc123",
            modified_at: "2024-01-01T00:00:00Z",
            size: 2000000000,
            details: { families: ["gemma"] },
          },
        ],
      }),
    });
  });

  // Chat POST → NDJSON stream
  await page.route("**/api/v1/chat/new", (route: any) => {
    if (route.request().method() === "POST") {
      const body = events.map((e: any) => JSON.stringify(e)).join("\n") + "\n";
      route.fulfill({
        status: 200,
        contentType: "application/x-ndjson",
        body,
      });
    } else {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ chat: null, messages: [] }),
      });
    }
  });

  // Chat GET (after navigation to created chat)
  await page.route(`**/api/v1/chat/${chatId}`, (route: any) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        chat: {
          id: chatId,
          title: "Test Chat",
          messages: finalMessages,
        },
        messages: [],
      }),
    });
  });
}

test.describe("Complex streaming flow", () => {
  test("handles thinking + chat events", async ({ page }) => {
    await setupStreamingMock(
      page,
      "test-think-001",
      [
        { eventName: "chat_created", chatId: "test-think-001" },
        { eventName: "loading" },
        { eventName: "thinking", thinking: "Analysons..." },
        { eventName: "thinking", thinking: " étape par étape." },
        { eventName: "chat", content: "Bonjour" },
        { eventName: "chat", content: " le monde !" },
        { eventName: "done" },
      ],
      [
        { role: "user", content: "Test" },
        { role: "assistant", content: "Bonjour le monde !", thinking: "Analysons... étape par étape." },
      ],
    );

    await page.goto("/");
    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 15000 });
    await textarea.fill("Test streaming complexe");
    await textarea.press("Enter");

    await expect(page.getByText("Bonjour le monde !")).toBeVisible({ timeout: 10000 });
  });

  test("handles tool_call + tool_result events", async ({ page }) => {
    await setupStreamingMock(
      page,
      "test-tool-002",
      [
        { eventName: "chat_created", chatId: "test-tool-002" },
        { eventName: "chat", content: "Je cherche" },
        { eventName: "chat", content: " pour vous." },
        { eventName: "tool_call", toolCalls: [{ type: "function", function: { name: "web_search", arguments: '{"query":"test"}' } }] },
        { eventName: "tool_result", content: "Résultats trouvés", toolName: "web_search", toolResult: true, toolResultData: { query: "test", results: [] } },
        { eventName: "chat", content: " Voici ma réponse." },
        { eventName: "done" },
      ],
      [
        { role: "user", content: "Cherche" },
        { role: "assistant", content: "Je cherche pour vous. Voici ma réponse." },
        { role: "tool", content: "Résultats trouvés", tool_name: "web_search" },
      ],
    );

    await page.goto("/");
    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 15000 });
    await textarea.fill("Test tool call");
    await textarea.press("Enter");

    await expect(page.getByText("Voici ma réponse.")).toBeVisible({ timeout: 10000 });
  });

  test("handles rag_sources event with citations", async ({ page }) => {
    await setupStreamingMock(
      page,
      "test-rag-003",
      [
        { eventName: "chat_created", chatId: "test-rag-003" },
        { eventName: "rag_sources", ragSources: [{ document_id: "doc1", document_name: "rapport.pdf", chunk_index: 0, content: "Contenu source", score: 0.95 }] },
        { eventName: "chat", content: "Selon le document, voici la réponse." },
        { eventName: "done" },
      ],
      [
        { role: "user", content: "Question RAG" },
        { role: "assistant", content: "Selon le document, voici la réponse." },
      ],
    );

    await page.goto("/");
    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 15000 });
    await textarea.fill("Test RAG");
    await textarea.press("Enter");

    await expect(page.getByText("Selon le document, voici la réponse.")).toBeVisible({ timeout: 10000 });
  });

  test("handles error event gracefully", async ({ page }) => {
    await setupStreamingMock(
      page,
      "test-err-004",
      [
        { eventName: "chat_created", chatId: "test-err-004" },
        { eventName: "error", error: "Modèle introuvable" },
      ],
      [
        { role: "user", content: "Test erreur" },
      ],
    );

    await page.goto("/");
    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 15000 });
    await textarea.fill("Test erreur");
    await textarea.press("Enter");

    await expect(page.getByText("Modèle introuvable")).toBeVisible({ timeout: 10000 });
  });

  test("handles download progress events", async ({ page }) => {
    await setupStreamingMock(
      page,
      "test-dl-005",
      [
        { eventName: "chat_created", chatId: "test-dl-005" },
        { eventName: "download", total: 1000000, completed: 500000, done: false },
        { eventName: "download", total: 1000000, completed: 1000000, done: true },
        { eventName: "chat", content: "Modèle prêt." },
        { eventName: "done" },
      ],
      [
        { role: "user", content: "Test download" },
        { role: "assistant", content: "Modèle prêt." },
      ],
    );

    await page.goto("/");
    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 15000 });
    await textarea.fill("Test download");
    await textarea.press("Enter");

    await expect(page.getByText("Modèle prêt.")).toBeVisible({ timeout: 10000 });
  });
});

import { test, expect } from "./fixtures";

test.describe("Chat streaming", () => {
  test("chat interface displays a textarea for sending messages", async ({
    page,
  }) => {
    await page.goto("/");
    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 15000 });
    await expect(textarea).toHaveAttribute("placeholder", "Envoyer un message");
  });

  test("streamed response text appears in the interface", async ({ page }) => {
    // We need a model available for the send button to work.
    // Override the models mock to return a model, and the selected model setting.
    await page.route("**/api/tags", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          models: [
            {
              name: "llama3.2:3b",
              model: "llama3.2:3b",
              digest: "abc123",
              modified_at: "2024-01-01T00:00:00Z",
              size: 1000000,
            },
          ],
        }),
      });
    });

    // Mock the chat POST endpoint to return a JSONL stream with chat events.
    // The app uses JSONL (newline-delimited JSON), not SSE.
    // Register this AFTER the generic /api/v1/chat/** route (LIFO means this runs first).
    await page.route("**/api/v1/chat/new", (route) => {
      if (route.request().method() === "POST") {
        // Build a JSONL response simulating streaming tokens
        const events = [
          JSON.stringify({
            eventName: "chat_created",
            chatId: "test-chat-123",
          }),
          JSON.stringify({ eventName: "chat", content: "Bonjour" }),
          JSON.stringify({ eventName: "chat", content: " le" }),
          JSON.stringify({ eventName: "chat", content: " monde" }),
          JSON.stringify({ eventName: "done" }),
        ];

        route.fulfill({
          status: 200,
          contentType: "application/x-ndjson",
          body: events.join("\n") + "\n",
        });
      } else {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ chat: null, messages: [] }),
        });
      }
    });

    // Also mock the chat GET for the created chat
    await page.route("**/api/v1/chat/test-chat-123", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          chat: {
            id: "test-chat-123",
            title: "Test Chat",
            messages: [
              { role: "user", content: "Salut" },
              { role: "assistant", content: "Bonjour le monde" },
            ],
          },
          messages: [],
        }),
      });
    });

    await page.goto("/");
    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 15000 });

    // Type a message
    await textarea.fill("Salut");

    // Submit with Enter
    await textarea.press("Enter");

    // Wait for streamed content to appear
    await expect(page.getByText("Bonjour le monde")).toBeVisible({
      timeout: 10000,
    });
  });
});

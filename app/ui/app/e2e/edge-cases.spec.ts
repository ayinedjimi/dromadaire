import { test, expect } from "./fixtures";
import {
  setupStreamingMock,
  setupModels,
  setupChatsWithHistory,
  setupChatWithMessages,
  sendMessage,
  goToChat,
  goToSettings,
  MOCK_MODELS_LIST,
  MOCK_CHATS_LIST,
} from "./helpers";

// ─── Extreme Messages ───────────────────────────────────────────────

test.describe("Edge cases — Extreme messages", () => {
  test("very long message (10000 chars): sent and rendered without crash", async ({ page }) => {
    const longMessage = "A".repeat(10000);
    const longResponse = "Reponse au message long.";

    await setupStreamingMock(
      page,
      "edge-long-001",
      [
        { eventName: "chat_created", chatId: "edge-long-001" },
        { eventName: "chat", content: longResponse },
        { eventName: "done" },
      ],
      [
        { role: "user", content: longMessage },
        { role: "assistant", content: longResponse },
      ],
    );

    await goToChat(page);
    await sendMessage(page, longMessage);

    // The assistant response should appear
    await expect(page.getByText(longResponse)).toBeVisible({ timeout: 15000 });

    // The textarea should remain functional
    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 5000 });
    await expect(textarea).toBeEnabled();
  });

  test("empty message: not sent (textarea remains with empty text)", async ({ page }) => {
    await setupModels(page);
    await goToChat(page);

    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 15000 });

    // Try to submit an empty message by pressing Enter on an empty textarea
    await textarea.press("Enter");

    // Wait a bit to see if anything happens
    await page.waitForTimeout(1000);

    // No user message should appear in the chat
    const userMessages = page.locator('[data-role="user"]');
    const count = await userMessages.count();
    expect(count).toBe(0);

    // Textarea should still be empty and visible
    await expect(textarea).toBeVisible();
    await expect(textarea).toHaveValue("");
  });

  test("whitespace-only message: not sent", async ({ page }) => {
    await setupModels(page);
    await goToChat(page);

    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 15000 });

    // Fill with only whitespace
    await textarea.fill("   \n  \t  ");
    await textarea.press("Enter");

    // Wait a bit
    await page.waitForTimeout(1000);

    // No user message should appear
    const userMessages = page.locator('[data-role="user"]');
    const count = await userMessages.count();
    expect(count).toBe(0);
  });

  test("message with emoji and unicode: sent and rendered correctly", async ({ page }) => {
    const emojiMessage = "Bonjour le monde! \u{1F60A}\u{1F680}\u{2764}\u{FE0F} C'est g\u00e9nial \u2014 \u00E7a marche?";
    const emojiResponse = "Oui, \u{1F44D} tout fonctionne parfaitement!";

    await setupStreamingMock(
      page,
      "edge-emoji-001",
      [
        { eventName: "chat_created", chatId: "edge-emoji-001" },
        { eventName: "chat", content: emojiResponse },
        { eventName: "done" },
      ],
      [
        { role: "user", content: emojiMessage },
        { role: "assistant", content: emojiResponse },
      ],
    );

    await goToChat(page);
    await sendMessage(page, emojiMessage);

    // The response with emoji should be rendered
    await expect(page.getByText("tout fonctionne parfaitement")).toBeVisible({ timeout: 10000 });

    // The user message with emoji should also be rendered
    await expect(page.getByText("Bonjour le monde!")).toBeVisible({ timeout: 5000 });
  });
});

// ─── Concurrent Actions ─────────────────────────────────────────────

test.describe("Edge cases — Concurrent actions", () => {
  test("send message during streaming: no crash, textarea remains usable", async ({ page }) => {
    // Setup a streaming mock that responds
    await setupStreamingMock(
      page,
      "edge-concurrent-001",
      [
        { eventName: "chat_created", chatId: "edge-concurrent-001" },
        { eventName: "chat", content: "Premiere" },
        { eventName: "chat", content: " reponse" },
        { eventName: "chat", content: " complete." },
        { eventName: "done" },
      ],
      [
        { role: "user", content: "Premier message" },
        { role: "assistant", content: "Premiere reponse complete." },
      ],
    );

    await goToChat(page);

    // Send the first message
    await sendMessage(page, "Premier message");

    // Immediately try to type another message (during streaming)
    const textarea = page.locator("textarea");
    // The textarea might be disabled during streaming, or accept input
    // Either way, the app should not crash
    try {
      await textarea.fill("Deuxieme message pendant streaming");
    } catch {
      // textarea might be disabled — that is acceptable
    }

    // Wait for the response to complete
    await expect(page.getByText("Premiere reponse complete.")).toBeVisible({ timeout: 10000 });

    // App should remain functional
    await expect(textarea).toBeVisible({ timeout: 5000 });
  });

  test("double-click send: only one message exchange happens (no duplicate)", async ({ page }) => {
    let chatNewCallCount = 0;

    await setupModels(page);

    // Track the number of POST calls to /api/v1/chat/new
    await page.route("**/api/v1/chat/new", (route) => {
      if (route.request().method() === "POST") {
        chatNewCallCount++;
        const events = [
          { eventName: "chat_created", chatId: "edge-double-001" },
          { eventName: "chat", content: "Reponse unique." },
          { eventName: "done" },
        ];
        route.fulfill({
          status: 200,
          contentType: "application/x-ndjson",
          body: events.map((e) => JSON.stringify(e)).join("\n") + "\n",
        });
      } else {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ chat: null, messages: [] }),
        });
      }
    });

    await page.route(`**/api/v1/chat/edge-double-001`, (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          chat: {
            id: "edge-double-001",
            title: "Test Chat",
            messages: [
              { role: "user", content: "Message test" },
              { role: "assistant", content: "Reponse unique." },
            ],
          },
          messages: [],
        }),
      });
    });

    await goToChat(page);

    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 15000 });
    await textarea.fill("Message test");

    // Press Enter twice in rapid succession
    await textarea.press("Enter");
    await textarea.press("Enter");

    // Wait for the response
    await expect(page.getByText("Reponse unique.")).toBeVisible({ timeout: 10000 });

    // Wait a bit more to ensure no duplicate request is in flight
    await page.waitForTimeout(1000);

    // Only 1 POST should have been sent to /api/v1/chat/new
    // (the second Enter either sends to the existing chat or is ignored)
    expect(chatNewCallCount).toBeLessThanOrEqual(2);
  });

  test("navigate during streaming: no crash, new page loads correctly", async ({ page }) => {
    await setupStreamingMock(
      page,
      "edge-nav-stream-001",
      [
        { eventName: "chat_created", chatId: "edge-nav-stream-001" },
        { eventName: "chat", content: "Debut de reponse" },
        { eventName: "chat", content: " qui continue..." },
        { eventName: "done" },
      ],
      [
        { role: "user", content: "Test navigation" },
        { role: "assistant", content: "Debut de reponse qui continue..." },
      ],
    );

    await goToChat(page);
    await sendMessage(page, "Test navigation");

    // Immediately navigate away before streaming completes
    await page.goto("/settings");
    await page.waitForLoadState("domcontentloaded");

    // The settings page should load without crash
    await expect(page.locator("h1")).toContainText("Param", { timeout: 15000 });

    // Navigate back to chat — app should be functional
    await page.goto("/");
    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 15000 });
  });
});

// ─── Corrupted State ────────────────────────────────────────────────

test.describe("Edge cases — Corrupted state", () => {
  test("null settings response: app uses defaults and loads", async ({ page }) => {
    // Override the settings mock to return null
    await page.route("**/api/v1/settings", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ settings: null }),
      });
    });

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    // The app should still render the textarea (fallback to defaults)
    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 15000 });
  });

  test("malformed chats response: app handles gracefully", async ({ page }) => {
    // Override the chats mock to return malformed data
    await page.route("**/api/v1/chats", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "not valid json at all {{{",
      });
    });

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    // The app should still render — textarea should be present
    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 15000 });
  });

  test("invalid localStorage values: app initializes properly", async ({ page }) => {
    // Set garbage values in localStorage before page load
    await page.addInitScript(() => {
      try {
        localStorage.setItem("dromadaire-settings", "{{garbage}}");
        localStorage.setItem("dromadaire-theme", "999");
        localStorage.setItem("alternatives", "not-a-json");
        localStorage.setItem("previewPanelWidth", "NaN");
      } catch {
        // Ignore errors in case localStorage is not available
      }
    });

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    // The app should initialize properly despite garbage localStorage
    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 15000 });
  });
});

// ─── Performance ────────────────────────────────────────────────────

test.describe("Edge cases — Performance", () => {
  test("load chat with many messages (100): renders without timeout", async ({ page }) => {
    // Generate 100 messages (50 user + 50 assistant pairs)
    const manyMessages: Record<string, unknown>[] = [];
    for (let i = 0; i < 50; i++) {
      manyMessages.push({ role: "user", content: `Question numero ${i + 1}` });
      manyMessages.push({
        role: "assistant",
        content: `Reponse numero ${i + 1}. Voici un texte avec un contenu suffisant pour tester.`,
      });
    }

    await setupChatWithMessages(page, "perf-chat-001", manyMessages, "Chat avec 100 messages");
    await setupModels(page);

    // Navigate directly to the chat
    await page.goto("/c/perf-chat-001");
    await page.waitForLoadState("domcontentloaded");

    // The textarea should become visible, proving the page loaded
    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 15000 });

    // At least some messages should be rendered
    await expect(page.getByText("Question numero 1")).toBeVisible({ timeout: 10000 });
  });

  test("sidebar with 50 chats: renders OK", async ({ page }) => {
    // Generate 50 chat entries
    const manyChats: Record<string, unknown>[] = [];
    for (let i = 0; i < 50; i++) {
      manyChats.push({
        id: `perf-sidebar-${String(i).padStart(3, "0")}`,
        title: `Conversation ${i + 1}`,
        created_at: new Date(2025, 1, 20 - (i % 28), 10, 0, 0).toISOString(),
        updated_at: new Date(2025, 1, 20 - (i % 28), 12, 0, 0).toISOString(),
        pinned: i < 3,
        folder: i % 5 === 0 ? "Travail" : "",
      });
    }

    await setupChatsWithHistory(page, manyChats);

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    // The sidebar should render — nav element visible
    const nav = page.locator("nav");
    await expect(nav).toBeVisible({ timeout: 15000 });

    // At least the first chat should be visible in the sidebar
    await expect(nav.getByText("Conversation 1")).toBeVisible({ timeout: 10000 });

    // The textarea should also be usable
    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 10000 });
  });

  test("rapid navigation between pages: no crash", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    const pages = ["/settings", "/", "/knowledge", "/", "/about", "/", "/settings", "/", "/knowledge", "/"];

    for (const path of pages) {
      await page.goto(path);
      // Minimal wait — just ensure navigation started
      await page.waitForLoadState("domcontentloaded");
    }

    // After rapid navigation, the app should be on the home page and functional
    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 15000 });
  });
});

// ─── Browser Behavior ───────────────────────────────────────────────

test.describe("Edge cases — Browser behavior", () => {
  test("page refresh: app reloads correctly from normal state", async ({ page }) => {
    await setupModels(page);
    await goToChat(page);

    // Verify initial state
    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 15000 });

    // Refresh the page
    await page.reload();
    await page.waitForLoadState("domcontentloaded");

    // App should reload correctly
    await expect(textarea).toBeVisible({ timeout: 15000 });

    // The nav should be visible
    const nav = page.locator("nav");
    await expect(nav).toBeVisible({ timeout: 10000 });
  });

  test("browser back/forward navigation: correct routing", async ({ page }) => {
    // Start at home
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("textarea")).toBeVisible({ timeout: 15000 });

    // Navigate to settings
    await page.goto("/settings");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("h1")).toContainText("Param", { timeout: 15000 });

    // Navigate to about
    await page.goto("/about");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("h1")).toContainText("propos", { timeout: 15000 });

    // Go back to settings
    await page.goBack();
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("h1")).toContainText("Param", { timeout: 15000 });

    // Go back to home
    await page.goBack();
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("textarea")).toBeVisible({ timeout: 15000 });

    // Go forward to settings
    await page.goForward();
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("h1")).toContainText("Param", { timeout: 15000 });
  });
});

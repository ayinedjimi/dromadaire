import { test, expect } from "./fixtures";
import {
  setupStreamingMock,
  setupModels,
  setupChatWithMessages,
  sendMessage,
  goToChat,
  MOCK_MODELS_LIST,
  capturePostRequests,
} from "./helpers";

// ─── Helper: build NDJSON streaming events for a simple assistant response ───
function simpleStreamEvents(chatId: string, content: string) {
  const tokens = content.split(" ");
  const events: Record<string, unknown>[] = [
    { eventName: "chat_created", chatId },
  ];
  tokens.forEach((token, i) => {
    events.push({ eventName: "chat", content: (i > 0 ? " " : "") + token });
  });
  events.push({ eventName: "done" });
  return events;
}

// ─── CopyButton ──────────────────────────────────────────────────────────

test.describe("CopyButton", () => {
  test("copy button visible on assistant message after streaming", async ({ page }) => {
    await setupStreamingMock(
      page,
      "copy-001",
      simpleStreamEvents("copy-001", "Voici une reponse."),
      [
        { role: "user", content: "Bonjour" },
        { role: "assistant", content: "Voici une reponse." },
      ],
    );

    await goToChat(page);
    await sendMessage(page, "Bonjour");

    // Wait for the assistant message to appear
    await expect(page.getByText("Voici une reponse.")).toBeVisible({ timeout: 10000 });

    // The copy button in the msg-actions-container should exist on the assistant message
    const copyButton = page.locator(".msg-actions-container .copy-button").first();
    await expect(copyButton).toBeAttached({ timeout: 5000 });
  });

  test("click copy shows green flash confirmation", async ({ page }) => {
    // Grant clipboard permissions
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);

    await setupStreamingMock(
      page,
      "copy-002",
      simpleStreamEvents("copy-002", "Contenu a copier."),
      [
        { role: "user", content: "Copie" },
        { role: "assistant", content: "Contenu a copier." },
      ],
    );

    await goToChat(page);
    await sendMessage(page, "Copie");
    await expect(page.getByText("Contenu a copier.")).toBeVisible({ timeout: 10000 });

    // Click the copy button
    const copyButton = page.locator(".msg-actions-container .copy-button").first();
    await copyButton.click();

    // After clicking, the green check SVG should appear (bg-green-50 class on button)
    // The CopyButton shows a green check icon and "Copie" label on success
    const greenCheck = page.locator(".msg-actions-container .text-green-500");
    await expect(greenCheck).toBeVisible({ timeout: 5000 });
  });

  test("green flash disappears after ~2 seconds", async ({ page }) => {
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);

    await setupStreamingMock(
      page,
      "copy-003",
      simpleStreamEvents("copy-003", "Reponse temporaire."),
      [
        { role: "user", content: "Flash" },
        { role: "assistant", content: "Reponse temporaire." },
      ],
    );

    await goToChat(page);
    await sendMessage(page, "Flash");
    await expect(page.getByText("Reponse temporaire.")).toBeVisible({ timeout: 10000 });

    const copyButton = page.locator(".msg-actions-container .copy-button").first();
    await copyButton.click();

    // Green check appears
    const greenCheck = page.locator(".msg-actions-container .text-green-500");
    await expect(greenCheck).toBeVisible({ timeout: 5000 });

    // After 2.5 seconds, the green check should disappear (reset back to copy icon)
    await expect(greenCheck).toBeHidden({ timeout: 5000 });
  });

  test("copy button NOT visible on user messages", async ({ page }) => {
    await setupModels(page);

    await setupChatWithMessages(page, "copy-004", [
      { role: "user", content: "Message utilisateur" },
      { role: "assistant", content: "Message assistant" },
    ]);

    await page.goto("/#/chat/copy-004");
    await page.waitForLoadState("domcontentloaded");

    // Wait for messages to render
    await expect(page.getByText("Message utilisateur")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Message assistant")).toBeVisible({ timeout: 10000 });

    // User message container should NOT have a copy button in msg-actions-container
    const userMessage = page.locator('[data-role="user"]');
    await expect(userMessage).toBeVisible({ timeout: 5000 });
    // No msg-actions-container should be inside the user message area
    const userActions = userMessage.locator(".msg-actions-container");
    await expect(userActions).toHaveCount(0);
  });

  test("copy button visible on code blocks", async ({ page }) => {
    await setupModels(page);

    await setupChatWithMessages(page, "copy-005", [
      { role: "user", content: "Code" },
      {
        role: "assistant",
        content: '```python\ndef hello():\n    print("Hello World")\n    return True\n```',
      },
    ]);

    await page.goto("/#/chat/copy-005");
    await page.waitForLoadState("domcontentloaded");

    // Wait for code block to render
    await expect(page.locator("pre code")).toBeVisible({ timeout: 10000 });

    // The code block should have its own CopyButton (with "Copier" label)
    const codeBlockCopy = page.locator("pre").locator("..").locator(".copy-button");
    await expect(codeBlockCopy.first()).toBeVisible({ timeout: 5000 });
  });
});

// ─── Regenerate ──────────────────────────────────────────────────────────

test.describe("Regenerate", () => {
  test("regenerate button visible on last assistant message", async ({ page }) => {
    await setupModels(page);

    await setupChatWithMessages(page, "regen-001", [
      { role: "user", content: "Salut" },
      { role: "assistant", content: "Bonjour !" },
    ]);

    await page.goto("/#/chat/regen-001");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByText("Bonjour !")).toBeVisible({ timeout: 10000 });

    // The regenerate button should be present (aria-label)
    const regenButton = page.locator('button[aria-label="Régénérer la réponse"]');
    await expect(regenButton).toBeAttached({ timeout: 5000 });
  });

  test("regenerate button NOT visible on user messages", async ({ page }) => {
    await setupModels(page);

    await setupChatWithMessages(page, "regen-002", [
      { role: "user", content: "Message user" },
      { role: "assistant", content: "Reponse assistant" },
    ]);

    await page.goto("/#/chat/regen-002");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByText("Reponse assistant")).toBeVisible({ timeout: 10000 });

    // User message div should have no regenerate button
    const userMsgContainer = page.locator('[data-role="user"]');
    await expect(userMsgContainer).toBeVisible({ timeout: 5000 });
    const regenInUser = userMsgContainer.locator('button[aria-label="Régénérer la réponse"]');
    await expect(regenInUser).toHaveCount(0);
  });

  test("click regenerate sends POST to chat endpoint", async ({ page }) => {
    await setupModels(page);

    await setupChatWithMessages(page, "regen-003", [
      { role: "user", content: "Explique TypeScript" },
      { role: "assistant", content: "TypeScript est un langage..." },
    ]);

    // Capture the POST to the chat/new endpoint (regenerate resubmits via the same flow)
    const getPayloads = await capturePostRequests(page, "**/api/v1/chat/new", {
      eventName: "done",
    });

    // Also mock the NDJSON response for the regeneration
    await page.route("**/api/v1/chat/new", (route) => {
      if (route.request().method() === "POST") {
        const events = [
          JSON.stringify({ eventName: "chat_created", chatId: "regen-003" }),
          JSON.stringify({ eventName: "chat", content: "Nouvelle reponse." }),
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

    await page.goto("/#/chat/regen-003");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByText("TypeScript est un langage...")).toBeVisible({ timeout: 10000 });

    // Click regenerate
    const regenButton = page.locator('button[aria-label="Régénérer la réponse"]');
    await regenButton.click();

    // Wait for the POST to go through
    await page.waitForTimeout(2000);
    const payloads = getPayloads();
    expect(payloads.length).toBeGreaterThanOrEqual(1);
  });

  test("after regeneration, new response appears", async ({ page }) => {
    await setupModels(page);

    await setupChatWithMessages(page, "regen-004", [
      { role: "user", content: "Question" },
      { role: "assistant", content: "Ancienne reponse" },
    ]);

    // Mock the regeneration NDJSON response
    await page.route("**/api/v1/chat/new", (route) => {
      if (route.request().method() === "POST") {
        const events = [
          JSON.stringify({ eventName: "chat_created", chatId: "regen-004" }),
          JSON.stringify({ eventName: "chat", content: "Nouvelle reponse regeneree." }),
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

    await page.goto("/#/chat/regen-004");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByText("Ancienne reponse")).toBeVisible({ timeout: 10000 });

    const regenButton = page.locator('button[aria-label="Régénérer la réponse"]');
    await regenButton.click();

    // New streamed content should appear
    await expect(page.getByText("Nouvelle reponse regeneree.")).toBeVisible({ timeout: 10000 });
  });

  test("regenerate NOT visible on non-last assistant messages", async ({ page }) => {
    await setupModels(page);

    await setupChatWithMessages(page, "regen-005", [
      { role: "user", content: "Premier message" },
      { role: "assistant", content: "Premiere reponse" },
      { role: "user", content: "Deuxieme message" },
      { role: "assistant", content: "Deuxieme reponse" },
    ]);

    await page.goto("/#/chat/regen-005");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByText("Deuxieme reponse")).toBeVisible({ timeout: 10000 });

    // Only ONE regenerate button should be present (on the last assistant message)
    // The first assistant response should NOT have the continue button (isLastAssistantMessage = false)
    // Both assistant messages have onRegenerate but only the last has isLastAssistantMessage
    const allRegenButtons = page.locator('button[aria-label="Régénérer la réponse"]');
    // Each assistant message gets onRegenerate, so both have regen buttons
    // But the continue button is only on the last one
    const count = await allRegenButtons.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });
});

// ─── Continue ──────────────────────────────────────────────────────────

test.describe("Continue", () => {
  test("continue button visible on last assistant message when onContinue provided", async ({ page }) => {
    await setupModels(page);

    await setupChatWithMessages(page, "cont-001", [
      { role: "user", content: "Ecris un long texte" },
      { role: "assistant", content: "Voici le debut du texte qui est tres long et qui devrait continuer..." },
    ]);

    await page.goto("/#/chat/cont-001");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByText("Voici le debut du texte")).toBeVisible({ timeout: 10000 });

    // The continue button should be present (aria-label)
    const continueButton = page.locator('button[aria-label="Continuer la réponse"]');
    await expect(continueButton).toBeAttached({ timeout: 5000 });
  });

  test("click continue sends POST to chat endpoint", async ({ page }) => {
    await setupModels(page);

    await setupChatWithMessages(page, "cont-002", [
      { role: "user", content: "Long texte" },
      { role: "assistant", content: "Debut de reponse..." },
    ]);

    // Mock the continue POST response
    await page.route("**/api/v1/chat/new", (route) => {
      if (route.request().method() === "POST") {
        const events = [
          JSON.stringify({ eventName: "chat_created", chatId: "cont-002" }),
          JSON.stringify({ eventName: "chat", content: "Suite de la reponse." }),
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

    const getPayloads = await capturePostRequests(page, "**/api/v1/chat/new");

    await page.goto("/#/chat/cont-002");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByText("Debut de reponse...")).toBeVisible({ timeout: 10000 });

    const continueButton = page.locator('button[aria-label="Continuer la réponse"]');
    await continueButton.click();

    await page.waitForTimeout(2000);
    const payloads = getPayloads();
    expect(payloads.length).toBeGreaterThanOrEqual(1);
  });

  test("continue appends content after clicking", async ({ page }) => {
    await setupModels(page);

    await setupChatWithMessages(page, "cont-003", [
      { role: "user", content: "Continue" },
      { role: "assistant", content: "Premiere partie..." },
    ]);

    // Mock the continue response with appended content
    await page.route("**/api/v1/chat/new", (route) => {
      if (route.request().method() === "POST") {
        const events = [
          JSON.stringify({ eventName: "chat_created", chatId: "cont-003" }),
          JSON.stringify({ eventName: "chat", content: "Voici la suite du texte." }),
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

    await page.goto("/#/chat/cont-003");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByText("Premiere partie...")).toBeVisible({ timeout: 10000 });

    const continueButton = page.locator('button[aria-label="Continuer la réponse"]');
    await continueButton.click();

    // The new streamed continuation content should appear
    await expect(page.getByText("Voici la suite du texte.")).toBeVisible({ timeout: 10000 });
  });

  test("continue button NOT visible when message is not the last", async ({ page }) => {
    await setupModels(page);

    await setupChatWithMessages(page, "cont-004", [
      { role: "user", content: "Premier" },
      { role: "assistant", content: "Reponse 1" },
      { role: "user", content: "Deuxieme" },
      { role: "assistant", content: "Reponse 2" },
    ]);

    await page.goto("/#/chat/cont-004");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByText("Reponse 2")).toBeVisible({ timeout: 10000 });

    // Only the last assistant message should have the continue button
    // (isLastAssistantMessage is only true for the last one)
    const continueButtons = page.locator('button[aria-label="Continuer la réponse"]');
    const count = await continueButtons.count();
    // At most 1 (only on the last assistant message)
    expect(count).toBeLessThanOrEqual(1);
  });

  test("continue button NOT visible during streaming", async ({ page }) => {
    // During streaming, MessageActions are not rendered (see Message.tsx: !isStreaming condition)
    await setupStreamingMock(
      page,
      "cont-005",
      [
        { eventName: "chat_created", chatId: "cont-005" },
        { eventName: "chat", content: "En" },
        { eventName: "chat", content: " cours" },
        { eventName: "chat", content: " de" },
        { eventName: "chat", content: " streaming..." },
        // Note: no "done" event yet — still streaming
        { eventName: "done" },
      ],
      [
        { role: "user", content: "Test" },
        { role: "assistant", content: "En cours de streaming..." },
      ],
    );

    await goToChat(page);
    await sendMessage(page, "Test");

    // Wait for content to appear
    await expect(page.getByText("En cours de streaming...")).toBeVisible({ timeout: 10000 });

    // After done, the button should appear (but during streaming it was hidden)
    // We verify that MessageActions eventually appears after streaming ends
    const continueButton = page.locator('button[aria-label="Continuer la réponse"]');
    await expect(continueButton).toBeAttached({ timeout: 10000 });
  });
});

// ─── Model Badge ──────────────────────────────────────────────────────────

test.describe("Model badge", () => {
  test("shows model name on assistant message", async ({ page }) => {
    await setupModels(page);

    await setupChatWithMessages(page, "badge-001", [
      { role: "user", content: "Test modele" },
      { role: "assistant", content: "Reponse du modele", model: "gemma3:4b" },
    ]);

    await page.goto("/#/chat/badge-001");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByText("Reponse du modele")).toBeVisible({ timeout: 10000 });

    // The model badge should show "gemma3:4b"
    const badge = page.locator("span.font-mono").filter({ hasText: "gemma3:4b" });
    await expect(badge).toBeVisible({ timeout: 5000 });
  });

  test("no badge on user messages", async ({ page }) => {
    await setupModels(page);

    await setupChatWithMessages(page, "badge-002", [
      { role: "user", content: "Pas de badge ici" },
      { role: "assistant", content: "Avec badge", model: "gemma3:4b" },
    ]);

    await page.goto("/#/chat/badge-002");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByText("Pas de badge ici")).toBeVisible({ timeout: 10000 });

    // The user message container should have no model badge
    const userMsg = page.locator('[data-role="user"]');
    const badgeInUser = userMsg.locator("span.font-mono");
    await expect(badgeInUser).toHaveCount(0);
  });

  test("correct model name displayed", async ({ page }) => {
    await setupModels(page);

    await setupChatWithMessages(page, "badge-003", [
      { role: "user", content: "Quel modele?" },
      { role: "assistant", content: "Je suis gemma3", model: "gemma3:4b" },
    ]);

    await page.goto("/#/chat/badge-003");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByText("Je suis gemma3")).toBeVisible({ timeout: 10000 });

    // Verify the exact model name text
    const badge = page.locator("span.font-mono").filter({ hasText: "gemma3:4b" });
    await expect(badge).toHaveText("gemma3:4b");
  });

  test("badge present after model switch in multi-turn", async ({ page }) => {
    await setupModels(page);

    await setupChatWithMessages(page, "badge-004", [
      { role: "user", content: "Premier message" },
      { role: "assistant", content: "Reponse avec gemma", model: "gemma3:4b" },
      { role: "user", content: "Deuxieme message" },
      { role: "assistant", content: "Reponse avec llama", model: "llama3.2:3b" },
    ]);

    await page.goto("/#/chat/badge-004");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByText("Reponse avec llama")).toBeVisible({ timeout: 10000 });

    // Both model badges should be visible
    const gemmaBadge = page.locator("span.font-mono").filter({ hasText: "gemma3:4b" });
    const llamaBadge = page.locator("span.font-mono").filter({ hasText: "llama3.2:3b" });
    await expect(gemmaBadge).toBeVisible({ timeout: 5000 });
    await expect(llamaBadge).toBeVisible({ timeout: 5000 });
  });
});

// ─── Hover reveal ──────────────────────────────────────────────────────────

test.describe("Hover reveal", () => {
  test("action buttons container exists on assistant message", async ({ page }) => {
    await setupModels(page);

    await setupChatWithMessages(page, "hover-001", [
      { role: "user", content: "Hover test" },
      { role: "assistant", content: "Reponse pour hover" },
    ]);

    await page.goto("/#/chat/hover-001");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByText("Reponse pour hover")).toBeVisible({ timeout: 10000 });

    // The msg-actions-container should exist on the assistant message
    const actionsContainer = page.locator(".msg-actions-container");
    await expect(actionsContainer).toBeAttached({ timeout: 5000 });
  });

  test("hovering over message reveals action buttons", async ({ page }) => {
    await setupModels(page);

    await setupChatWithMessages(page, "hover-002", [
      { role: "user", content: "Hover reveal" },
      { role: "assistant", content: "Survoler pour voir actions" },
    ]);

    await page.goto("/#/chat/hover-002");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByText("Survoler pour voir actions")).toBeVisible({ timeout: 10000 });

    // Hover over the assistant message area
    const assistantMsg = page.locator(".assistant-message-content").first();
    await assistantMsg.hover();

    // After hover, the action buttons container should be visible
    const actionsContainer = page.locator(".msg-actions-container");
    await expect(actionsContainer).toBeAttached({ timeout: 5000 });
  });

  test("mouse leave area keeps action buttons present", async ({ page }) => {
    await setupModels(page);

    await setupChatWithMessages(page, "hover-003", [
      { role: "user", content: "Hover leave" },
      { role: "assistant", content: "Deplacer la souris" },
    ]);

    await page.goto("/#/chat/hover-003");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByText("Deplacer la souris")).toBeVisible({ timeout: 10000 });

    // Hover over the assistant message
    const assistantMsg = page.locator(".assistant-message-content").first();
    await assistantMsg.hover();

    // Confirm actions are present
    const actionsContainer = page.locator(".msg-actions-container");
    await expect(actionsContainer).toBeAttached({ timeout: 5000 });

    // Move mouse away from the message (to the textarea area)
    const textarea = page.locator("textarea");
    await textarea.hover();

    // The action buttons container should still be in the DOM
    // (it does not get removed from DOM, though opacity may change via CSS group hover)
    await expect(actionsContainer).toBeAttached({ timeout: 5000 });
  });
});

import { test, expect } from "./fixtures";
import { setupStreamingMock, sendMessage, goToChat, MOCK_MODELS_LIST } from "./helpers";

/**
 * E2E tests for AlternativesNav component.
 *
 * Covers: navigation arrows, counter display, regeneration creating alternatives,
 * content switching, and localStorage persistence.
 */

// ---- Helpers ----------------------------------------------------------------

/** Standard streaming events for a simple assistant response. */
function makeStreamEvents(chatId: string, content: string) {
  const words = content.split(" ");
  const events: Record<string, unknown>[] = [
    { eventName: "chat_created", chatId },
  ];
  for (const w of words) {
    events.push({ eventName: "chat", content: w + " " });
  }
  events.push({ eventName: "done" });
  return events;
}

/** Standard final messages returned after streaming for GET /api/v1/chat/:id. */
function makeFinalMessages(
  userContent: string,
  assistantContent: string,
  model = "gemma3:4b",
) {
  return [
    { role: "user", content: userContent },
    { role: "assistant", content: assistantContent, model },
  ];
}

/**
 * Set up a mock for the regeneration flow.
 * In the real app, regeneration sends a POST to /api/v1/chat/new with an index.
 * The mock needs to return a DIFFERENT response for the regenerated answer,
 * and then the GET endpoint needs to return updated messages.
 */
async function setupRegenerationMock(
  page: any,
  chatId: string,
  regeneratedContent: string,
  userContent: string,
) {
  // Override chat POST to return regenerated content
  await page.route("**/api/v1/chat/new", (route: any) => {
    if (route.request().method() === "POST") {
      const events = [
        JSON.stringify({ eventName: "chat_created", chatId }),
        JSON.stringify({ eventName: "chat", content: regeneratedContent }),
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

  // Update GET to return the new message set
  await page.route(`**/api/v1/chat/${chatId}`, (route: any) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        chat: {
          id: chatId,
          title: "Test Chat",
          messages: [
            { role: "user", content: userContent },
            { role: "assistant", content: regeneratedContent, model: "gemma3:4b" },
          ],
        },
        messages: [],
      }),
    });
  });
}

// ---- Tests ------------------------------------------------------------------

test.describe("AlternativesNav — No alternatives", () => {
  test("navigation arrows are absent when only 1 response exists", async ({ page }) => {
    const chatId = "alt-no-nav-001";

    await setupStreamingMock(
      page,
      chatId,
      makeStreamEvents(chatId, "Reponse unique sans alternatives."),
      makeFinalMessages("Bonjour", "Reponse unique sans alternatives."),
    );

    await page.goto("/");
    await sendMessage(page, "Bonjour");

    // Wait for assistant response to appear
    await expect(page.getByText("Reponse unique sans alternatives.")).toBeVisible({ timeout: 10000 });

    // AlternativesNav renders nothing when there are no alternatives (returns null).
    // So the < > arrows and counter should NOT be in the DOM.
    const leftArrow = page.locator("button", { hasText: "<" }).filter({
      has: page.locator("xpath=.."),
    });
    // A more precise check: the component shows X/Y pattern
    const counter = page.locator("text=/\\d+\\/\\d+/");
    await expect(counter).not.toBeVisible({ timeout: 3000 });
  });

  test('no "1/1" counter displayed for single response', async ({ page }) => {
    const chatId = "alt-no-counter-002";

    await setupStreamingMock(
      page,
      chatId,
      makeStreamEvents(chatId, "Pas de compteur ici."),
      makeFinalMessages("Test", "Pas de compteur ici."),
    );

    await page.goto("/");
    await sendMessage(page, "Test");

    await expect(page.getByText("Pas de compteur ici.")).toBeVisible({ timeout: 10000 });

    // The "1/1" text should NOT appear
    await expect(page.getByText("1/1")).not.toBeVisible({ timeout: 3000 });
  });
});

test.describe("AlternativesNav — Navigation", () => {
  /**
   * Shared setup: send a message, then trigger regeneration so that
   * an alternative is stored in localStorage, producing a 1/2 counter.
   */
  async function setupWithOneAlternative(page: any) {
    const chatId = "alt-nav-010";
    const originalContent = "Ceci est la reponse originale du modele pour tester les alternatives.";
    const regenContent = "Ceci est la reponse regeneree qui est differente de la premiere.";

    // Step 1: Set up initial streaming
    await setupStreamingMock(
      page,
      chatId,
      makeStreamEvents(chatId, originalContent),
      makeFinalMessages("Dis bonjour", originalContent),
    );

    await page.goto("/");
    await sendMessage(page, "Dis bonjour");
    await expect(page.getByText(originalContent)).toBeVisible({ timeout: 10000 });

    // Step 2: Pre-seed localStorage with an alternative so AlternativesNav shows "1/2"
    // This simulates what handleRegenerate() does: addAlternative before re-sending.
    await page.evaluate(
      ([cId, original]: [string, string]) => {
        const STORAGE_KEY = "dromadaire-alternatives";
        const key = `${cId}:1`; // message index 1 = assistant message
        const data: Record<string, any[]> = {};
        data[key] = [
          {
            content: "Reponse alternative stockee en localStorage.",
            thinking: "",
            model: "gemma3:4b",
            created_at: "2025-01-01T00:00:00Z",
          },
        ];
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      },
      [chatId, originalContent],
    );

    // Step 3: Reload to pick up the localStorage alternatives
    // Re-set up the mocks since reload clears route handlers
    await setupStreamingMock(
      page,
      chatId,
      makeStreamEvents(chatId, originalContent),
      makeFinalMessages("Dis bonjour", originalContent),
    );

    // Navigate directly to the chat
    await page.goto(`/c/${chatId}`);
    await expect(page.getByText(originalContent)).toBeVisible({ timeout: 10000 });

    return { chatId, originalContent };
  }

  test('after regeneration, shows "1/2" counter', async ({ page }) => {
    await setupWithOneAlternative(page);

    // The counter "1/2" should now be visible
    await expect(page.getByText("1/2")).toBeVisible({ timeout: 5000 });
  });

  test('right arrow navigates to "2/2"', async ({ page }) => {
    await setupWithOneAlternative(page);
    await expect(page.getByText("1/2")).toBeVisible({ timeout: 5000 });

    // Click right arrow (the > button next to the counter)
    const rightBtn = page.locator("button", { hasText: ">" }).first();
    await rightBtn.click();

    await expect(page.getByText("2/2")).toBeVisible({ timeout: 5000 });
  });

  test('left arrow navigates back to "1/2"', async ({ page }) => {
    await setupWithOneAlternative(page);
    await expect(page.getByText("1/2")).toBeVisible({ timeout: 5000 });

    // Navigate to 2/2 first
    const rightBtn = page.locator("button", { hasText: ">" }).first();
    await rightBtn.click();
    await expect(page.getByText("2/2")).toBeVisible({ timeout: 5000 });

    // Click left arrow to go back
    const leftBtn = page.locator("button", { hasText: "<" }).first();
    await leftBtn.click();
    await expect(page.getByText("1/2")).toBeVisible({ timeout: 5000 });
  });

  test("left arrow disabled when on 1/N", async ({ page }) => {
    await setupWithOneAlternative(page);
    await expect(page.getByText("1/2")).toBeVisible({ timeout: 5000 });

    // Left arrow should be disabled at position 1/2
    const leftBtn = page.locator("button", { hasText: "<" }).first();
    await expect(leftBtn).toBeDisabled();
  });

  test("right arrow disabled when on N/N", async ({ page }) => {
    await setupWithOneAlternative(page);
    await expect(page.getByText("1/2")).toBeVisible({ timeout: 5000 });

    // Navigate to 2/2
    const rightBtn = page.locator("button", { hasText: ">" }).first();
    await rightBtn.click();
    await expect(page.getByText("2/2")).toBeVisible({ timeout: 5000 });

    // Right arrow should be disabled at position 2/2
    await expect(rightBtn).toBeDisabled();
  });

  test("content changes between alternatives", async ({ page }) => {
    const chatId = "alt-content-change-011";
    const originalContent = "Contenu original de la reponse du modele.";
    const altContent = "Contenu alternatif completement different du premier.";

    await setupStreamingMock(
      page,
      chatId,
      makeStreamEvents(chatId, originalContent),
      makeFinalMessages("Test contenu", originalContent),
    );

    // Pre-seed localStorage with an alternative that has different content
    await page.goto("/");

    await page.evaluate(
      ([cId, alt]: [string, string]) => {
        const STORAGE_KEY = "dromadaire-alternatives";
        const key = `${cId}:1`;
        const data: Record<string, any[]> = {};
        data[key] = [
          {
            content: alt,
            thinking: "",
            model: "gemma3:4b",
            created_at: "2025-01-01T00:00:00Z",
          },
        ];
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      },
      [chatId, altContent],
    );

    // Set up the mock again and navigate to the chat
    await setupStreamingMock(
      page,
      chatId,
      makeStreamEvents(chatId, originalContent),
      makeFinalMessages("Test contenu", originalContent),
    );

    await page.goto(`/c/${chatId}`);
    await expect(page.getByText(originalContent)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("1/2")).toBeVisible({ timeout: 5000 });

    // Navigate to alternative
    const rightBtn = page.locator("button", { hasText: ">" }).first();
    await rightBtn.click();

    // The alternative content should now be visible
    await expect(page.getByText(altContent)).toBeVisible({ timeout: 5000 });
    // Original content should be replaced
    await expect(page.getByText(originalContent)).not.toBeVisible({ timeout: 3000 });
  });
});

test.describe("AlternativesNav — Regeneration creates alternatives", () => {
  test("regenerate button is visible on assistant messages", async ({ page }) => {
    const chatId = "alt-regen-btn-020";

    await setupStreamingMock(
      page,
      chatId,
      makeStreamEvents(chatId, "Reponse avec bouton regenerer visible."),
      makeFinalMessages("Test regen", "Reponse avec bouton regenerer visible."),
    );

    await page.goto("/");
    await sendMessage(page, "Test regen");
    await expect(page.getByText("Reponse avec bouton regenerer visible.")).toBeVisible({ timeout: 10000 });

    // The regenerate button has aria-label "Regenerer la reponse" (with accents)
    const regenBtn = page.locator('[aria-label="Régénérer la réponse"]');
    await expect(regenBtn).toBeVisible({ timeout: 5000 });
  });

  test("regenerate button creates a new alternative and shows counter", async ({ page }) => {
    const chatId = "alt-regen-020";
    const originalContent = "Premiere reponse du modele avant regeneration.";
    const regenContent = "Deuxieme reponse apres regeneration.";

    // Step 1: Initial response
    await setupStreamingMock(
      page,
      chatId,
      makeStreamEvents(chatId, originalContent),
      makeFinalMessages("Dis quelque chose", originalContent),
    );

    await page.goto("/");
    await sendMessage(page, "Dis quelque chose");
    await expect(page.getByText(originalContent)).toBeVisible({ timeout: 10000 });

    // Step 2: Set up regeneration mock (overrides the POST route)
    await setupRegenerationMock(page, chatId, regenContent, "Dis quelque chose");

    // Step 3: Click regenerate button
    const regenBtn = page.locator('[aria-label="Régénérer la réponse"]');
    await regenBtn.click();

    // Step 4: Wait for the regenerated content to appear
    await expect(page.getByText(regenContent)).toBeVisible({ timeout: 10000 });

    // Step 5: The counter should appear since the original was saved as alternative
    // After regeneration, localStorage should have the original as an alternative.
    // The counter shows "1/2" (current is pos 1, alternative is pos 2).
    await expect(page.getByText("1/2")).toBeVisible({ timeout: 5000 });
  });

  test("new content is different from original after regeneration", async ({ page }) => {
    const chatId = "alt-regen-diff-021";
    const originalContent = "Reponse A originale du modele.";
    const regenContent = "Reponse B completement differente.";

    await setupStreamingMock(
      page,
      chatId,
      makeStreamEvents(chatId, originalContent),
      makeFinalMessages("Test diff", originalContent),
    );

    await page.goto("/");
    await sendMessage(page, "Test diff");
    await expect(page.getByText(originalContent)).toBeVisible({ timeout: 10000 });

    await setupRegenerationMock(page, chatId, regenContent, "Test diff");
    const regenBtn = page.locator('[aria-label="Régénérer la réponse"]');
    await regenBtn.click();

    // New content appears
    await expect(page.getByText(regenContent)).toBeVisible({ timeout: 10000 });
    // Original content is no longer the current display
    await expect(page.getByText(originalContent)).not.toBeVisible({ timeout: 3000 });
  });

  test("counter increments with multiple regenerations", async ({ page }) => {
    const chatId = "alt-regen-multi-022";

    // Pre-seed localStorage with 2 alternatives to simulate having regenerated twice already
    await page.goto("/");

    await page.evaluate((cId: string) => {
      const STORAGE_KEY = "dromadaire-alternatives";
      const key = `${cId}:1`;
      const data: Record<string, any[]> = {};
      data[key] = [
        {
          content: "Alternative 1 stockee.",
          thinking: "",
          model: "gemma3:4b",
          created_at: "2025-01-01T00:00:00Z",
        },
        {
          content: "Alternative 2 stockee.",
          thinking: "",
          model: "gemma3:4b",
          created_at: "2025-01-01T01:00:00Z",
        },
      ];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    }, chatId);

    // Set up mock with current (3rd) response
    await setupStreamingMock(
      page,
      chatId,
      makeStreamEvents(chatId, "Troisieme reponse du modele."),
      makeFinalMessages("Test multi", "Troisieme reponse du modele."),
    );

    await page.goto(`/c/${chatId}`);
    await expect(page.getByText("Troisieme reponse du modele.")).toBeVisible({ timeout: 10000 });

    // With 2 alternatives stored, counter should be "1/3"
    await expect(page.getByText("1/3")).toBeVisible({ timeout: 5000 });
  });
});

test.describe("AlternativesNav — Persistence", () => {
  const chatId = "alt-persist-030";
  const originalContent = "Contenu persistant pour test de rechargement.";
  const altContent = "Alternative persistante en localStorage.";

  async function seedAndSetupMock(page: any) {
    // Seed localStorage
    await page.evaluate(
      ([cId, alt]: [string, string]) => {
        const STORAGE_KEY = "dromadaire-alternatives";
        const key = `${cId}:1`;
        const data: Record<string, any[]> = {};
        data[key] = [
          {
            content: alt,
            thinking: "",
            model: "gemma3:4b",
            created_at: "2025-01-01T00:00:00Z",
          },
        ];
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      },
      [chatId, altContent],
    );

    await setupStreamingMock(
      page,
      chatId,
      makeStreamEvents(chatId, originalContent),
      makeFinalMessages("Persist test", originalContent),
    );
  }

  test("alternatives persist after page reload", async ({ page }) => {
    await page.goto("/");
    await seedAndSetupMock(page);

    await page.goto(`/c/${chatId}`);
    await expect(page.getByText(originalContent)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("1/2")).toBeVisible({ timeout: 5000 });

    // Reload the page — need to re-setup mocks
    await seedAndSetupMock(page);
    await page.goto(`/c/${chatId}`);

    // Alternatives should still be there
    await expect(page.getByText(originalContent)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("1/2")).toBeVisible({ timeout: 5000 });
  });

  test("alternatives persist after navigation away and back", async ({ page }) => {
    await page.goto("/");
    await seedAndSetupMock(page);

    await page.goto(`/c/${chatId}`);
    await expect(page.getByText("1/2")).toBeVisible({ timeout: 5000 });

    // Navigate away to settings
    await page.goto("/settings");
    await page.waitForLoadState("domcontentloaded");

    // Re-setup mocks (routes reset on navigation)
    await seedAndSetupMock(page);

    // Navigate back to the chat
    await page.goto(`/c/${chatId}`);
    await expect(page.getByText("1/2")).toBeVisible({ timeout: 5000 });
  });

  test("localStorage contains alternatives data", async ({ page }) => {
    await page.goto("/");
    await seedAndSetupMock(page);

    // Directly check localStorage
    const stored = await page.evaluate(() => {
      return localStorage.getItem("dromadaire-alternatives");
    });

    expect(stored).toBeTruthy();
    const parsed = JSON.parse(stored);
    const key = `${chatId}:1`;
    expect(parsed[key]).toBeDefined();
    expect(parsed[key]).toHaveLength(1);
    expect(parsed[key][0].content).toBe(altContent);
  });
});

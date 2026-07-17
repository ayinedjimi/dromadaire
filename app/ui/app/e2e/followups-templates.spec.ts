import { test, expect } from "./fixtures";
import { setupStreamingMock, sendMessage, goToChat, MOCK_MODELS_LIST, setupModels } from "./helpers";

/**
 * E2E tests for FollowUpSuggestions and PromptTemplates components.
 *
 * FollowUpSuggestions: suggestion chips after assistant response.
 * PromptTemplates: 2x3 grid of quick-start templates on empty chat.
 */

// ---- Helpers ----------------------------------------------------------------

function makeStreamEvents(chatId: string, content: string) {
  // Split by words and stream them
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

// ---- FollowUpSuggestions Tests ----------------------------------------------

test.describe("FollowUpSuggestions", () => {
  test("suggestions appear after streaming response with FOLLOWUP tags", async ({ page }) => {
    const chatId = "followup-tag-001";
    const content =
      "Voici une explication detaillee du concept de TypeScript. TypeScript est un langage de programmation qui ajoute du typage statique a JavaScript.\n\n<<FOLLOWUP: Montre un exemple concret>>\n<<FOLLOWUP: Quels sont les avantages ?>>\n<<FOLLOWUP: Comment installer TypeScript ?>>";

    await setupStreamingMock(
      page,
      chatId,
      makeStreamEvents(chatId, content),
      makeFinalMessages("Explique TypeScript", content),
    );

    await page.goto("/");
    await sendMessage(page, "Explique TypeScript");

    // Wait for response to appear (content is stripped of FOLLOWUP tags in display)
    await expect(page.getByText("TypeScript est un langage")).toBeVisible({ timeout: 10000 });

    // Follow-up suggestions should appear as buttons
    await expect(page.getByRole("button", { name: "Montre un exemple concret" })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole("button", { name: "Quels sont les avantages ?" })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole("button", { name: "Comment installer TypeScript ?" })).toBeVisible({ timeout: 5000 });
  });

  test("maximum 3 suggestions displayed even with more FOLLOWUP tags", async ({ page }) => {
    const chatId = "followup-max-002";
    const content =
      "Explication longue et detaillee sur la programmation fonctionnelle en JavaScript avec des exemples pratiques.\n\n<<FOLLOWUP: Suggestion 1>>\n<<FOLLOWUP: Suggestion 2>>\n<<FOLLOWUP: Suggestion 3>>\n<<FOLLOWUP: Suggestion 4>>\n<<FOLLOWUP: Suggestion 5>>";

    await setupStreamingMock(
      page,
      chatId,
      makeStreamEvents(chatId, content),
      makeFinalMessages("Explique fonctionnel", content),
    );

    await page.goto("/");
    await sendMessage(page, "Explique fonctionnel");

    await expect(page.getByText("programmation fonctionnelle")).toBeVisible({ timeout: 10000 });

    // Only 3 suggestions max
    await expect(page.getByRole("button", { name: "Suggestion 1" })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole("button", { name: "Suggestion 2" })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole("button", { name: "Suggestion 3" })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole("button", { name: "Suggestion 4" })).not.toBeVisible({ timeout: 3000 });
  });

  test("clicking a suggestion sends it as a new message", async ({ page }) => {
    const chatId = "followup-click-003";
    const content =
      "Voici comment fonctionne la recursion en programmation. La recursion est une technique algorithmique puissante.\n\n<<FOLLOWUP: Donne un exemple>>";

    await setupStreamingMock(
      page,
      chatId,
      makeStreamEvents(chatId, content),
      makeFinalMessages("Recursion ?", content),
    );

    await page.goto("/");
    await sendMessage(page, "Recursion ?");
    await expect(page.getByText("La recursion est une technique")).toBeVisible({ timeout: 10000 });

    // Set up mock for the second message (when the follow-up is sent)
    const chatId2 = "followup-click-003-v2";
    const content2 = "Voici un exemple de fonction recursive en Python avec fibonacci.";
    await setupStreamingMock(
      page,
      chatId2,
      makeStreamEvents(chatId2, content2),
      [
        ...makeFinalMessages("Recursion ?", content),
        { role: "user", content: "Donne un exemple" },
        { role: "assistant", content: content2, model: "gemma3:4b" },
      ],
    );

    // Click the suggestion button
    const suggestionBtn = page.getByRole("button", { name: "Donne un exemple" });
    await expect(suggestionBtn).toBeVisible({ timeout: 5000 });
    await suggestionBtn.click();

    // The user message should appear in the chat
    await expect(page.getByText("Donne un exemple")).toBeVisible({ timeout: 5000 });
  });

  test("suggestions relevant to content via contextual generation (code response)", async ({ page }) => {
    const chatId = "followup-ctx-005";
    // A response with code should generate code-relevant follow-ups
    const content =
      "Voici un exemple de fonction en Python :\n\n```python\ndef fibonacci(n):\n    if n <= 1:\n        return n\n    return fibonacci(n-1) + fibonacci(n-2)\n```\n\nCette fonction calcule les nombres de Fibonacci de facon recursive.";

    await setupStreamingMock(
      page,
      chatId,
      makeStreamEvents(chatId, content),
      makeFinalMessages("Code fibonacci", content),
    );

    await page.goto("/");
    await sendMessage(page, "Code fibonacci");
    await expect(page.getByText("Fibonacci")).toBeVisible({ timeout: 10000 });

    // For Python code, the contextual generator should suggest testing-related follow-ups
    // Check that at least one follow-up button exists (the exact text depends on the generator)
    const followUpButtons = page.locator("button.rounded-full");
    await expect(followUpButtons.first()).toBeVisible({ timeout: 5000 });
    const count = await followUpButtons.count();
    expect(count).toBeGreaterThanOrEqual(1);
    expect(count).toBeLessThanOrEqual(3);
  });

  test("no suggestions for very short responses", async ({ page }) => {
    const chatId = "followup-short-006";
    // Short response (< 100 chars) should NOT generate contextual suggestions
    const content = "Oui, c'est correct.";

    await setupStreamingMock(
      page,
      chatId,
      makeStreamEvents(chatId, content),
      makeFinalMessages("Est-ce correct ?", content),
    );

    await page.goto("/");
    await sendMessage(page, "Est-ce correct ?");
    await expect(page.getByText("Oui, c'est correct.")).toBeVisible({ timeout: 10000 });

    // No follow-up buttons should appear for short responses
    // Wait a beat to ensure they would have rendered if they were going to
    await page.waitForTimeout(1000);
    const followUpButtons = page.locator("button.rounded-full");
    const count = await followUpButtons.count();
    expect(count).toBe(0);
  });

  test("no suggestions when response is an error", async ({ page }) => {
    const chatId = "followup-err-007";

    // Set up models
    await setupModels(page);

    // Mock an error response — the error event causes an ErrorMessage, not an assistant message
    await page.route("**/api/v1/chat/new", (route) => {
      if (route.request().method() === "POST") {
        const events = [
          JSON.stringify({ eventName: "chat_created", chatId }),
          JSON.stringify({ eventName: "error", error: "Le modele est introuvable." }),
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

    await page.route(`**/api/v1/chat/${chatId}`, (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          chat: { id: chatId, title: "Error Chat", messages: [{ role: "user", content: "Test erreur" }] },
          messages: [],
        }),
      });
    });

    await page.goto("/");
    await sendMessage(page, "Test erreur");
    await expect(page.getByText("Le modele est introuvable.")).toBeVisible({ timeout: 10000 });

    // No follow-up suggestions for error responses
    await page.waitForTimeout(1000);
    const followUpButtons = page.locator("button.rounded-full");
    const count = await followUpButtons.count();
    expect(count).toBe(0);
  });

  test("suggestions reappear after a new response", async ({ page }) => {
    const chatId = "followup-reappear-008";
    const content1 =
      "TypeScript est un langage de programmation tres populaire pour le developpement web moderne et les applications Node.js.\n\n<<FOLLOWUP: En savoir plus>>";

    await setupStreamingMock(
      page,
      chatId,
      makeStreamEvents(chatId, content1),
      makeFinalMessages("TypeScript?", content1),
    );

    await page.goto("/");
    await sendMessage(page, "TypeScript?");
    await expect(page.getByText("TypeScript est un langage")).toBeVisible({ timeout: 10000 });

    // First follow-up should be visible
    await expect(page.getByRole("button", { name: "En savoir plus" })).toBeVisible({ timeout: 5000 });

    // Now send a second message, with its own follow-ups
    const chatId2 = "followup-reappear-008-v2";
    const content2 =
      "JavaScript est le langage de base du web, utilise dans tous les navigateurs modernes pour creer des interfaces interactives.\n\n<<FOLLOWUP: Quelle difference avec TypeScript ?>>";

    await setupStreamingMock(
      page,
      chatId2,
      makeStreamEvents(chatId2, content2),
      [
        { role: "user", content: "TypeScript?" },
        { role: "assistant", content: content1, model: "gemma3:4b" },
        { role: "user", content: "Et JavaScript?" },
        { role: "assistant", content: content2, model: "gemma3:4b" },
      ],
    );

    await sendMessage(page, "Et JavaScript?");
    await expect(page.getByText("JavaScript est le langage de base")).toBeVisible({ timeout: 10000 });

    // New follow-up suggestions should appear for the latest response
    await expect(
      page.getByRole("button", { name: "Quelle difference avec TypeScript ?" }),
    ).toBeVisible({ timeout: 5000 });
  });
});

// ---- PromptTemplates Tests --------------------------------------------------

test.describe("PromptTemplates", () => {
  test("templates visible on empty chat (no messages)", async ({ page }) => {
    await setupModels(page);
    await page.goto("/");
    await page.locator("textarea").waitFor({ state: "visible", timeout: 15000 });

    // At least one template button should be visible
    await expect(page.getByRole("button", { name: "Resumer un texte" })).toBeVisible({ timeout: 5000 });
  });

  test("6 template buttons displayed", async ({ page }) => {
    await setupModels(page);
    await page.goto("/");
    await page.locator("textarea").waitFor({ state: "visible", timeout: 15000 });

    // Check all 6 templates are present
    const expectedLabels = [
      "Resumer un texte",
      "Traduire",
      "Expliquer du code",
      "Ameliorer ce mail",
      "Creer une page web",
      "Brainstormer",
    ];

    for (const label of expectedLabels) {
      await expect(page.getByRole("button", { name: label })).toBeVisible({ timeout: 5000 });
    }
  });

  test("grid layout (2-3 columns)", async ({ page }) => {
    await setupModels(page);
    await page.goto("/");
    await page.locator("textarea").waitFor({ state: "visible", timeout: 15000 });

    // The templates grid should have the grid-cols-2 or grid-cols-3 class
    const grid = page.locator(".grid.grid-cols-2");
    await expect(grid).toBeVisible({ timeout: 5000 });
  });

  test('click "Resumer un texte" fills textarea', async ({ page }) => {
    await setupModels(page);
    await page.goto("/");
    const textarea = page.locator("textarea");
    await textarea.waitFor({ state: "visible", timeout: 15000 });

    await page.getByRole("button", { name: "Resumer un texte" }).click();

    // Textarea should contain the template prompt text
    await expect(textarea).toHaveValue(/Resume le texte suivant/i, { timeout: 5000 });
  });

  test('click "Creer une page web" fills textarea', async ({ page }) => {
    await setupModels(page);
    await page.goto("/");
    const textarea = page.locator("textarea");
    await textarea.waitFor({ state: "visible", timeout: 15000 });

    await page.getByRole("button", { name: "Creer une page web" }).click();

    await expect(textarea).toHaveValue(/Cree une page web/i, { timeout: 5000 });
  });

  test("templates disappear after first message sent", async ({ page }) => {
    const chatId = "templates-disappear-001";

    await setupStreamingMock(
      page,
      chatId,
      [
        { eventName: "chat_created", chatId },
        { eventName: "chat", content: "Voila la reponse." },
        { eventName: "done" },
      ],
      makeFinalMessages("Bonjour", "Voila la reponse."),
    );

    await page.goto("/");
    await page.locator("textarea").waitFor({ state: "visible", timeout: 15000 });

    // Templates should be visible before sending a message
    await expect(page.getByRole("button", { name: "Resumer un texte" })).toBeVisible({ timeout: 5000 });

    // Send a message
    await sendMessage(page, "Bonjour");

    // Wait for response
    await expect(page.getByText("Voila la reponse.")).toBeVisible({ timeout: 10000 });

    // Templates should be gone
    await expect(page.getByRole("button", { name: "Resumer un texte" })).not.toBeVisible({ timeout: 3000 });
    await expect(page.getByRole("button", { name: "Brainstormer" })).not.toBeVisible({ timeout: 3000 });
  });

  test("templates reappear on new chat (Ctrl+N)", async ({ page }) => {
    const chatId = "templates-reappear-002";

    await setupStreamingMock(
      page,
      chatId,
      [
        { eventName: "chat_created", chatId },
        { eventName: "chat", content: "Reponse." },
        { eventName: "done" },
      ],
      makeFinalMessages("Test", "Reponse."),
    );

    await page.goto("/");
    await page.locator("textarea").waitFor({ state: "visible", timeout: 15000 });

    // Templates visible initially
    await expect(page.getByRole("button", { name: "Traduire" })).toBeVisible({ timeout: 5000 });

    // Send a message to make templates disappear
    await sendMessage(page, "Test");
    await expect(page.getByText("Reponse.")).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole("button", { name: "Traduire" })).not.toBeVisible({ timeout: 3000 });

    // Re-setup models mock for after the navigation
    await setupModels(page);

    // Press Ctrl+N for new chat
    await page.keyboard.press("Control+n");

    // Wait for navigation to new chat
    await page.locator("textarea").waitFor({ state: "visible", timeout: 10000 });

    // Templates should reappear on the new chat
    await expect(page.getByRole("button", { name: "Traduire" })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole("button", { name: "Resumer un texte" })).toBeVisible({ timeout: 5000 });
  });

  test("templates reappear when navigating to /", async ({ page }) => {
    const chatId = "templates-nav-root-003";

    await setupStreamingMock(
      page,
      chatId,
      [
        { eventName: "chat_created", chatId },
        { eventName: "chat", content: "Ok." },
        { eventName: "done" },
      ],
      makeFinalMessages("Hello", "Ok."),
    );

    await page.goto("/");
    await page.locator("textarea").waitFor({ state: "visible", timeout: 15000 });

    // Send a message
    await sendMessage(page, "Hello");
    await expect(page.getByText("Ok.")).toBeVisible({ timeout: 10000 });

    // Re-setup models mock before navigation
    await setupModels(page);

    // Navigate to root for a new chat
    await page.goto("/");
    await page.locator("textarea").waitFor({ state: "visible", timeout: 15000 });

    // Templates should be visible again
    await expect(page.getByRole("button", { name: "Brainstormer" })).toBeVisible({ timeout: 5000 });
  });

  test('"Ameliorer ce mail" triggers mode change (human+email)', async ({ page }) => {
    await setupModels(page);

    // We'll capture the settings POST requests to verify mode change was sent.
    // Use a request listener instead of re-routing (which would conflict with fixtures).
    const settingsPosts: unknown[] = [];
    page.on("request", (request) => {
      if (
        request.url().includes("/api/v1/settings") &&
        request.method() === "POST"
      ) {
        try {
          settingsPosts.push(request.postDataJSON());
        } catch {
          // ignore
        }
      }
    });

    await page.goto("/");
    const textarea = page.locator("textarea");
    await textarea.waitFor({ state: "visible", timeout: 15000 });

    await page.getByRole("button", { name: "Ameliorer ce mail" }).click();

    // Textarea should contain the mail improvement prompt
    await expect(textarea).toHaveValue(/Ameliore cet email/i, { timeout: 5000 });

    // The template should have triggered a settings POST with ResponseMode: "human"
    // Wait a beat for the POST to fire
    await page.waitForTimeout(1500);

    // Check that at least one settings POST was made with mode change
    const modePayload = settingsPosts.find(
      (p: any) => p && (p.ResponseMode === "human" || p.HumanSubMode === "email"),
    );
    expect(modePayload).toBeTruthy();
  });

  test('"Expliquer du code" fills textarea with code template', async ({ page }) => {
    await setupModels(page);
    await page.goto("/");
    const textarea = page.locator("textarea");
    await textarea.waitFor({ state: "visible", timeout: 15000 });

    await page.getByRole("button", { name: "Expliquer du code" }).click();

    await expect(textarea).toHaveValue(/Explique ce code/i, { timeout: 5000 });
  });

  test('"Traduire" fills textarea with translate template', async ({ page }) => {
    await setupModels(page);
    await page.goto("/");
    const textarea = page.locator("textarea");
    await textarea.waitFor({ state: "visible", timeout: 15000 });

    await page.getByRole("button", { name: "Traduire" }).click();

    await expect(textarea).toHaveValue(/Traduis le texte suivant/i, { timeout: 5000 });
  });

  test('"Brainstormer" fills textarea with brainstorm template', async ({ page }) => {
    await setupModels(page);
    await page.goto("/");
    const textarea = page.locator("textarea");
    await textarea.waitFor({ state: "visible", timeout: 15000 });

    await page.getByRole("button", { name: "Brainstormer" }).click();

    await expect(textarea).toHaveValue(/Donne-moi 10 idees/i, { timeout: 5000 });
  });

  test("templates responsive on smaller viewport", async ({ page }) => {
    await setupModels(page);

    // Resize the viewport to a smaller width to test responsive behavior
    await page.setViewportSize({ width: 640, height: 480 });

    await page.goto("/");
    await page.locator("textarea").waitFor({ state: "visible", timeout: 15000 });

    // Templates should still be visible on smaller viewport
    // The grid uses grid-cols-2 on small screens and grid-cols-3 on md+
    const firstTemplate = page.getByRole("button", { name: "Resumer un texte" });
    await expect(firstTemplate).toBeVisible({ timeout: 5000 });

    // Verify the grid container exists
    const grid = page.locator(".grid.grid-cols-2");
    await expect(grid).toBeVisible({ timeout: 5000 });

    // All 6 templates should still be accessible
    const templateCount = await grid.locator("button").count();
    expect(templateCount).toBe(6);

    // Verify all template buttons are visible even at small viewport
    const expectedLabels = [
      "Resumer un texte",
      "Traduire",
      "Expliquer du code",
      "Ameliorer ce mail",
      "Creer une page web",
      "Brainstormer",
    ];
    for (const label of expectedLabels) {
      await expect(page.getByRole("button", { name: label })).toBeVisible({ timeout: 3000 });
    }
  });
});

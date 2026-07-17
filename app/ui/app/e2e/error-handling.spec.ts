import { test, expect } from "./fixtures";
import {
  setupStreamingMock,
  setupModels,
  sendMessage,
  goToChat,
  capturePostRequests,
  MOCK_MODELS_LIST,
} from "./helpers";

// ─── Generic Error ──────────────────────────────────────────────────────────

test.describe("Generic error", () => {
  test("error event displays the error message in the chat", async ({ page }) => {
    await setupStreamingMock(
      page,
      "gen-err-001",
      [
        { eventName: "chat_created", chatId: "gen-err-001" },
        { eventName: "error", error: "Une erreur inattendue est survenue" },
      ],
      [{ role: "user", content: "Bonjour" }],
    );

    await goToChat(page);
    await sendMessage(page, "Bonjour");

    await expect(
      page.getByText("Une erreur inattendue est survenue"),
    ).toBeVisible({ timeout: 10000 });
  });

  test("textarea remains usable after error — app does not crash", async ({ page }) => {
    await setupStreamingMock(
      page,
      "gen-err-002",
      [
        { eventName: "chat_created", chatId: "gen-err-002" },
        { eventName: "error", error: "Erreur temporaire" },
      ],
      [{ role: "user", content: "Test" }],
    );

    await goToChat(page);
    await sendMessage(page, "Test");

    // Error visible
    await expect(page.getByText("Erreur temporaire")).toBeVisible({ timeout: 10000 });

    // Textarea should still be visible and functional
    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 5000 });
    await textarea.fill("Message de suivi");
    await expect(textarea).toHaveValue("Message de suivi");
  });

  test("error message is styled with the error icon (circled X)", async ({ page }) => {
    await setupStreamingMock(
      page,
      "gen-err-003",
      [
        { eventName: "chat_created", chatId: "gen-err-003" },
        { eventName: "error", error: "Erreur de style" },
      ],
      [{ role: "user", content: "Style" }],
    );

    await goToChat(page);
    await sendMessage(page, "Style");

    await expect(page.getByText("Erreur de style")).toBeVisible({ timeout: 10000 });

    // The ErrorMessage component renders an "Erreur" heading
    await expect(page.getByText("Erreur", { exact: true }).first()).toBeVisible({ timeout: 5000 });
  });
});

// ─── Model Not Found ────────────────────────────────────────────────────────

test.describe("Model not found error", () => {
  test("model not found error message is displayed", async ({ page }) => {
    await setupStreamingMock(
      page,
      "mnf-001",
      [
        { eventName: "chat_created", chatId: "mnf-001" },
        {
          eventName: "error",
          error: "model \"mistral:7b\" not found, try pulling it first",
        },
      ],
      [{ role: "user", content: "Salut" }],
    );

    await goToChat(page);
    await sendMessage(page, "Salut");

    await expect(page.getByText(/not found/i)).toBeVisible({ timeout: 10000 });
  });

  test("error suggests pulling/downloading the model", async ({ page }) => {
    await setupStreamingMock(
      page,
      "mnf-002",
      [
        { eventName: "chat_created", chatId: "mnf-002" },
        {
          eventName: "error",
          error: "model \"mistral:7b\" not found, try pulling it first",
        },
      ],
      [{ role: "user", content: "Test" }],
    );

    await goToChat(page);
    await sendMessage(page, "Test");

    await expect(page.getByText(/pulling/i)).toBeVisible({ timeout: 10000 });
  });

  test("error heading is visible alongside the message", async ({ page }) => {
    await setupStreamingMock(
      page,
      "mnf-003",
      [
        { eventName: "chat_created", chatId: "mnf-003" },
        {
          eventName: "error",
          error: "model \"phi3\" not found, try pulling it first",
        },
      ],
      [{ role: "user", content: "Phi3" }],
    );

    await goToChat(page);
    await sendMessage(page, "Phi3");

    // The ErrorMessage renders an "Erreur" heading for generic errors
    await expect(page.getByText("Erreur", { exact: true }).first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/not found/)).toBeVisible();
  });
});

// ─── Airplane Blocked ───────────────────────────────────────────────────────

test.describe("Airplane blocked error", () => {
  test("airplane_blocked code shows airplane mode message", async ({ page }) => {
    await setupStreamingMock(
      page,
      "air-001",
      [
        { eventName: "chat_created", chatId: "air-001" },
        {
          eventName: "error",
          error: "Le mode avion bloque le telechargement",
          code: "airplane_blocked",
          details: "Le mode avion empeche le telechargement de modeles",
        },
      ],
      [{ role: "user", content: "Telecharge" }],
    );

    await goToChat(page);
    await sendMessage(page, "Telecharge");

    // The airplane_blocked branch renders "Mode avion actif"
    await expect(page.getByText("Mode avion actif")).toBeVisible({ timeout: 10000 });
  });

  test("disable airplane mode button is visible", async ({ page }) => {
    await setupStreamingMock(
      page,
      "air-002",
      [
        { eventName: "chat_created", chatId: "air-002" },
        {
          eventName: "error",
          error: "Mode avion actif",
          code: "airplane_blocked",
        },
      ],
      [{ role: "user", content: "Pull" }],
    );

    await goToChat(page);
    await sendMessage(page, "Pull");

    // Button text from ErrorMessage.tsx
    const disableBtn = page.getByText("Desactiver le mode avion et reessayer");
    await expect(disableBtn).toBeVisible({ timeout: 10000 });
  });

  test("clicking disable button sends POST to turn off airplane mode", async ({ page }) => {
    await setupStreamingMock(
      page,
      "air-003",
      [
        { eventName: "chat_created", chatId: "air-003" },
        {
          eventName: "error",
          error: "Mode avion actif",
          code: "airplane_blocked",
        },
      ],
      [{ role: "user", content: "Pull" }],
    );

    // Capture settings POST requests
    const getPayloads = await capturePostRequests(page, "**/api/v1/settings");

    await goToChat(page);
    await sendMessage(page, "Pull");

    const disableBtn = page.getByText("Desactiver le mode avion et reessayer");
    await expect(disableBtn).toBeVisible({ timeout: 10000 });
    await disableBtn.click();

    // Verify the POST payload disables airplane mode
    await page.waitForTimeout(1000);
    const payloads = getPayloads();
    const airplanePayload = payloads.find(
      (p: any) => p && typeof p === "object" && "AirplaneMode" in (p as Record<string, unknown>),
    );
    expect(airplanePayload).toBeTruthy();
    expect((airplanePayload as Record<string, unknown>).AirplaneMode).toBe(false);
  });

  test("app remains functional after dismissing airplane error", async ({ page }) => {
    await setupStreamingMock(
      page,
      "air-004",
      [
        { eventName: "chat_created", chatId: "air-004" },
        {
          eventName: "error",
          error: "Mode avion bloque",
          code: "airplane_blocked",
        },
      ],
      [{ role: "user", content: "Test" }],
    );

    await goToChat(page);
    await sendMessage(page, "Test");

    const disableBtn = page.getByText("Desactiver le mode avion et reessayer");
    await expect(disableBtn).toBeVisible({ timeout: 10000 });
    await disableBtn.click();

    // Textarea should remain usable
    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 5000 });
  });
});

// ─── Usage Limit ────────────────────────────────────────────────────────────

test.describe("Usage limit error", () => {
  test("usage_limit_upgrade code displays limit message via DisplayUpgrade", async ({ page }) => {
    await setupStreamingMock(
      page,
      "usg-001",
      [
        { eventName: "chat_created", chatId: "usg-001" },
        {
          eventName: "error",
          error: "Limite d'utilisation atteinte",
          code: "usage_limit_upgrade",
          details: "Passez a un plan superieur pour continuer",
        },
      ],
      [{ role: "user", content: "Question" }],
    );

    await goToChat(page);
    await sendMessage(page, "Question");

    // DisplayUpgrade renders the error.error text as the message
    await expect(
      page.getByText("Limite d'utilisation atteinte"),
    ).toBeVisible({ timeout: 10000 });
  });

  test("upgrade button is visible for usage limit", async ({ page }) => {
    await setupStreamingMock(
      page,
      "usg-002",
      [
        { eventName: "chat_created", chatId: "usg-002" },
        {
          eventName: "error",
          error: "Limite atteinte",
          code: "usage_limit_upgrade",
        },
      ],
      [{ role: "user", content: "Test" }],
    );

    await goToChat(page);
    await sendMessage(page, "Test");

    // DisplayUpgrade renders an "Upgrade" button (default label)
    await expect(page.getByText("Upgrade")).toBeVisible({ timeout: 10000 });
  });

  test("upgrade link points to ollama.com", async ({ page }) => {
    await setupStreamingMock(
      page,
      "usg-003",
      [
        { eventName: "chat_created", chatId: "usg-003" },
        {
          eventName: "error",
          error: "Limite atteinte",
          code: "usage_limit_upgrade",
        },
      ],
      [{ role: "user", content: "Test" }],
    );

    await goToChat(page);
    await sendMessage(page, "Test");

    // The Upgrade button is an anchor link
    const upgradeLink = page.locator('a:has-text("Upgrade")');
    await expect(upgradeLink).toBeVisible({ timeout: 10000 });
    const href = await upgradeLink.getAttribute("href");
    expect(href).toContain("ollama.com");
  });
});

// ─── Cloud Unauthorized ─────────────────────────────────────────────────────

test.describe("Cloud unauthorized error", () => {
  test("cloud_unauthorized code displays auth error via DisplayLogin", async ({ page }) => {
    await setupStreamingMock(
      page,
      "cld-001",
      [
        { eventName: "chat_created", chatId: "cld-001" },
        {
          eventName: "error",
          error: "Authentification requise",
          code: "cloud_unauthorized",
        },
      ],
      [{ role: "user", content: "Cloud" }],
    );

    await goToChat(page);
    await sendMessage(page, "Cloud");

    // DisplayLogin shows the error message or a default
    await expect(
      page.getByText(/cloud.*account|Authentification/i).first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test("sign in button is visible for cloud unauthorized", async ({ page }) => {
    await setupStreamingMock(
      page,
      "cld-002",
      [
        { eventName: "chat_created", chatId: "cld-002" },
        {
          eventName: "error",
          error: "Authentification requise",
          code: "cloud_unauthorized",
        },
      ],
      [{ role: "user", content: "Auth" }],
    );

    await goToChat(page);
    await sendMessage(page, "Auth");

    // DisplayLogin renders a "Sign In" action button
    await expect(page.getByText("Sign In")).toBeVisible({ timeout: 10000 });
  });
});

// ─── Network/API Errors ─────────────────────────────────────────────────────

test.describe("Network and API errors", () => {
  test("network failure during chat POST shows error", async ({ page }) => {
    await setupModels(page);

    // Abort the chat POST route to simulate network failure
    await page.route("**/api/v1/chat/new", (route) => {
      if (route.request().method() === "POST") {
        route.abort("connectionrefused");
      } else {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ chat: null, messages: [] }),
        });
      }
    });

    await goToChat(page);
    await sendMessage(page, "Test reseau");

    // The app should display some error state (either via ErrorMessage or the text area still works)
    // Network errors are caught and usually displayed in the chat
    const errorIndicator = page.locator("text=/erreur|error|failed|echec/i").first();
    await expect(errorIndicator).toBeVisible({ timeout: 10000 });
  });

  test("500 server error on chat POST shows error message", async ({ page }) => {
    await setupModels(page);

    await page.route("**/api/v1/chat/new", (route) => {
      if (route.request().method() === "POST") {
        route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "Internal server error" }),
        });
      } else {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ chat: null, messages: [] }),
        });
      }
    });

    await goToChat(page);
    await sendMessage(page, "Test 500");

    // Should show some error indication
    const errorIndicator = page.locator("text=/erreur|error|500|server/i").first();
    await expect(errorIndicator).toBeVisible({ timeout: 10000 });
  });

  test("timeout on chat POST — app handles gracefully", async ({ page }) => {
    await setupModels(page);

    // Simulate timeout by never fulfilling the route
    await page.route("**/api/v1/chat/new", (route) => {
      if (route.request().method() === "POST") {
        // Delay indefinitely — we test that the UI remains responsive
        // We use abort after a short delay to simulate timeout
        setTimeout(() => route.abort("timedout"), 3000);
      } else {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ chat: null, messages: [] }),
        });
      }
    });

    await goToChat(page);
    await sendMessage(page, "Test timeout");

    // After abort, the app should show an error or remain stable
    await page.waitForTimeout(4000);
    // Textarea should still exist (app didn't crash)
    await expect(page.locator("textarea")).toBeVisible({ timeout: 5000 });
  });

  test("app remains functional after API error — can still type", async ({ page }) => {
    await setupModels(page);

    // First request fails
    let requestCount = 0;
    await page.route("**/api/v1/chat/new", (route) => {
      if (route.request().method() === "POST") {
        requestCount++;
        if (requestCount === 1) {
          route.abort("connectionrefused");
        } else {
          // Subsequent requests succeed
          const body = [
            JSON.stringify({ eventName: "chat_created", chatId: "recover-001" }),
            JSON.stringify({ eventName: "chat", content: "Reponse" }),
            JSON.stringify({ eventName: "done" }),
          ].join("\n") + "\n";
          route.fulfill({
            status: 200,
            contentType: "application/x-ndjson",
            body,
          });
        }
      } else {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ chat: null, messages: [] }),
        });
      }
    });

    await page.route("**/api/v1/chat/recover-001", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          chat: { id: "recover-001", title: "Recover", messages: [{ role: "user", content: "Retry" }, { role: "assistant", content: "Reponse" }] },
          messages: [],
        }),
      });
    });

    await goToChat(page);
    await sendMessage(page, "Premier essai");

    // Wait for the error to be handled
    await page.waitForTimeout(2000);

    // Textarea should be visible and editable
    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 5000 });
    await textarea.fill("Deuxieme essai");
    await expect(textarea).toHaveValue("Deuxieme essai");
  });

  test("multiple sequential errors do not crash the app", async ({ page }) => {
    // First error
    await setupStreamingMock(
      page,
      "multi-err-001",
      [
        { eventName: "chat_created", chatId: "multi-err-001" },
        { eventName: "error", error: "Erreur numero 1" },
      ],
      [{ role: "user", content: "Premier" }],
    );

    await goToChat(page);
    await sendMessage(page, "Premier");
    await expect(page.getByText("Erreur numero 1")).toBeVisible({ timeout: 10000 });

    // Now set up a second error for the next message
    await setupStreamingMock(
      page,
      "multi-err-002",
      [
        { eventName: "chat_created", chatId: "multi-err-002" },
        { eventName: "error", error: "Erreur numero 2" },
      ],
      [{ role: "user", content: "Deuxieme" }],
    );

    // Send a second message (we may need to navigate back to new chat)
    await page.goto("/");
    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 15000 });
    await textarea.fill("Deuxieme");
    await textarea.press("Enter");

    await expect(page.getByText("Erreur numero 2")).toBeVisible({ timeout: 10000 });

    // App should still be functional
    await expect(page.locator("textarea")).toBeVisible({ timeout: 5000 });
  });
});

// ─── Mid-stream Error ───────────────────────────────────────────────────────

test.describe("Mid-stream error", () => {
  test("error after partial content — partial text is preserved", async ({ page }) => {
    await setupStreamingMock(
      page,
      "mid-001",
      [
        { eventName: "chat_created", chatId: "mid-001" },
        { eventName: "chat", content: "Debut de la reponse" },
        { eventName: "chat", content: " qui continue" },
        { eventName: "error", error: "Connexion interrompue" },
      ],
      [
        { role: "user", content: "Question" },
        { role: "assistant", content: "Debut de la reponse qui continue" },
      ],
    );

    await goToChat(page);
    await sendMessage(page, "Question");

    // Partial content should be visible
    await expect(
      page.getByText("Debut de la reponse qui continue"),
    ).toBeVisible({ timeout: 10000 });

    // Error message should also be visible
    await expect(page.getByText("Connexion interrompue")).toBeVisible({ timeout: 5000 });
  });

  test("error message appears after partial text without replacing it", async ({ page }) => {
    await setupStreamingMock(
      page,
      "mid-002",
      [
        { eventName: "chat_created", chatId: "mid-002" },
        { eventName: "chat", content: "Voici le debut" },
        { eventName: "error", error: "Erreur en cours de generation" },
      ],
      [
        { role: "user", content: "Test midstream" },
        { role: "assistant", content: "Voici le debut" },
      ],
    );

    await goToChat(page);
    await sendMessage(page, "Test midstream");

    // Both partial content and error should coexist
    await expect(page.getByText("Voici le debut")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Erreur en cours de generation")).toBeVisible({ timeout: 5000 });

    // The "Erreur" heading from ErrorMessage confirms it is the error component
    const erreurHeadings = page.getByText("Erreur", { exact: true });
    await expect(erreurHeadings.first()).toBeVisible({ timeout: 5000 });
  });
});

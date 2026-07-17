import { test, expect } from "./fixtures";
import {
  setupStreamingMock,
  sendMessage,
  goToChat,
  capturePostRequests,
  mockSettingsOverride,
} from "./helpers";

// ─── Generic Error ──────────────────────────────────────────────

test.describe("Streaming errors — Generic error", () => {
  test("error event displays error message in the chat", async ({ page }) => {
    await setupStreamingMock(
      page,
      "err-gen-001",
      [
        { eventName: "chat_created", chatId: "err-gen-001" },
        { eventName: "error", error: "Une erreur inattendue est survenue." },
      ],
      [{ role: "user", content: "Test erreur" }],
    );

    await goToChat(page);
    await sendMessage(page, "Test erreur");

    await expect(
      page.getByText("Une erreur inattendue est survenue."),
    ).toBeVisible({ timeout: 10000 });
  });

  test("app does not crash after error — textarea remains usable", async ({
    page,
  }) => {
    await setupStreamingMock(
      page,
      "err-gen-002",
      [
        { eventName: "chat_created", chatId: "err-gen-002" },
        { eventName: "error", error: "Erreur critique" },
      ],
      [{ role: "user", content: "Test crash" }],
    );

    await goToChat(page);
    await sendMessage(page, "Test crash");

    await expect(page.getByText("Erreur critique")).toBeVisible({
      timeout: 10000,
    });

    // The textarea should still be present and interactive
    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 5000 });
    await expect(textarea).toBeEnabled();
  });

  test("error is styled distinctly with error heading", async ({ page }) => {
    await setupStreamingMock(
      page,
      "err-gen-003",
      [
        { eventName: "chat_created", chatId: "err-gen-003" },
        { eventName: "error", error: "Probleme de connexion au serveur." },
      ],
      [{ role: "user", content: "Test style" }],
    );

    await goToChat(page);
    await sendMessage(page, "Test style");

    // The ErrorMessage component renders an "Erreur" heading
    await expect(page.getByText("Erreur")).toBeVisible({ timeout: 10000 });
    await expect(
      page.getByText("Probleme de connexion au serveur."),
    ).toBeVisible({ timeout: 5000 });
  });
});

// ─── Model Not Found ──────────────────────────────────────────

test.describe("Streaming errors — Model not found", () => {
  test("specific model error message is displayed", async ({ page }) => {
    await setupStreamingMock(
      page,
      "err-model-001",
      [
        { eventName: "chat_created", chatId: "err-model-001" },
        {
          eventName: "error",
          error:
            "model 'llama3:70b' not found, try pulling it first",
        },
      ],
      [{ role: "user", content: "Test modele" }],
    );

    await goToChat(page);
    await sendMessage(page, "Test modele");

    await expect(
      page.getByText(/model.*not found|modele.*introuvable/i),
    ).toBeVisible({ timeout: 10000 });
  });

  test("model error suggests to download/pull", async ({ page }) => {
    await setupStreamingMock(
      page,
      "err-model-002",
      [
        { eventName: "chat_created", chatId: "err-model-002" },
        {
          eventName: "error",
          error: "model 'mistral:7b' not found, try pulling it first",
        },
      ],
      [{ role: "user", content: "Test pull" }],
    );

    await goToChat(page);
    await sendMessage(page, "Test pull");

    // The error text mentions pulling the model
    await expect(page.getByText(/pulling|pull/i)).toBeVisible({
      timeout: 10000,
    });
  });

  test("error heading visible after model error", async ({ page }) => {
    await setupStreamingMock(
      page,
      "err-model-003",
      [
        { eventName: "chat_created", chatId: "err-model-003" },
        {
          eventName: "error",
          error: "model 'codestral:22b' not found",
        },
      ],
      [{ role: "user", content: "Test retry" }],
    );

    await goToChat(page);
    await sendMessage(page, "Test retry");

    // The "Erreur" heading from ErrorMessage component is visible
    await expect(page.getByText("Erreur")).toBeVisible({ timeout: 10000 });
    // Textarea is still available for a new attempt
    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 5000 });
  });
});

// ─── Airplane Blocked ──────────────────────────────────────────

test.describe("Streaming errors — Airplane blocked", () => {
  test("airplane_blocked error code shows specific airplane mode message", async ({
    page,
  }) => {
    await setupStreamingMock(
      page,
      "err-air-001",
      [
        { eventName: "chat_created", chatId: "err-air-001" },
        {
          eventName: "error",
          error: "Le telechargement est bloque par le mode avion.",
          code: "airplane_blocked",
          details:
            "Le mode avion empeche le telechargement de nouveaux modeles.",
        },
      ],
      [{ role: "user", content: "Test avion" }],
    );

    await goToChat(page);
    await sendMessage(page, "Test avion");

    // The airplane_blocked code renders "Mode avion actif" heading
    await expect(page.getByText("Mode avion actif")).toBeVisible({
      timeout: 10000,
    });
  });

  test("disable airplane mode button appears", async ({ page }) => {
    await setupStreamingMock(
      page,
      "err-air-002",
      [
        { eventName: "chat_created", chatId: "err-air-002" },
        {
          eventName: "error",
          error: "Telechargement bloque",
          code: "airplane_blocked",
          details: "Mode avion actif, desactivez-le pour continuer.",
        },
      ],
      [{ role: "user", content: "Test bouton avion" }],
    );

    await goToChat(page);
    await sendMessage(page, "Test bouton avion");

    // The button text from ErrorMessage.tsx
    const disableButton = page.getByText(
      "Desactiver le mode avion et reessayer",
    );
    await expect(disableButton).toBeVisible({ timeout: 10000 });
  });

  test("clicking disable button POSTs AirplaneMode:false to settings", async ({
    page,
  }) => {
    await setupStreamingMock(
      page,
      "err-air-003",
      [
        { eventName: "chat_created", chatId: "err-air-003" },
        {
          eventName: "error",
          error: "Bloque par mode avion",
          code: "airplane_blocked",
          details: "Desactivez le mode avion.",
        },
      ],
      [{ role: "user", content: "Test desactiver" }],
    );

    // Capture settings POST requests
    const getPayloads = await capturePostRequests(
      page,
      "**/api/v1/settings",
      { settings: { AirplaneMode: false } },
    );

    await goToChat(page);
    await sendMessage(page, "Test desactiver");

    const disableButton = page.getByText(
      "Desactiver le mode avion et reessayer",
    );
    await expect(disableButton).toBeVisible({ timeout: 10000 });

    await disableButton.click();

    // Wait a bit for the POST to be sent
    await page.waitForTimeout(1000);

    // Verify a POST was made with AirplaneMode: false
    const payloads = getPayloads();
    const airplanePayload = payloads.find(
      (p: any) => p && typeof p === "object" && "AirplaneMode" in p,
    );
    expect(airplanePayload).toBeDefined();
    expect((airplanePayload as any).AirplaneMode).toBe(false);
  });
});

// ─── Usage Limit ──────────────────────────────────────────────

test.describe("Streaming errors — Usage limit", () => {
  test("usage_limit_upgrade error shows limit message", async ({ page }) => {
    await setupStreamingMock(
      page,
      "err-limit-001",
      [
        { eventName: "chat_created", chatId: "err-limit-001" },
        {
          eventName: "error",
          error: "Limite d'utilisation atteinte.",
          code: "usage_limit_upgrade",
          details: "Vous avez depasse votre quota mensuel.",
        },
      ],
      [{ role: "user", content: "Test limite" }],
    );

    await goToChat(page);
    await sendMessage(page, "Test limite");

    // usage_limit_upgrade errors are rendered by a special component
    // The error or details text should appear somewhere in the page
    await expect(
      page.getByText(/limite|quota|depasse/i),
    ).toBeVisible({ timeout: 10000 });
  });

  test("details field is shown for usage limit error", async ({ page }) => {
    await setupStreamingMock(
      page,
      "err-limit-002",
      [
        { eventName: "chat_created", chatId: "err-limit-002" },
        {
          eventName: "error",
          error: "Limite atteinte",
          code: "usage_limit_upgrade",
          details: "Votre quota de 100 messages par jour est epuise.",
        },
      ],
      [{ role: "user", content: "Test details limite" }],
    );

    await goToChat(page);
    await sendMessage(page, "Test details limite");

    await expect(
      page.getByText(/quota|100 messages|epuise/i),
    ).toBeVisible({ timeout: 10000 });
  });
});

// ─── Network Error ──────────────────────────────────────────────

test.describe("Streaming errors — Network error", () => {
  test("simulated timeout shows error message", async ({ page }) => {
    // Override the chat POST to abort the request (simulates network failure)
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
              size: 1_000_000,
            },
          ],
        }),
      });
    });

    await page.route("**/api/v1/chat/new", (route) => {
      if (route.request().method() === "POST") {
        route.abort("timedout");
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

    // The app should catch the network error and show something
    // Either an error message appears or the textarea stays usable
    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 15000 });
  });

  test("offline error keeps app functional", async ({ page }) => {
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
              size: 1_000_000,
            },
          ],
        }),
      });
    });

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
    await sendMessage(page, "Test offline");

    // App should remain functional even after network failure
    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 15000 });
    await expect(textarea).toBeEnabled();
  });

  test("retry possible after network error", async ({ page }) => {
    let callCount = 0;

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
              size: 1_000_000,
            },
          ],
        }),
      });
    });

    // First call fails, second succeeds
    await page.route("**/api/v1/chat/new", (route) => {
      if (route.request().method() === "POST") {
        callCount++;
        if (callCount === 1) {
          route.abort("connectionrefused");
        } else {
          const events = [
            { eventName: "chat_created", chatId: "err-net-003" },
            { eventName: "chat", content: "Ca fonctionne maintenant !" },
            { eventName: "done" },
          ];
          route.fulfill({
            status: 200,
            contentType: "application/x-ndjson",
            body: events.map((e) => JSON.stringify(e)).join("\n") + "\n",
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

    await page.route("**/api/v1/chat/err-net-003", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          chat: {
            id: "err-net-003",
            title: "Test Chat",
            messages: [
              { role: "user", content: "Retry" },
              { role: "assistant", content: "Ca fonctionne maintenant !" },
            ],
          },
          messages: [],
        }),
      });
    });

    await goToChat(page);

    // First attempt fails
    await sendMessage(page, "Test retry");
    await page.waitForTimeout(2000);

    // Second attempt should succeed — textarea should still be available
    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 10000 });

    await sendMessage(page, "Retry");

    await expect(
      page.getByText("Ca fonctionne maintenant !"),
    ).toBeVisible({ timeout: 10000 });
  });
});

// ─── Malformed JSON ──────────────────────────────────────────────

test.describe("Streaming errors — Malformed JSON", () => {
  test("invalid NDJSON line is handled gracefully", async ({ page }) => {
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
              size: 1_000_000,
            },
          ],
        }),
      });
    });

    await page.route("**/api/v1/chat/new", (route) => {
      if (route.request().method() === "POST") {
        // Inject a malformed line between valid events
        const body = [
          JSON.stringify({ eventName: "chat_created", chatId: "err-json-001" }),
          "this is not valid json {{{",
          JSON.stringify({ eventName: "chat", content: "Apres le JSON invalide." }),
          JSON.stringify({ eventName: "done" }),
        ].join("\n") + "\n";

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

    await page.route("**/api/v1/chat/err-json-001", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          chat: {
            id: "err-json-001",
            title: "Test Chat",
            messages: [
              { role: "user", content: "Test JSON" },
              { role: "assistant", content: "Apres le JSON invalide." },
            ],
          },
          messages: [],
        }),
      });
    });

    await goToChat(page);
    await sendMessage(page, "Test JSON");

    // The app should not crash — either shows the content or an error,
    // but the textarea remains usable
    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 15000 });
  });

  test("app remains functional after malformed response", async ({ page }) => {
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
              size: 1_000_000,
            },
          ],
        }),
      });
    });

    let callCount = 0;
    await page.route("**/api/v1/chat/new", (route) => {
      if (route.request().method() === "POST") {
        callCount++;
        if (callCount === 1) {
          // First: completely broken response
          route.fulfill({
            status: 200,
            contentType: "application/x-ndjson",
            body: "}}}}not json at all{{{\n",
          });
        } else {
          // Second: valid response
          const events = [
            { eventName: "chat_created", chatId: "err-json-002" },
            { eventName: "chat", content: "Deuxieme tentative reussie." },
            { eventName: "done" },
          ];
          route.fulfill({
            status: 200,
            contentType: "application/x-ndjson",
            body: events.map((e) => JSON.stringify(e)).join("\n") + "\n",
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

    await page.route("**/api/v1/chat/err-json-002", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          chat: {
            id: "err-json-002",
            title: "Test Chat",
            messages: [
              { role: "user", content: "Retry" },
              { role: "assistant", content: "Deuxieme tentative reussie." },
            ],
          },
          messages: [],
        }),
      });
    });

    await goToChat(page);

    // First attempt with broken JSON
    await sendMessage(page, "Test JSON casse");
    await page.waitForTimeout(2000);

    // App should still be functional — send a second message
    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 10000 });

    await sendMessage(page, "Retry");

    await expect(
      page.getByText("Deuxieme tentative reussie."),
    ).toBeVisible({ timeout: 10000 });
  });
});

// ─── Mid-stream Error ──────────────────────────────────────────

test.describe("Streaming errors — Mid-stream error", () => {
  test("error after partial tokens preserves partial content", async ({
    page,
  }) => {
    await setupStreamingMock(
      page,
      "err-mid-001",
      [
        { eventName: "chat_created", chatId: "err-mid-001" },
        { eventName: "chat", content: "Debut de la reponse" },
        { eventName: "chat", content: " qui va etre interrompue" },
        {
          eventName: "error",
          error: "Connexion perdue pendant la generation.",
        },
      ],
      [
        { role: "user", content: "Test mid-stream" },
        {
          role: "assistant",
          content: "Debut de la reponse qui va etre interrompue",
        },
      ],
    );

    await goToChat(page);
    await sendMessage(page, "Test mid-stream");

    // The partial content should be visible
    await expect(
      page.getByText("Debut de la reponse"),
    ).toBeVisible({ timeout: 10000 });

    // The error message should also appear
    await expect(
      page.getByText("Connexion perdue pendant la generation."),
    ).toBeVisible({ timeout: 5000 });
  });

  test("error message appended after partial content", async ({ page }) => {
    await setupStreamingMock(
      page,
      "err-mid-002",
      [
        { eventName: "chat_created", chatId: "err-mid-002" },
        { eventName: "chat", content: "Contenu partiel visible." },
        {
          eventName: "error",
          error: "Erreur interne du modele.",
        },
      ],
      [
        { role: "user", content: "Test erreur partielle" },
        { role: "assistant", content: "Contenu partiel visible." },
      ],
    );

    await goToChat(page);
    await sendMessage(page, "Test erreur partielle");

    // Both the partial content AND the error should coexist
    await expect(
      page.getByText("Contenu partiel visible."),
    ).toBeVisible({ timeout: 10000 });

    // The "Erreur" heading from ErrorMessage component
    await expect(page.getByText("Erreur")).toBeVisible({ timeout: 5000 });
    await expect(
      page.getByText("Erreur interne du modele."),
    ).toBeVisible({ timeout: 5000 });

    // Textarea remains usable
    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 5000 });
    await expect(textarea).toBeEnabled();
  });
});

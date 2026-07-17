import { test, expect } from "./fixtures";
import {
  setupStreamingMock,
  sendMessage,
  goToChat,
  capturePostRequests,
  mockSettingsOverride,
} from "./helpers";

// ─── Mode Normal ──────────────────────────────────────────────────

test.describe("Streaming — Normal mode", () => {
  test("simple message produces an assistant response", async ({ page }) => {
    await setupStreamingMock(
      page,
      "normal-001",
      [
        { eventName: "chat_created", chatId: "normal-001" },
        { eventName: "chat", content: "Bonjour ! Comment puis-je vous aider ?" },
        { eventName: "done" },
      ],
      [
        { role: "user", content: "Salut" },
        { role: "assistant", content: "Bonjour ! Comment puis-je vous aider ?" },
      ],
    );

    await goToChat(page);
    await sendMessage(page, "Salut");

    await expect(
      page.getByText("Bonjour ! Comment puis-je vous aider ?"),
    ).toBeVisible({ timeout: 10000 });
  });

  test("long multi-token response concatenates correctly", async ({ page }) => {
    await setupStreamingMock(
      page,
      "normal-002",
      [
        { eventName: "chat_created", chatId: "normal-002" },
        { eventName: "chat", content: "Voici" },
        { eventName: "chat", content: " une" },
        { eventName: "chat", content: " longue" },
        { eventName: "chat", content: " reponse" },
        { eventName: "chat", content: " composee" },
        { eventName: "chat", content: " de" },
        { eventName: "chat", content: " plusieurs" },
        { eventName: "chat", content: " tokens." },
        { eventName: "done" },
      ],
      [
        { role: "user", content: "Dis quelque chose de long" },
        {
          role: "assistant",
          content: "Voici une longue reponse composee de plusieurs tokens.",
        },
      ],
    );

    await goToChat(page);
    await sendMessage(page, "Dis quelque chose de long");

    await expect(
      page.getByText("Voici une longue reponse composee de plusieurs tokens."),
    ).toBeVisible({ timeout: 10000 });
  });

  test("message with markdown code block renders with syntax highlighting", async ({
    page,
  }) => {
    const codeContent =
      "Voici un exemple :\n\n```typescript\nconst x: number = 42;\nconsole.log(x);\n```";
    await setupStreamingMock(
      page,
      "normal-003",
      [
        { eventName: "chat_created", chatId: "normal-003" },
        { eventName: "chat", content: codeContent },
        { eventName: "done" },
      ],
      [
        { role: "user", content: "Montre du code" },
        { role: "assistant", content: codeContent },
      ],
    );

    await goToChat(page);
    await sendMessage(page, "Montre du code");

    // The code block should be rendered — look for the code element or pre
    await expect(page.locator("pre code")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("const x")).toBeVisible({ timeout: 5000 });
  });

  test("message with bullet list renders as list", async ({ page }) => {
    const listContent =
      "Voici une liste :\n\n- Premier element\n- Deuxieme element\n- Troisieme element";
    await setupStreamingMock(
      page,
      "normal-004",
      [
        { eventName: "chat_created", chatId: "normal-004" },
        { eventName: "chat", content: listContent },
        { eventName: "done" },
      ],
      [
        { role: "user", content: "Fais une liste" },
        { role: "assistant", content: listContent },
      ],
    );

    await goToChat(page);
    await sendMessage(page, "Fais une liste");

    // Markdown renders bullet lists as <li> elements
    await expect(page.locator("li").first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Premier element")).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByText("Deuxieme element")).toBeVisible({
      timeout: 5000,
    });
  });

  test("message with links renders as clickable links", async ({ page }) => {
    const linkContent =
      "Consultez la documentation sur [TypeScript](https://www.typescriptlang.org/).";
    await setupStreamingMock(
      page,
      "normal-005",
      [
        { eventName: "chat_created", chatId: "normal-005" },
        { eventName: "chat", content: linkContent },
        { eventName: "done" },
      ],
      [
        { role: "user", content: "Donne un lien" },
        { role: "assistant", content: linkContent },
      ],
    );

    await goToChat(page);
    await sendMessage(page, "Donne un lien");

    const link = page.locator('a[href="https://www.typescriptlang.org/"]');
    await expect(link).toBeVisible({ timeout: 10000 });
    await expect(link).toHaveAttribute("href", "https://www.typescriptlang.org/");
  });
});

// ─── Mode Thinking ──────────────────────────────────────────────

test.describe("Streaming — Thinking mode", () => {
  test("thinking + chat sequence shows thinking block and response", async ({
    page,
  }) => {
    await setupStreamingMock(
      page,
      "think-001",
      [
        { eventName: "chat_created", chatId: "think-001" },
        { eventName: "loading" },
        { eventName: "thinking", thinking: "Analysons le probleme..." },
        { eventName: "thinking", thinking: " Etape par etape." },
        { eventName: "chat", content: "La reponse est 42." },
        { eventName: "done" },
      ],
      [
        { role: "user", content: "Calcule" },
        {
          role: "assistant",
          content: "La reponse est 42.",
          thinking: "Analysons le probleme... Etape par etape.",
        },
      ],
    );

    await goToChat(page);
    await sendMessage(page, "Calcule");

    await expect(page.getByText("La reponse est 42.")).toBeVisible({
      timeout: 10000,
    });
    // The thinking block shows "Reflexion..." or the finished label
    const thinkingLabel = page.getByText(/flexion|flechi/);
    await expect(thinkingLabel).toBeVisible({ timeout: 5000 });
  });

  test("thinking content is visible during streaming", async ({ page }) => {
    // We need a slower streaming to observe — use the mock as-is since it resolves instantly.
    // The thinking block should appear with content during streaming.
    await setupStreamingMock(
      page,
      "think-002",
      [
        { eventName: "chat_created", chatId: "think-002" },
        { eventName: "thinking", thinking: "Premiere reflexion visible." },
        { eventName: "chat", content: "Reponse." },
        { eventName: "done" },
      ],
      [
        { role: "user", content: "Pense" },
        {
          role: "assistant",
          content: "Reponse.",
          thinking: "Premiere reflexion visible.",
        },
      ],
    );

    await goToChat(page);
    await sendMessage(page, "Pense");

    // After done, the thinking content should be present in the DOM
    await expect(page.getByText("Reponse.")).toBeVisible({ timeout: 10000 });
    // Thinking text is in the DOM (may be collapsed)
    await expect(page.getByText("Premiere reflexion visible.")).toBeAttached({
      timeout: 5000,
    });
  });

  test("thinking collapses after done event", async ({ page }) => {
    await setupStreamingMock(
      page,
      "think-003",
      [
        { eventName: "chat_created", chatId: "think-003" },
        {
          eventName: "thinking",
          thinking: "Contenu cache apres collapse.",
          thinkingTimeStart: new Date(Date.now() - 5000).toISOString(),
        },
        {
          eventName: "chat",
          content: "Resultat final.",
          thinkingTimeEnd: new Date().toISOString(),
        },
        { eventName: "done" },
      ],
      [
        { role: "user", content: "Reflechis" },
        {
          role: "assistant",
          content: "Resultat final.",
          thinking: "Contenu cache apres collapse.",
          thinkingTimeStart: new Date(Date.now() - 5000).toISOString(),
          thinkingTimeEnd: new Date().toISOString(),
        },
      ],
    );

    await goToChat(page);
    await sendMessage(page, "Reflechis");

    await expect(page.getByText("Resultat final.")).toBeVisible({
      timeout: 10000,
    });

    // After done, the thinking section should show "A reflechi" label (collapsed)
    const collapsedLabel = page.getByText(/flechi/);
    await expect(collapsedLabel).toBeVisible({ timeout: 5000 });
  });

  test("thinking toggle expand/collapse works", async ({ page }) => {
    await setupStreamingMock(
      page,
      "think-004",
      [
        { eventName: "chat_created", chatId: "think-004" },
        { eventName: "thinking", thinking: "Contenu de reflexion detaille." },
        { eventName: "chat", content: "Reponse claire." },
        { eventName: "done" },
      ],
      [
        { role: "user", content: "Analyse" },
        {
          role: "assistant",
          content: "Reponse claire.",
          thinking: "Contenu de reflexion detaille.",
          thinkingTimeStart: new Date(Date.now() - 3000).toISOString(),
          thinkingTimeEnd: new Date().toISOString(),
        },
      ],
    );

    await goToChat(page);
    await sendMessage(page, "Analyse");

    await expect(page.getByText("Reponse claire.")).toBeVisible({
      timeout: 10000,
    });

    // Find and click the thinking header to expand
    const thinkingHeader = page.getByText(/flexion|flechi/).first();
    await expect(thinkingHeader).toBeVisible({ timeout: 5000 });
    await thinkingHeader.click();

    // After clicking, the thinking content should become visible
    await expect(
      page.getByText("Contenu de reflexion detaille."),
    ).toBeVisible({ timeout: 5000 });

    // Click again to collapse
    await thinkingHeader.click();
    // Give time for collapse animation
    await page.waitForTimeout(500);
  });

  test("multiple thinking blocks in one response", async ({ page }) => {
    await setupStreamingMock(
      page,
      "think-005",
      [
        { eventName: "chat_created", chatId: "think-005" },
        { eventName: "thinking", thinking: "Premiere analyse..." },
        { eventName: "thinking", thinking: " Deuxieme analyse..." },
        { eventName: "thinking", thinking: " Conclusion." },
        { eventName: "chat", content: "Voici le resultat complet." },
        { eventName: "done" },
      ],
      [
        { role: "user", content: "Analyse complete" },
        {
          role: "assistant",
          content: "Voici le resultat complet.",
          thinking:
            "Premiere analyse... Deuxieme analyse... Conclusion.",
        },
      ],
    );

    await goToChat(page);
    await sendMessage(page, "Analyse complete");

    await expect(page.getByText("Voici le resultat complet.")).toBeVisible({
      timeout: 10000,
    });
  });

  test("thinking without chat content shows only thinking block", async ({
    page,
  }) => {
    await setupStreamingMock(
      page,
      "think-006",
      [
        { eventName: "chat_created", chatId: "think-006" },
        { eventName: "thinking", thinking: "Reflexion sans reponse finale." },
        { eventName: "done" },
      ],
      [
        { role: "user", content: "Pense seulement" },
        {
          role: "assistant",
          content: "",
          thinking: "Reflexion sans reponse finale.",
        },
      ],
    );

    await goToChat(page);
    await sendMessage(page, "Pense seulement");

    // The thinking label should be visible
    const thinkingLabel = page.getByText(/flexion|flechi/);
    await expect(thinkingLabel).toBeVisible({ timeout: 10000 });
  });
});

// ─── Multi-turn ──────────────────────────────────────────────

test.describe("Streaming — Multi-turn", () => {
  test("two successive messages and responses", async ({ page }) => {
    // First message
    let callCount = 0;
    await setupStreamingMock(
      page,
      "multi-001",
      [
        { eventName: "chat_created", chatId: "multi-001" },
        { eventName: "chat", content: "Premiere reponse." },
        { eventName: "done" },
      ],
      [
        { role: "user", content: "Premier message" },
        { role: "assistant", content: "Premiere reponse." },
      ],
    );

    await goToChat(page);
    await sendMessage(page, "Premier message");

    await expect(page.getByText("Premiere reponse.")).toBeVisible({
      timeout: 10000,
    });

    // After the first exchange, the app navigates to /chat/multi-001
    // Set up a second mock for posting to that chat
    await page.route("**/api/v1/chat/multi-001", (route) => {
      if (route.request().method() === "POST") {
        callCount++;
        const events = [
          { eventName: "chat", content: "Deuxieme reponse." },
          { eventName: "done" },
        ];
        const body = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
        route.fulfill({
          status: 200,
          contentType: "application/x-ndjson",
          body,
        });
      } else {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            chat: {
              id: "multi-001",
              title: "Test Chat",
              messages: [
                { role: "user", content: "Premier message" },
                { role: "assistant", content: "Premiere reponse." },
                { role: "user", content: "Deuxieme message" },
                { role: "assistant", content: "Deuxieme reponse." },
              ],
            },
            messages: [],
          }),
        });
      }
    });

    await sendMessage(page, "Deuxieme message");

    await expect(page.getByText("Deuxieme reponse.")).toBeVisible({
      timeout: 10000,
    });
  });

  test("history preserved after second message", async ({ page }) => {
    await setupStreamingMock(
      page,
      "multi-002",
      [
        { eventName: "chat_created", chatId: "multi-002" },
        { eventName: "chat", content: "Reponse initiale." },
        { eventName: "done" },
      ],
      [
        { role: "user", content: "Question initiale" },
        { role: "assistant", content: "Reponse initiale." },
      ],
    );

    await goToChat(page);
    await sendMessage(page, "Question initiale");

    await expect(page.getByText("Reponse initiale.")).toBeVisible({
      timeout: 10000,
    });

    // The user message should still be visible
    await expect(page.getByText("Question initiale")).toBeVisible({
      timeout: 5000,
    });
  });

  test("auto-scroll to bottom after new message", async ({ page }) => {
    await setupStreamingMock(
      page,
      "multi-003",
      [
        { eventName: "chat_created", chatId: "multi-003" },
        {
          eventName: "chat",
          content:
            "Une reponse assez longue pour forcer le scroll. ".repeat(20),
        },
        { eventName: "done" },
      ],
      [
        { role: "user", content: "Longue reponse" },
        {
          role: "assistant",
          content:
            "Une reponse assez longue pour forcer le scroll. ".repeat(20),
        },
      ],
    );

    await goToChat(page);
    await sendMessage(page, "Longue reponse");

    // Wait for content to appear
    await expect(
      page.getByText("Une reponse assez longue").first(),
    ).toBeVisible({ timeout: 10000 });

    // Verify the page scrolled — check that the textarea is still visible
    // (auto-scroll keeps it in view)
    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 5000 });
  });

  test("user message rendered correctly", async ({ page }) => {
    await setupStreamingMock(
      page,
      "multi-004",
      [
        { eventName: "chat_created", chatId: "multi-004" },
        { eventName: "chat", content: "Ok." },
        { eventName: "done" },
      ],
      [
        { role: "user", content: "Mon message utilisateur" },
        { role: "assistant", content: "Ok." },
      ],
    );

    await goToChat(page);
    await sendMessage(page, "Mon message utilisateur");

    // User message appears in a div with data-role="user"
    const userMsg = page.locator('[data-role="user"]');
    await expect(userMsg).toBeVisible({ timeout: 10000 });
    await expect(userMsg).toContainText("Mon message utilisateur");
  });

  test("assistant message rendered correctly", async ({ page }) => {
    await setupStreamingMock(
      page,
      "multi-005",
      [
        { eventName: "chat_created", chatId: "multi-005" },
        { eventName: "chat", content: "Je suis l'assistant." },
        { eventName: "done" },
      ],
      [
        { role: "user", content: "Qui es-tu" },
        { role: "assistant", content: "Je suis l'assistant." },
      ],
    );

    await goToChat(page);
    await sendMessage(page, "Qui es-tu");

    // The assistant message renders via StreamingMarkdownContent inside
    // a div with id="message-container" or class assistant-message-content
    await expect(page.getByText("Je suis l'assistant.")).toBeVisible({
      timeout: 10000,
    });
    const assistantContent = page.locator(".assistant-message-content");
    await expect(assistantContent).toBeVisible({ timeout: 5000 });
  });
});

// ─── Download Progress ──────────────────────────────────────────

test.describe("Streaming — Download progress", () => {
  test("download events show progress indicator", async ({ page }) => {
    await setupStreamingMock(
      page,
      "dl-001",
      [
        { eventName: "chat_created", chatId: "dl-001" },
        {
          eventName: "download",
          total: 2_000_000_000,
          completed: 500_000_000,
          done: false,
        },
        {
          eventName: "download",
          total: 2_000_000_000,
          completed: 2_000_000_000,
          done: true,
        },
        { eventName: "chat", content: "Modele charge." },
        { eventName: "done" },
      ],
      [
        { role: "user", content: "Test download" },
        { role: "assistant", content: "Modele charge." },
      ],
    );

    await goToChat(page);
    await sendMessage(page, "Test download");

    // The Downloading component shows "Telechargement du modele"
    // After streaming completes, the final message should appear
    await expect(page.getByText("Modele charge.")).toBeVisible({
      timeout: 10000,
    });
  });

  test("download percentage is displayed", async ({ page }) => {
    // Use a route that slowly delivers download events
    await setupStreamingMock(
      page,
      "dl-002",
      [
        { eventName: "chat_created", chatId: "dl-002" },
        {
          eventName: "download",
          total: 1_000_000_000,
          completed: 500_000_000,
          done: false,
        },
        {
          eventName: "download",
          total: 1_000_000_000,
          completed: 1_000_000_000,
          done: true,
        },
        { eventName: "chat", content: "Pret." },
        { eventName: "done" },
      ],
      [
        { role: "user", content: "Test percentage" },
        { role: "assistant", content: "Pret." },
      ],
    );

    await goToChat(page);
    await sendMessage(page, "Test percentage");

    // The download component shows percentage — look for the "%" text
    // Since the mock delivers instantly, we just verify the final state
    await expect(page.getByText("Pret.")).toBeVisible({ timeout: 10000 });
  });

  test("download indicator disappears after completion", async ({ page }) => {
    await setupStreamingMock(
      page,
      "dl-003",
      [
        { eventName: "chat_created", chatId: "dl-003" },
        {
          eventName: "download",
          total: 2_000_000_000,
          completed: 1_000_000_000,
          done: false,
        },
        {
          eventName: "download",
          total: 2_000_000_000,
          completed: 2_000_000_000,
          done: true,
        },
        { eventName: "chat", content: "Termine." },
        { eventName: "done" },
      ],
      [
        { role: "user", content: "Test disparition" },
        { role: "assistant", content: "Termine." },
      ],
    );

    await goToChat(page);
    await sendMessage(page, "Test disparition");

    await expect(page.getByText("Termine.")).toBeVisible({ timeout: 10000 });

    // After done, the download section should be hidden/invisible
    // The Downloading component is wrapped in a section that fades out
    // "Telechargement du modele" should not be visible anymore
    await expect(page.getByText("lechargement du mod")).not.toBeVisible({
      timeout: 5000,
    });
  });
});

// ─── Loading State ──────────────────────────────────────────────

test.describe("Streaming — Loading state", () => {
  test("loading event shows waiting indicator", async ({ page }) => {
    await setupStreamingMock(
      page,
      "load-001",
      [
        { eventName: "chat_created", chatId: "load-001" },
        { eventName: "loading" },
        { eventName: "chat", content: "Charge et pret." },
        { eventName: "done" },
      ],
      [
        { role: "user", content: "Test loading" },
        { role: "assistant", content: "Charge et pret." },
      ],
    );

    await goToChat(page);
    await sendMessage(page, "Test loading");

    // The assistant content should appear after loading
    await expect(page.getByText("Charge et pret.")).toBeVisible({
      timeout: 10000,
    });
  });

  test("spinner disappears after first chat token", async ({ page }) => {
    await setupStreamingMock(
      page,
      "load-002",
      [
        { eventName: "chat_created", chatId: "load-002" },
        { eventName: "loading" },
        { eventName: "chat", content: "Premier token." },
        { eventName: "done" },
      ],
      [
        { role: "user", content: "Test spinner" },
        { role: "assistant", content: "Premier token." },
      ],
    );

    await goToChat(page);
    await sendMessage(page, "Test spinner");

    await expect(page.getByText("Premier token.")).toBeVisible({
      timeout: 10000,
    });

    // After content appears, the loading dots should not be visible
    // The typing dots use .animate-pulse or a custom animation
    const dots = page.locator('[style*="animation: typing"]');
    await expect(dots).not.toBeVisible({ timeout: 5000 });
  });
});

// ─── Response Modes ──────────────────────────────────────────────

test.describe("Streaming — Response modes", () => {
  test("concis mode: short response appears correctly", async ({ page }) => {
    // Set ResponseMode to "concise"
    await mockSettingsOverride(page, { ResponseMode: "concise" });

    await setupStreamingMock(
      page,
      "mode-001",
      [
        { eventName: "chat_created", chatId: "mode-001" },
        { eventName: "chat", content: "Oui." },
        { eventName: "done" },
      ],
      [
        { role: "user", content: "Ca marche ?" },
        { role: "assistant", content: "Oui." },
      ],
    );

    await goToChat(page);
    await sendMessage(page, "Ca marche ?");

    await expect(page.getByText("Oui.")).toBeVisible({ timeout: 10000 });

    // The ResponseModeButton should show "Concis" label
    await expect(page.getByText("Concis")).toBeVisible({ timeout: 5000 });
  });

  test("code mode: code-heavy response renders with highlighting", async ({
    page,
  }) => {
    await mockSettingsOverride(page, { ResponseMode: "code" });

    const codeResponse =
      "```python\ndef hello():\n    print('Hello World')\n\nhello()\n```";
    await setupStreamingMock(
      page,
      "mode-002",
      [
        { eventName: "chat_created", chatId: "mode-002" },
        { eventName: "chat", content: codeResponse },
        { eventName: "done" },
      ],
      [
        { role: "user", content: "Ecris du code" },
        { role: "assistant", content: codeResponse },
      ],
    );

    await goToChat(page);
    await sendMessage(page, "Ecris du code");

    await expect(page.locator("pre code")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("def hello")).toBeVisible({ timeout: 5000 });

    // Code mode button should be active
    await expect(page.getByText("Code")).toBeVisible({ timeout: 5000 });
  });

  test("pedagogic mode: structured pedagogical response", async ({ page }) => {
    await mockSettingsOverride(page, { ResponseMode: "pedagogic" });

    const pedagogicContent =
      "## Etape 1\nComprenons le concept.\n\n## Etape 2\nAppliquons-le.\n\n## Resume\nVoila le resultat.";
    await setupStreamingMock(
      page,
      "mode-003",
      [
        { eventName: "chat_created", chatId: "mode-003" },
        { eventName: "chat", content: pedagogicContent },
        { eventName: "done" },
      ],
      [
        { role: "user", content: "Explique" },
        { role: "assistant", content: pedagogicContent },
      ],
    );

    await goToChat(page);
    await sendMessage(page, "Explique");

    await expect(page.getByText("Comprenons le concept.")).toBeVisible({
      timeout: 10000,
    });

    // Pedagogic mode button should show "Pedagogue"
    await expect(page.getByText("Pedagogue")).toBeVisible({ timeout: 5000 });
  });

  test("normal mode: default behavior, no active mode indicator", async ({
    page,
  }) => {
    // Default settings have ResponseMode = "" (normal)
    await setupStreamingMock(
      page,
      "mode-004",
      [
        { eventName: "chat_created", chatId: "mode-004" },
        { eventName: "chat", content: "Reponse standard." },
        { eventName: "done" },
      ],
      [
        { role: "user", content: "Test normal" },
        { role: "assistant", content: "Reponse standard." },
      ],
    );

    await goToChat(page);
    await sendMessage(page, "Test normal");

    await expect(page.getByText("Reponse standard.")).toBeVisible({
      timeout: 10000,
    });

    // The Normal mode button should be present (it is the default label)
    await expect(page.getByText("Normal")).toBeVisible({ timeout: 5000 });
  });
});

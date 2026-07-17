/**
 * Shared E2E test helpers for Dromadaire v6.
 *
 * Provides mock data factories, streaming helpers, and common interaction
 * utilities used across all E2E spec files.
 *
 * IMPORTANT: Always import { test, expect } from "./fixtures" — NOT from here.
 * This file only exports helper functions and mock data constants.
 */

import type { Page } from "@playwright/test";

// ─── Mock Data Constants ──────────────────────────────────────────────

export const MOCK_MODELS_LIST = [
  {
    name: "gemma3:4b",
    model: "gemma3:4b",
    digest: "abc123def456",
    modified_at: "2025-01-15T10:00:00Z",
    size: 2_500_000_000,
    details: { families: ["gemma"], parameter_size: "4B", quantization_level: "Q4_K_M" },
  },
  {
    name: "llama3.2:3b",
    model: "llama3.2:3b",
    digest: "789ghi012jkl",
    modified_at: "2025-01-10T08:00:00Z",
    size: 1_800_000_000,
    details: { families: ["llama"], parameter_size: "3B", quantization_level: "Q4_0" },
  },
  {
    name: "deepseek-coder:6.7b",
    model: "deepseek-coder:6.7b",
    digest: "mno345pqr678",
    modified_at: "2025-01-05T12:00:00Z",
    size: 3_800_000_000,
    details: { families: ["deepseek"], parameter_size: "6.7B", quantization_level: "Q4_K_M" },
  },
];

export const MOCK_CHATS_LIST = [
  {
    id: "chat-001",
    title: "Conversation recente",
    created_at: "2025-02-20T14:00:00Z",
    updated_at: "2025-02-20T15:30:00Z",
    pinned: false,
    folder: "",
  },
  {
    id: "chat-002",
    title: "Projet important",
    created_at: "2025-02-18T09:00:00Z",
    updated_at: "2025-02-19T17:00:00Z",
    pinned: true,
    folder: "",
  },
  {
    id: "chat-003",
    title: "Discussion code",
    created_at: "2025-02-15T11:00:00Z",
    updated_at: "2025-02-15T12:00:00Z",
    pinned: false,
    folder: "Travail",
  },
  {
    id: "chat-004",
    title: "Notes personnelles",
    created_at: "2025-02-10T08:00:00Z",
    updated_at: "2025-02-10T08:30:00Z",
    pinned: false,
    folder: "Personnel",
  },
  {
    id: "chat-005",
    title: "Debug session",
    created_at: "2025-02-01T16:00:00Z",
    updated_at: "2025-02-01T18:00:00Z",
    pinned: true,
    folder: "Travail",
  },
];

export const MOCK_MESSAGES = {
  simple: [
    { role: "user", content: "Bonjour" },
    { role: "assistant", content: "Bonjour ! Comment puis-je vous aider ?" },
  ],
  multiTurn: [
    { role: "user", content: "Qu'est-ce que TypeScript ?" },
    { role: "assistant", content: "TypeScript est un langage de programmation..." },
    { role: "user", content: "Montre-moi un exemple" },
    { role: "assistant", content: '```typescript\nconst greet = (name: string): string => {\n  return `Hello, ${name}!`;\n};\n```' },
  ],
  withThinking: [
    { role: "user", content: "Explique la recursion" },
    { role: "assistant", content: "La recursion est une technique...", thinking: "Analysons la recursion etape par etape..." },
  ],
  withModel: [
    { role: "user", content: "Test" },
    { role: "assistant", content: "Reponse du modele", model: { name: "gemma3:4b", model: "gemma3:4b" } },
  ],
};

export const MOCK_RAG_DOCUMENTS = [
  {
    id: "doc-001",
    filename: "rapport-annuel.pdf",
    size: 2_500_000,
    status: "ready",
    progress: 100,
    chunks_count: 45,
    created_at: "2025-02-15T10:00:00Z",
    hash: "abc123",
  },
  {
    id: "doc-002",
    filename: "notes-reunion.txt",
    size: 15_000,
    status: "ready",
    progress: 100,
    chunks_count: 3,
    created_at: "2025-02-18T14:00:00Z",
    hash: "def456",
  },
  {
    id: "doc-003",
    filename: "documentation.md",
    size: 85_000,
    status: "processing",
    progress: 60,
    chunks_count: 12,
    created_at: "2025-02-20T09:00:00Z",
    hash: "ghi789",
  },
];

// ─── Streaming Helpers ──────────────────────────────────────────────

/**
 * Sets up a complete streaming mock: model list + chat POST (NDJSON) + chat GET.
 * Extracted from streaming-complex.spec.ts for reuse across all specs.
 *
 * @param page - Playwright page
 * @param chatId - The chat ID returned by the chat_created event
 * @param events - Array of NDJSON event objects (eventName: "chat_created" | "chat" | "thinking" | "done" | "error" | etc.)
 * @param finalMessages - Messages returned by GET /api/v1/chat/:id after streaming
 * @param chatTitle - Optional title for the chat (default: "Test Chat")
 */
export async function setupStreamingMock(
  page: Page,
  chatId: string,
  events: Record<string, unknown>[],
  finalMessages: Record<string, unknown>[],
  chatTitle = "Test Chat",
) {
  // Model list — override the fixtures.ts mock (LIFO priority)
  await page.route("**/api/tags", (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ models: MOCK_MODELS_LIST }),
    });
  });

  // Chat POST → NDJSON stream
  await page.route("**/api/v1/chat/new", (route) => {
    if (route.request().method() === "POST") {
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
        body: JSON.stringify({ chat: null, messages: [] }),
      });
    }
  });

  // Chat GET (after navigation to created chat)
  await page.route(`**/api/v1/chat/${chatId}`, (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        chat: { id: chatId, title: chatTitle, messages: finalMessages },
        messages: [],
      }),
    });
  });
}

/**
 * Override the models mock to return a specific list of models.
 */
export async function setupModels(page: Page, models = MOCK_MODELS_LIST) {
  await page.route("**/api/tags", (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ models }),
    });
  });
}

/**
 * Override the chats list mock to return specific chats.
 */
export async function setupChatsWithHistory(
  page: Page,
  chats: Record<string, unknown>[],
) {
  await page.route("**/api/v1/chats", (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ chats }),
    });
  });
}

/**
 * Override the single chat mock to return specific messages.
 */
export async function setupChatWithMessages(
  page: Page,
  chatId: string,
  messages: Record<string, unknown>[],
  title = "Test Chat",
) {
  await page.route(`**/api/v1/chat/${chatId}`, (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        chat: { id: chatId, title, messages },
        messages: [],
      }),
    });
  });
}

/**
 * Mock auth status with password enabled and locked state.
 */
export async function setupPasswordEnabled(
  page: Page,
  options: { locked?: boolean; attemptsLeft?: number } = {},
) {
  const { locked = true, attemptsLeft = 3 } = options;
  await page.route("**/api/v1/auth/status", (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        passwordEnabled: true,
        locked,
        attemptsLeft,
      }),
    });
  });
}

/**
 * Mock RAG documents endpoint with specific documents.
 */
export async function setupRAGDocuments(
  page: Page,
  documents = MOCK_RAG_DOCUMENTS,
) {
  await page.route("**/api/v1/rag/documents", (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(documents),
    });
  });
}

// ─── Settings Helpers ──────────────────────────────────────────────

/**
 * POST settings overrides then reload the page so the app reads updated settings.
 * The stateful mock in fixtures.ts merges POST data and subsequent GETs return it.
 */
export async function mockSettingsOverride(
  page: Page,
  overrides: Record<string, unknown>,
) {
  await page.evaluate(async (settings) => {
    await fetch("/api/v1/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
  }, overrides);

  await page.reload();
  await page.waitForLoadState("domcontentloaded");
}

// ─── Interaction Helpers ──────────────────────────────────────────

/**
 * Type a message in the textarea and press Enter to send it.
 * Waits for the textarea to be visible first.
 */
export async function sendMessage(page: Page, text: string) {
  const textarea = page.locator("textarea");
  await textarea.waitFor({ state: "visible", timeout: 15000 });
  await textarea.fill(text);
  await textarea.press("Enter");
}

/**
 * Wait for streaming to complete (no more loading indicators).
 */
export async function waitForStreamingDone(page: Page, timeout = 10000) {
  // Wait until the loading/spinner indicator disappears
  const spinner = page.locator('[data-streaming="true"], .animate-pulse, .animate-spin').first();
  try {
    await spinner.waitFor({ state: "hidden", timeout });
  } catch {
    // Spinner might never appear if streaming is very fast
  }
}

/**
 * Navigate to home and wait for the chat interface to be ready.
 */
export async function goToChat(page: Page) {
  await page.goto("/");
  await page.locator("textarea").waitFor({ state: "visible", timeout: 15000 });
}

/**
 * Navigate to settings and wait for the page to be ready.
 */
export async function goToSettings(page: Page) {
  await page.goto("/settings");
  await page.waitForLoadState("domcontentloaded");
  await page.locator("h1").waitFor({ state: "visible", timeout: 15000 });
}

/**
 * Navigate to knowledge page and wait for the page to be ready.
 */
export async function goToKnowledge(page: Page) {
  await page.goto("/knowledge");
  await page.waitForLoadState("domcontentloaded");
  await page.locator("h1").waitFor({ state: "visible", timeout: 15000 });
}

/**
 * Navigate to about page and wait for the page to be ready.
 */
export async function goToAbout(page: Page) {
  await page.goto("/about");
  await page.waitForLoadState("domcontentloaded");
  await page.locator("h1").waitFor({ state: "visible", timeout: 15000 });
}

/**
 * Setup a mock for intercepting POST requests and capturing payloads.
 * Returns a function that retrieves the captured payloads.
 */
export async function capturePostRequests(
  page: Page,
  urlPattern: string,
  responseBody: unknown = { ok: true },
) {
  const payloads: unknown[] = [];

  await page.route(urlPattern, (route) => {
    if (route.request().method() === "POST") {
      try {
        payloads.push(route.request().postDataJSON());
      } catch {
        payloads.push(route.request().postData());
      }
    }
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(responseBody),
    });
  });

  return () => payloads;
}

/**
 * Setup search results mock.
 */
export async function setupSearchResults(
  page: Page,
  results: Array<{ chatId: string; title: string; snippet: string }>,
) {
  await page.route("**/api/v1/search**", (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results }),
    });
  });
}

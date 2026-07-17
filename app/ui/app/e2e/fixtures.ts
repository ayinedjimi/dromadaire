import { test as base, type Page } from "@playwright/test";

/**
 * Mock API responses for E2E tests.
 * Without the Go backend, the app can't fetch settings/chats/models,
 * so we intercept all API calls and return sensible defaults.
 *
 * The settings mock is STATEFUL: POST updates are merged so that
 * subsequent GETs return the updated values (needed for theme tests).
 */

const DEFAULT_SETTINGS = {
  Expose: false,
  Browser: false,
  Survey: false,
  Models: "",
  Agent: false,
  Tools: false,
  WorkingDir: "",
  ContextLength: 4096,
  AirplaneMode: false,
  TurboEnabled: false,
  WebSearchEnabled: false,
  ThinkEnabled: false,
  ThinkLevel: "none",
  SelectedModel: "llama3.2:3b",
  SidebarOpen: true,
  EncryptionEnabled: false,
  RAGEnabled: false,
  EmbeddingModel: "snowflake-arctic-embed:33m",
  PasswordEnabled: false,
  AutoDeleteOnFailure: false,
  LockTimeoutMinutes: 0,
  AutoDeleteDays: 0,
  ClipboardClearSeconds: 30,
  SearchEnabled: true,
  RAGCitationsEnabled: true,
  RAGPreviewEnabled: true,
  ArtifactsEnabled: true, // default changed to true in schema v19
  Theme: "dark",
  KeyboardShortcutsEnabled: true,
  NumThread: 0,
  KeepAlive: "",
  MaxLoadedModels: 0,
  KVCacheType: "",
  NumBatch: 0,
  VulkanEnabled: false,
  PortableMode: false,
};

const MOCK_AUTH_STATUS = {
  passwordEnabled: false,
  locked: false,
};

const MOCK_CHATS = {
  chats: [],
};

const MOCK_VERSION = {
  version: "3.0.0",
};

const MOCK_INFERENCE_COMPUTE = {
  inferenceComputes: [],
};

const MOCK_MODELS = {
  models: [],
};

const MOCK_USER = {
  display_name: "",
  email: "",
};

/**
 * Sets up API mocking on a Playwright page.
 * Intercepts all calls to the Go backend (127.0.0.1:3001) and
 * the Ollama client API (tags endpoint).
 */
export async function setupApiMocks(page: Page) {
  // Stateful settings — POST merges updates, GET returns latest
  let currentSettings = { ...DEFAULT_SETTINGS };

  // Mock all API calls to the Go backend
  await page.route("**/api/v1/settings", (route) => {
    if (route.request().method() === "GET") {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ settings: currentSettings }),
      });
    } else {
      // POST — merge the incoming settings
      try {
        const body = route.request().postDataJSON();
        if (body) {
          currentSettings = { ...currentSettings, ...body };
        }
      } catch {
        // ignore parse errors
      }
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ settings: currentSettings }),
      });
    }
  });

  await page.route("**/api/v1/auth/status", (route) => {
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_AUTH_STATUS) });
  });

  await page.route("**/api/v1/chats", (route) => {
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_CHATS) });
  });

  await page.route("**/api/version", (route) => {
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_VERSION) });
  });

  await page.route("**/api/v1/inference-compute", (route) => {
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_INFERENCE_COMPUTE) });
  });

  await page.route("**/api/v1/models/**", (route) => {
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });

  await page.route("**/api/v1/search**", (route) => {
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: [] }) });
  });

  await page.route("**/api/v1/chat/**", (route) => {
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ chat: null, messages: [] }) });
  });

  // RAG endpoints: getRAGDocuments() returns a raw array via response.json()
  // Playwright matches routes LIFO, so register the generic catch-all FIRST,
  // then the specific /documents route LAST (higher priority).
  await page.route("**/api/v1/rag/**", (route) => {
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ chunks: [] }) });
  });

  await page.route("**/api/v1/rag/documents", (route) => {
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
  });

  await page.route("**/api/v1/encryption-key", (route) => {
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ key: "", path: "" }) });
  });

  // Ollama client uses /api/tags to list models
  await page.route("**/api/tags", (route) => {
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_MODELS) });
  });

  // Ollama client /api/show
  await page.route("**/api/show", (route) => {
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) });
  });

  // Ollama client /api/generate (warmup)
  await page.route("**/api/generate", (route) => {
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ done: true }) });
  });

  // User/auth endpoints
  await page.route("**/api/me", (route) => {
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_USER) });
  });

  await page.route("**/api/signout", (route) => {
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
}

/**
 * Custom test fixture that auto-mocks API before each test.
 * Also sets navigator.platform to "Win32" so the app renders
 * Windows-specific UI (Settings, Knowledge, About links).
 */
export const test = base.extend({
  page: async ({ browser }, use) => {
    // Create a context with Windows user agent so navigator.platform = "Win32"
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      viewport: { width: 1024, height: 720 },
    });
    const page = await context.newPage();

    // Override navigator.platform to "Win32" (userAgent alone doesn't set it)
    // Must override on Navigator.prototype, not the navigator instance
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, "platform", {
        get: () => "Win32",
        configurable: true,
      });
    });

    await setupApiMocks(page);
    await use(page);
    await context.close();
  },
});

export { expect } from "@playwright/test";

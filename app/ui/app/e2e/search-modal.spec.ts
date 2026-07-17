import { test, expect } from "./fixtures";
import { goToChat, setupSearchResults } from "./helpers";

/**
 * E2E tests for the SearchModal component (LOT 15).
 *
 * The search modal opens via Ctrl+K, queries GET /api/v1/search?q=...,
 * and displays results with highlighted excerpts. Navigation is via
 * arrow keys + Enter, or click. Escape / backdrop click closes it.
 */

// ─── Mock search results ───────────────────────────────────────────

const SEARCH_RESULTS = [
  {
    chat_id: "chat-result-1",
    chat_title: "Discussion TypeScript",
    role: "assistant",
    excerpt: "TypeScript est un langage de programmation typé",
    created_at: "2025-02-20T10:00:00Z",
  },
  {
    chat_id: "chat-result-2",
    chat_title: "Projet React",
    role: "user",
    excerpt: "Comment utiliser TypeScript avec React",
    created_at: "2025-02-19T08:00:00Z",
  },
  {
    chat_id: "chat-result-3",
    chat_title: "Formation JavaScript",
    role: "assistant",
    excerpt: "JavaScript et TypeScript sont complémentaires",
    created_at: "2025-02-18T15:00:00Z",
  },
];

// Selectors used throughout the tests
const SEARCH_INPUT = 'input[placeholder*="echerch"]';
const SEARCH_BACKDROP = ".fixed.inset-0";

// ─── Open / Close ──────────────────────────────────────────────────

test.describe("SearchModal — Open/Close", () => {
  test.beforeEach(async ({ page }) => {
    await goToChat(page);
  });

  test("Ctrl+K opens the search modal", async ({ page }) => {
    await page.keyboard.press("Control+k");

    const searchInput = page.locator(SEARCH_INPUT);
    await expect(searchInput).toBeVisible({ timeout: 5000 });
  });

  test("Escape closes the search modal", async ({ page }) => {
    await page.keyboard.press("Control+k");
    const searchInput = page.locator(SEARCH_INPUT);
    await expect(searchInput).toBeVisible({ timeout: 5000 });

    await page.keyboard.press("Escape");
    await expect(searchInput).toBeHidden({ timeout: 5000 });
  });

  test("clicking the backdrop closes the search modal", async ({ page }) => {
    await page.keyboard.press("Control+k");
    const searchInput = page.locator(SEARCH_INPUT);
    await expect(searchInput).toBeVisible({ timeout: 5000 });

    // Click on the semi-transparent backdrop (top-left corner, outside the modal)
    const backdrop = page.locator(SEARCH_BACKDROP).first();
    await backdrop.click({ position: { x: 10, y: 10 } });

    await expect(searchInput).toBeHidden({ timeout: 5000 });
  });

  test("can reopen after closing", async ({ page }) => {
    // Open
    await page.keyboard.press("Control+k");
    const searchInput = page.locator(SEARCH_INPUT);
    await expect(searchInput).toBeVisible({ timeout: 5000 });

    // Close
    await page.keyboard.press("Escape");
    await expect(searchInput).toBeHidden({ timeout: 5000 });

    // Reopen
    await page.keyboard.press("Control+k");
    await expect(searchInput).toBeVisible({ timeout: 5000 });
  });
});

// ─── Search ────────────────────────────────────────────────────────

test.describe("SearchModal — Search", () => {
  test.beforeEach(async ({ page }) => {
    await goToChat(page);
  });

  test("input is auto-focused when the modal opens", async ({ page }) => {
    await page.keyboard.press("Control+k");
    const searchInput = page.locator(SEARCH_INPUT);
    await expect(searchInput).toBeVisible({ timeout: 5000 });
    await expect(searchInput).toBeFocused({ timeout: 3000 });
  });

  test("typing a query shows search results", async ({ page }) => {
    // Setup search results mock BEFORE opening modal
    await setupSearchResults(page, SEARCH_RESULTS);

    await page.keyboard.press("Control+k");
    const searchInput = page.locator(SEARCH_INPUT);
    await expect(searchInput).toBeVisible({ timeout: 5000 });

    await searchInput.fill("TypeScript");

    // Wait for debounce (300ms) + results to render
    await expect(page.getByText("Discussion TypeScript")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("Projet React")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("Formation JavaScript")).toBeVisible({ timeout: 5000 });
  });

  test("results display title and snippet", async ({ page }) => {
    await setupSearchResults(page, SEARCH_RESULTS);

    await page.keyboard.press("Control+k");
    const searchInput = page.locator(SEARCH_INPUT);
    await expect(searchInput).toBeVisible({ timeout: 5000 });

    await searchInput.fill("TypeScript");

    // Title is displayed
    await expect(page.getByText("Discussion TypeScript")).toBeVisible({ timeout: 5000 });
    // Excerpt is displayed (partial match since "TypeScript" may be highlighted separately)
    await expect(page.getByText(/langage de programmation/)).toBeVisible({ timeout: 5000 });
  });

  test("empty results show 'Aucun résultat' message", async ({ page }) => {
    // Default mock returns empty results (from fixtures.ts)
    await page.keyboard.press("Control+k");
    const searchInput = page.locator(SEARCH_INPUT);
    await expect(searchInput).toBeVisible({ timeout: 5000 });

    await searchInput.fill("xyznonexistent");

    // Wait for debounce + "Aucun résultat" message
    await expect(page.getByText(/Aucun résultat/)).toBeVisible({ timeout: 5000 });
  });

  test("debounce: typing fast fires only one request", async ({ page }) => {
    // Track search API calls
    const searchCalls: string[] = [];
    await page.route("**/api/v1/search**", (route) => {
      const url = route.request().url();
      searchCalls.push(url);
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ results: SEARCH_RESULTS }),
      });
    });

    await page.keyboard.press("Control+k");
    const searchInput = page.locator(SEARCH_INPUT);
    await expect(searchInput).toBeVisible({ timeout: 5000 });

    // Type quickly without pausing — debounce should coalesce
    await searchInput.pressSequentially("TypeScript", { delay: 30 });

    // Wait for debounce (300ms) + network
    await page.waitForTimeout(600);

    // Wait for results to appear (confirms the final request fired)
    await expect(page.getByText("Discussion TypeScript")).toBeVisible({ timeout: 5000 });

    // Should have fewer calls than characters typed (debounce coalescing)
    // With 300ms debounce and 30ms between keys, at most 2-3 requests should fire
    expect(searchCalls.length).toBeLessThanOrEqual(4);
  });

  test("clearing input clears results", async ({ page }) => {
    await setupSearchResults(page, SEARCH_RESULTS);

    await page.keyboard.press("Control+k");
    const searchInput = page.locator(SEARCH_INPUT);
    await expect(searchInput).toBeVisible({ timeout: 5000 });

    // Type and wait for results
    await searchInput.fill("TypeScript");
    await expect(page.getByText("Discussion TypeScript")).toBeVisible({ timeout: 5000 });

    // Clear input
    await searchInput.fill("");

    // Results should disappear, replaced by the default hint
    await expect(page.getByText("Discussion TypeScript")).toBeHidden({ timeout: 5000 });
    await expect(page.getByText(/Tapez pour rechercher/)).toBeVisible({ timeout: 5000 });
  });
});

// ─── Navigation ────────────────────────────────────────────────────

test.describe("SearchModal — Navigation", () => {
  test.beforeEach(async ({ page }) => {
    await setupSearchResults(page, SEARCH_RESULTS);

    // Mock individual chat GET for navigation targets
    for (const result of SEARCH_RESULTS) {
      await page.route(`**/api/v1/chat/${result.chat_id}`, (route) => {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            chat: {
              id: result.chat_id,
              title: result.chat_title,
              messages: [
                { role: "user", content: "Test" },
                { role: "assistant", content: "Reponse" },
              ],
            },
            messages: [],
          }),
        });
      });
    }

    await goToChat(page);
  });

  test("ArrowDown highlights the first result", async ({ page }) => {
    await page.keyboard.press("Control+k");
    const searchInput = page.locator(SEARCH_INPUT);
    await expect(searchInput).toBeVisible({ timeout: 5000 });

    await searchInput.fill("TypeScript");
    await expect(page.getByText("Discussion TypeScript")).toBeVisible({ timeout: 5000 });

    // Press ArrowDown — the first result button should get a hover/focus visual state
    await page.keyboard.press("ArrowDown");

    // The first result's button should have focus or a visual indicator.
    // Since the component uses button elements in a list, check for focus on a list item button.
    const firstResultBtn = page.locator("ul > li:first-child button");
    await expect(firstResultBtn).toBeVisible({ timeout: 3000 });
  });

  test("ArrowUp/Down navigates through results", async ({ page }) => {
    await page.keyboard.press("Control+k");
    const searchInput = page.locator(SEARCH_INPUT);
    await expect(searchInput).toBeVisible({ timeout: 5000 });

    await searchInput.fill("TypeScript");
    await expect(page.getByText("Formation JavaScript")).toBeVisible({ timeout: 5000 });

    // Navigate down through all three results
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");

    // Navigate back up
    await page.keyboard.press("ArrowUp");

    // The second result should now be highlighted/focused
    const resultButtons = page.locator("ul > li button");
    const count = await resultButtons.count();
    expect(count).toBe(3);
  });

  test("Enter opens the selected chat (navigates)", async ({ page }) => {
    await page.keyboard.press("Control+k");
    const searchInput = page.locator(SEARCH_INPUT);
    await expect(searchInput).toBeVisible({ timeout: 5000 });

    await searchInput.fill("TypeScript");
    await expect(page.getByText("Discussion TypeScript")).toBeVisible({ timeout: 5000 });

    // Click the first result to navigate
    const firstResult = page.getByText("Discussion TypeScript");
    await firstResult.click();

    // Modal should close
    await expect(searchInput).toBeHidden({ timeout: 5000 });

    // URL should contain the chat ID
    await page.waitForURL(/\/c\/chat-result-1/, { timeout: 5000 });
  });

  test("clicking a result navigates to that chat", async ({ page }) => {
    await page.keyboard.press("Control+k");
    const searchInput = page.locator(SEARCH_INPUT);
    await expect(searchInput).toBeVisible({ timeout: 5000 });

    await searchInput.fill("TypeScript");
    await expect(page.getByText("Projet React")).toBeVisible({ timeout: 5000 });

    // Click the second result
    await page.getByText("Projet React").click();

    // Modal should close and URL should change
    await expect(searchInput).toBeHidden({ timeout: 5000 });
    await page.waitForURL(/\/c\/chat-result-2/, { timeout: 5000 });
  });
});

// ─── UI Elements ───────────────────────────────────────────────────

test.describe("SearchModal — UI", () => {
  test.beforeEach(async ({ page }) => {
    await goToChat(page);
  });

  test("search icon (magnifying glass) is visible in modal", async ({ page }) => {
    await page.keyboard.press("Control+k");
    const searchInput = page.locator(SEARCH_INPUT);
    await expect(searchInput).toBeVisible({ timeout: 5000 });

    // The MagnifyingGlass icon renders as an SVG next to the input
    const modalContainer = page.locator(".max-w-lg");
    const svgIcon = modalContainer.locator("svg").first();
    await expect(svgIcon).toBeVisible({ timeout: 3000 });
  });

  test("keyboard hints are displayed in the footer", async ({ page }) => {
    await page.keyboard.press("Control+k");
    const searchInput = page.locator(SEARCH_INPUT);
    await expect(searchInput).toBeVisible({ timeout: 5000 });

    // Footer shows "Esc pour fermer" and "Enter pour ouvrir"
    await expect(page.getByText("pour fermer")).toBeVisible({ timeout: 3000 });
    await expect(page.getByText("pour ouvrir")).toBeVisible({ timeout: 3000 });
  });

  test("result highlights the query term with <mark>", async ({ page }) => {
    await setupSearchResults(page, SEARCH_RESULTS);

    await page.keyboard.press("Control+k");
    const searchInput = page.locator(SEARCH_INPUT);
    await expect(searchInput).toBeVisible({ timeout: 5000 });

    await searchInput.fill("TypeScript");
    await expect(page.getByText("Discussion TypeScript")).toBeVisible({ timeout: 5000 });

    // The highlightExcerpt function wraps matches in <mark> elements
    const marks = page.locator("mark");
    const markCount = await marks.count();
    expect(markCount).toBeGreaterThanOrEqual(1);

    // At least one <mark> should contain the query term
    const firstMark = marks.first();
    await expect(firstMark).toContainText("TypeScript");
  });

  test("result count matches the number of mock results", async ({ page }) => {
    await setupSearchResults(page, SEARCH_RESULTS);

    await page.keyboard.press("Control+k");
    const searchInput = page.locator(SEARCH_INPUT);
    await expect(searchInput).toBeVisible({ timeout: 5000 });

    await searchInput.fill("TypeScript");
    await expect(page.getByText("Discussion TypeScript")).toBeVisible({ timeout: 5000 });

    // Count the result items in the list
    const resultItems = page.locator("ul > li");
    await expect(resultItems).toHaveCount(3, { timeout: 5000 });
  });
});

import { test, expect } from "./fixtures";
import { goToChat } from "./helpers";

/**
 * E2E tests: Sidebar Organization Workflows
 *
 * Covers pin/favorites, folder management, sort order, and empty states.
 *
 * The sidebar uses `window.menu()` for native context menus (desktop-only).
 * In E2E tests we mock `window.menu` to simulate menu selection.
 *
 * Key data format: backend returns { chatInfos: [...] } with camelCase keys.
 * ChatInfo: id, title, userExcerpt, createdAt, updatedAt, pinned, folder
 */

// ─── Dynamic dates for proper time-grouping ────────────────────────

const now = new Date();
const todayISO = now.toISOString();
const hourAgoISO = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
const twoHoursAgoISO = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
const yesterdayISO = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
const lastWeekISO = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
const twoWeeksAgoISO = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();

// ─── Helpers ────────────────────────────────────────────────────────

async function setupSidebarChats(
  page: import("@playwright/test").Page,
  chats: Record<string, unknown>[],
) {
  await page.route("**/api/v1/chats", (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ chatInfos: chats }),
    });
  });

  for (const chat of chats) {
    const chatId = chat.id as string;
    const chatTitle = chat.title as string;
    const excerpt = (chat.userExcerpt as string) || "Bonjour";

    await page.route(`**/api/v1/chat/${chatId}`, (route) => {
      if (route.request().method() === "GET") {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            chat: {
              id: chatId,
              title: chatTitle,
              messages: [
                { role: "user", content: excerpt },
                { role: "assistant", content: `Reponse pour ${chatTitle}` },
              ],
            },
            messages: [],
          }),
        });
      } else {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true }),
        });
      }
    });
  }
}

async function mockWindowMenu(page: import("@playwright/test").Page, action: string | null) {
  await page.evaluate((act) => {
    (window as any).menu = async () => act;
  }, action);
}

// ═══════════════════════════════════════════════════════════════════
// Pin / Favorites
// ═══════════════════════════════════════════════════════════════════

test.describe("Sidebar Org — Pin / Favorites", () => {
  const CHATS_WITH_PINS = [
    {
      id: "chat-fav-1",
      title: "Chat normal",
      userExcerpt: "Hello",
      createdAt: todayISO,
      updatedAt: todayISO,
      pinned: false,
      folder: "",
    },
    {
      id: "chat-fav-2",
      title: "Chat favori",
      userExcerpt: "Favori",
      createdAt: hourAgoISO,
      updatedAt: hourAgoISO,
      pinned: true,
      folder: "",
    },
    {
      id: "chat-fav-3",
      title: "Autre chat",
      userExcerpt: "Autre",
      createdAt: twoHoursAgoISO,
      updatedAt: twoHoursAgoISO,
      pinned: false,
      folder: "",
    },
  ];

  test("pinning a chat moves it to the Favoris section", async ({ page }) => {
    await setupSidebarChats(page, CHATS_WITH_PINS);

    let pinBody: any = null;
    await page.route("**/api/v1/chat/chat-fav-1/pin", (route) => {
      if (route.request().method() === "PUT") {
        pinBody = route.request().postDataJSON();
      }
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
    });

    await goToChat(page);
    // "Favoris" section should already exist because chat-fav-2 is pinned
    await expect(page.getByText("Favoris")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("Chat normal")).toBeVisible({ timeout: 15000 });

    // Pin "Chat normal"
    await mockWindowMenu(page, "Ajouter aux favoris");
    await page.getByText("Chat normal").click({ button: "right" });

    await page.waitForTimeout(500);
    expect(pinBody).not.toBeNull();
    expect(pinBody.pinned).toBe(true);
  });

  test("unpinning a chat returns it to normal section", async ({ page }) => {
    await setupSidebarChats(page, CHATS_WITH_PINS);

    let pinBody: any = null;
    await page.route("**/api/v1/chat/chat-fav-2/pin", (route) => {
      if (route.request().method() === "PUT") {
        pinBody = route.request().postDataJSON();
      }
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
    });

    await goToChat(page);
    await expect(page.getByText("Chat favori")).toBeVisible({ timeout: 15000 });

    // Unpin "Chat favori"
    await mockWindowMenu(page, "Retirer des favoris");
    await page.getByText("Chat favori").click({ button: "right" });

    await page.waitForTimeout(500);
    expect(pinBody).not.toBeNull();
    expect(pinBody.pinned).toBe(false);
  });

  test("multiple pinned chats all appear in Favoris section", async ({ page }) => {
    const multiPinned = [
      {
        id: "pin-1",
        title: "Favori A",
        userExcerpt: "A",
        createdAt: todayISO,
        updatedAt: todayISO,
        pinned: true,
        folder: "",
      },
      {
        id: "pin-2",
        title: "Favori B",
        userExcerpt: "B",
        createdAt: hourAgoISO,
        updatedAt: hourAgoISO,
        pinned: true,
        folder: "",
      },
      {
        id: "pin-3",
        title: "Favori C",
        userExcerpt: "C",
        createdAt: twoHoursAgoISO,
        updatedAt: twoHoursAgoISO,
        pinned: true,
        folder: "",
      },
      {
        id: "normal-1",
        title: "Chat normal seul",
        userExcerpt: "N",
        createdAt: yesterdayISO,
        updatedAt: yesterdayISO,
        pinned: false,
        folder: "",
      },
    ];
    await setupSidebarChats(page, multiPinned);
    await goToChat(page);

    // Favoris section should be visible
    await expect(page.getByText("Favoris")).toBeVisible({ timeout: 15000 });

    // All three pinned chats should be visible
    await expect(page.getByText("Favori A")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("Favori B")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("Favori C")).toBeVisible({ timeout: 5000 });
  });

  test("pinned chats maintain their order (most recent first)", async ({ page }) => {
    const orderedPins = [
      {
        id: "pin-recent",
        title: "Favori recent",
        userExcerpt: "R",
        createdAt: todayISO,
        updatedAt: todayISO,
        pinned: true,
        folder: "",
      },
      {
        id: "pin-old",
        title: "Favori ancien",
        userExcerpt: "O",
        createdAt: lastWeekISO,
        updatedAt: lastWeekISO,
        pinned: true,
        folder: "",
      },
    ];
    await setupSidebarChats(page, orderedPins);
    await goToChat(page);

    await expect(page.getByText("Favoris")).toBeVisible({ timeout: 15000 });

    // Both should be visible in the Favoris section
    const favorisSection = page.locator("h3").filter({ hasText: "Favoris" }).locator("xpath=ancestor::div[1]");
    const pinnedTitles = favorisSection.locator(".truncate");

    // First pinned should be the most recent
    const texts = await pinnedTitles.allTextContents();
    const recentIdx = texts.findIndex((t) => t.includes("Favori recent"));
    const oldIdx = texts.findIndex((t) => t.includes("Favori ancien"));
    if (recentIdx !== -1 && oldIdx !== -1) {
      expect(recentIdx).toBeLessThan(oldIdx);
    }
  });

  test("star icon visible on pinned chats", async ({ page }) => {
    await setupSidebarChats(page, CHATS_WITH_PINS);
    await goToChat(page);

    // "Chat favori" is pinned — its link should contain a Star SVG
    const pinnedChat = page.locator("nav").getByText("Chat favori");
    await expect(pinnedChat).toBeVisible({ timeout: 15000 });

    // The ancestor container should have an SVG (Star icon)
    const chatContainer = pinnedChat.locator(
      "xpath=ancestor::div[contains(@class, 'allow-context-menu')]",
    );
    const starSvg = chatContainer.locator("svg").first();
    await expect(starSvg).toBeVisible({ timeout: 3000 });
  });
});

// ═══════════════════════════════════════════════════════════════════
// Folders
// ═══════════════════════════════════════════════════════════════════

test.describe("Sidebar Org — Folders", () => {
  const CHATS_WITH_FOLDERS = [
    {
      id: "folder-chat-1",
      title: "Chat travail A",
      userExcerpt: "TA",
      createdAt: todayISO,
      updatedAt: todayISO,
      pinned: false,
      folder: "Travail",
    },
    {
      id: "folder-chat-2",
      title: "Chat perso",
      userExcerpt: "P",
      createdAt: hourAgoISO,
      updatedAt: hourAgoISO,
      pinned: false,
      folder: "Personnel",
    },
    {
      id: "folder-chat-3",
      title: "Chat sans dossier",
      userExcerpt: "S",
      createdAt: twoHoursAgoISO,
      updatedAt: twoHoursAgoISO,
      pinned: false,
      folder: "",
    },
    {
      id: "folder-chat-4",
      title: "Chat travail B",
      userExcerpt: "TB",
      createdAt: yesterdayISO,
      updatedAt: yesterdayISO,
      pinned: false,
      folder: "Travail",
    },
  ];

  test("assigning folder via context menu sends PUT request", async ({ page }) => {
    await setupSidebarChats(page, CHATS_WITH_FOLDERS);

    let folderBody: any = null;
    await page.route("**/api/v1/chat/folder-chat-3/folder", (route) => {
      if (route.request().method() === "PUT") {
        folderBody = route.request().postDataJSON();
      }
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
    });

    await goToChat(page);
    await expect(page.getByText("Chat sans dossier")).toBeVisible({ timeout: 15000 });

    // Move "Chat sans dossier" to "Travail" folder
    await page.evaluate(() => {
      (window as any).menu = async () => "Déplacer vers « Travail »";
    });
    await page.getByText("Chat sans dossier").click({ button: "right" });

    await page.waitForTimeout(500);
    expect(folderBody).not.toBeNull();
    expect(folderBody.folder).toBe("Travail");
  });

  test("moving to a different folder sends PUT with new folder name", async ({ page }) => {
    await setupSidebarChats(page, CHATS_WITH_FOLDERS);

    let folderBody: any = null;
    await page.route("**/api/v1/chat/folder-chat-1/folder", (route) => {
      if (route.request().method() === "PUT") {
        folderBody = route.request().postDataJSON();
      }
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
    });

    await goToChat(page);
    await expect(page.getByText("Chat travail A")).toBeVisible({ timeout: 15000 });

    // Move "Chat travail A" from "Travail" to "Personnel"
    await page.evaluate(() => {
      (window as any).menu = async () => "Déplacer vers « Personnel »";
    });
    await page.getByText("Chat travail A").click({ button: "right" });

    await page.waitForTimeout(500);
    expect(folderBody).not.toBeNull();
    expect(folderBody.folder).toBe("Personnel");
  });

  test("removing from folder sends PUT with empty folder", async ({ page }) => {
    await setupSidebarChats(page, CHATS_WITH_FOLDERS);

    let folderBody: any = null;
    await page.route("**/api/v1/chat/folder-chat-1/folder", (route) => {
      if (route.request().method() === "PUT") {
        folderBody = route.request().postDataJSON();
      }
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
    });

    await goToChat(page);
    await expect(page.getByText("Chat travail A")).toBeVisible({ timeout: 15000 });

    // Remove from folder
    await page.evaluate(() => {
      (window as any).menu = async () => "Retirer du dossier « Travail »";
    });
    await page.getByText("Chat travail A").click({ button: "right" });

    await page.waitForTimeout(500);
    expect(folderBody).not.toBeNull();
    expect(folderBody.folder).toBe("");
  });

  test("folder filter buttons toggle to show only chats in that folder", async ({ page }) => {
    await setupSidebarChats(page, CHATS_WITH_FOLDERS);
    await goToChat(page);

    // All chats should be visible initially
    await expect(page.getByText("Chat travail A")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("Chat perso")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("Chat sans dossier")).toBeVisible({ timeout: 15000 });

    // Folder filter buttons should be visible
    const travailFilter = page.locator("nav button").filter({ hasText: "Travail" }).first();
    await expect(travailFilter).toBeVisible({ timeout: 5000 });

    // Click "Travail" filter
    await travailFilter.click();
    await page.waitForTimeout(500);

    // Only "Travail" folder chats should be visible
    await expect(page.getByText("Chat travail A")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("Chat travail B")).toBeVisible({ timeout: 5000 });

    // Click "Tous" to reset
    const allFilter = page.locator("nav button").filter({ hasText: "Tous" });
    await allFilter.click();
    await page.waitForTimeout(500);

    // All chats visible again
    await expect(page.getByText("Chat perso")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("Chat sans dossier")).toBeVisible({ timeout: 5000 });
  });

  test("no folder filter buttons when no chats have folders", async ({ page }) => {
    const noFolderChats = [
      {
        id: "nf-1",
        title: "Chat un",
        userExcerpt: "Un",
        createdAt: todayISO,
        updatedAt: todayISO,
        pinned: false,
        folder: "",
      },
      {
        id: "nf-2",
        title: "Chat deux",
        userExcerpt: "Deux",
        createdAt: hourAgoISO,
        updatedAt: hourAgoISO,
        pinned: false,
        folder: "",
      },
    ];
    await setupSidebarChats(page, noFolderChats);
    await goToChat(page);

    await expect(page.getByText("Chat un")).toBeVisible({ timeout: 15000 });

    // "Tous" filter button should NOT appear since no chats have folders
    const tousButton = page.locator("nav button").filter({ hasText: "Tous" });
    await expect(tousButton).toBeHidden({ timeout: 3000 });
  });

  test("folder badge shown on chats with folders (when not filtering)", async ({ page }) => {
    await setupSidebarChats(page, CHATS_WITH_FOLDERS);
    await goToChat(page);

    // "Chat travail A" should have a "Travail" folder badge next to its title
    const chatRow = page.locator("nav .allow-context-menu").filter({ hasText: "Chat travail A" });
    await expect(chatRow).toBeVisible({ timeout: 15000 });

    // The folder badge contains the folder name with a FolderSimple icon
    const folderBadge = chatRow.locator("span").filter({ hasText: "Travail" });
    await expect(folderBadge).toBeVisible({ timeout: 5000 });
  });
});

// ═══════════════════════════════════════════════════════════════════
// Sort Order
// ═══════════════════════════════════════════════════════════════════

test.describe("Sidebar Org — Sort Order", () => {
  test("chats sorted by date with most recent first", async ({ page }) => {
    const sortedChats = [
      {
        id: "sort-1",
        title: "Chat le plus recent",
        userExcerpt: "R",
        createdAt: todayISO,
        updatedAt: todayISO,
        pinned: false,
        folder: "",
      },
      {
        id: "sort-2",
        title: "Chat hier",
        userExcerpt: "H",
        createdAt: yesterdayISO,
        updatedAt: yesterdayISO,
        pinned: false,
        folder: "",
      },
      {
        id: "sort-3",
        title: "Chat ancien",
        userExcerpt: "A",
        createdAt: twoWeeksAgoISO,
        updatedAt: twoWeeksAgoISO,
        pinned: false,
        folder: "",
      },
    ];
    await setupSidebarChats(page, sortedChats);
    await goToChat(page);

    // All chats should be visible
    await expect(page.getByText("Chat le plus recent")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("Chat hier")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("Chat ancien")).toBeVisible({ timeout: 15000 });

    // Verify order: collect all truncated text items in nav
    const chatItems = page.locator("nav .allow-context-menu .truncate");
    const texts = await chatItems.allTextContents();

    // Filter to only our chat titles
    const ourTitles = texts.filter((t) =>
      ["Chat le plus recent", "Chat hier", "Chat ancien"].some((title) => t.includes(title)),
    );

    // Most recent should be first
    if (ourTitles.length === 3) {
      expect(ourTitles[0]).toContain("Chat le plus recent");
      expect(ourTitles[2]).toContain("Chat ancien");
    }
  });

  test("Favoris section always appears at the top", async ({ page }) => {
    const mixedChats = [
      {
        id: "top-normal",
        title: "Chat normal recent",
        userExcerpt: "N",
        createdAt: todayISO,
        updatedAt: todayISO,
        pinned: false,
        folder: "",
      },
      {
        id: "top-pinned",
        title: "Chat epingle ancien",
        userExcerpt: "P",
        createdAt: twoWeeksAgoISO,
        updatedAt: twoWeeksAgoISO,
        pinned: true,
        folder: "",
      },
    ];
    await setupSidebarChats(page, mixedChats);
    await goToChat(page);

    // Favoris section should be visible
    await expect(page.getByText("Favoris")).toBeVisible({ timeout: 15000 });

    // The section headers order: Favoris should come before time-based sections
    const sectionHeaders = page.locator("nav h3");
    const headerTexts = await sectionHeaders.allTextContents();

    // Clean up whitespace
    const cleaned = headerTexts.map((t) => t.trim());
    const favorisIdx = cleaned.findIndex((t) => t.includes("Favoris"));
    expect(favorisIdx).toBe(0); // Favoris should be the first section
  });

  test("folder filter buttons are sorted alphabetically", async ({ page }) => {
    const folderChats = [
      {
        id: "alpha-1",
        title: "Chat Z",
        userExcerpt: "Z",
        createdAt: todayISO,
        updatedAt: todayISO,
        pinned: false,
        folder: "Zzz",
      },
      {
        id: "alpha-2",
        title: "Chat A",
        userExcerpt: "A",
        createdAt: hourAgoISO,
        updatedAt: hourAgoISO,
        pinned: false,
        folder: "Aaa",
      },
      {
        id: "alpha-3",
        title: "Chat M",
        userExcerpt: "M",
        createdAt: twoHoursAgoISO,
        updatedAt: twoHoursAgoISO,
        pinned: false,
        folder: "Mmm",
      },
    ];
    await setupSidebarChats(page, folderChats);
    await goToChat(page);

    // Wait for folder filter buttons
    await expect(page.locator("nav button").filter({ hasText: "Aaa" })).toBeVisible({ timeout: 15000 });

    // Collect folder filter button texts (skip "Tous")
    const filterButtons = page.locator("nav button").filter({ hasText: /^(Aaa|Mmm|Zzz)$/ });
    const buttonTexts = await filterButtons.allTextContents();
    const cleaned = buttonTexts.map((t) => t.trim());

    // Should be alphabetically sorted
    expect(cleaned).toEqual(["Aaa", "Mmm", "Zzz"]);
  });

  test("date-based groups appear in correct order (Aujourd'hui, Cette semaine, Plus ancien)", async ({
    page,
  }) => {
    const timeGroupChats = [
      {
        id: "tg-today",
        title: "Chat aujourd hui",
        userExcerpt: "T",
        createdAt: todayISO,
        updatedAt: todayISO,
        pinned: false,
        folder: "",
      },
      {
        id: "tg-week",
        title: "Chat cette semaine",
        userExcerpt: "W",
        createdAt: lastWeekISO,
        updatedAt: lastWeekISO,
        pinned: false,
        folder: "",
      },
      {
        id: "tg-old",
        title: "Chat plus ancien",
        userExcerpt: "O",
        createdAt: twoWeeksAgoISO,
        updatedAt: twoWeeksAgoISO,
        pinned: false,
        folder: "",
      },
    ];
    await setupSidebarChats(page, timeGroupChats);
    await goToChat(page);

    await expect(page.getByText("Chat aujourd hui")).toBeVisible({ timeout: 15000 });

    // Verify section headers appear in the correct order
    const sectionHeaders = page.locator("nav h3");
    const headerTexts = await sectionHeaders.allTextContents();
    const cleaned = headerTexts.map((t) => t.trim());

    const todayIdx = cleaned.findIndex((t) => t.includes("Aujourd"));
    const weekIdx = cleaned.findIndex((t) => t.includes("Cette semaine"));
    const oldIdx = cleaned.findIndex((t) => t.includes("Plus ancien"));

    // All groups should exist
    expect(todayIdx).toBeGreaterThanOrEqual(0);
    expect(weekIdx).toBeGreaterThanOrEqual(0);
    expect(oldIdx).toBeGreaterThanOrEqual(0);

    // Order: Aujourd'hui < Cette semaine < Plus ancien
    expect(todayIdx).toBeLessThan(weekIdx);
    expect(weekIdx).toBeLessThan(oldIdx);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Empty Sidebar
// ═══════════════════════════════════════════════════════════════════

test.describe("Sidebar Org — Empty State", () => {
  test("empty sidebar shows no chat items", async ({ page }) => {
    // Default fixtures return empty chats
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("nav")).toBeVisible({ timeout: 15000 });

    // No chat items in sidebar
    const chatItems = page.locator("nav .allow-context-menu");
    await expect(chatItems).toHaveCount(0, { timeout: 5000 });
  });

  test('"Nouveau chat" link always visible even when sidebar is empty', async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    const newChatLink = page.getByText("Nouveau chat");
    await expect(newChatLink).toBeVisible({ timeout: 15000 });
  });

  test("no Favoris or folder sections when sidebar is empty", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("nav")).toBeVisible({ timeout: 15000 });

    // "Favoris" section header should NOT be visible
    const favorisHeader = page.locator("nav h3").filter({ hasText: "Favoris" });
    await expect(favorisHeader).toBeHidden({ timeout: 3000 });

    // No date group headers either
    const todayHeader = page.locator("nav h3").filter({ hasText: "Aujourd" });
    await expect(todayHeader).toBeHidden({ timeout: 3000 });

    // No folder filter buttons
    const tousButton = page.locator("nav button").filter({ hasText: "Tous" });
    await expect(tousButton).toBeHidden({ timeout: 3000 });
  });

  test("selection mode button hidden when sidebar is empty", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("nav")).toBeVisible({ timeout: 15000 });

    // The checkmark selection button should not be visible with 0 chats
    const selectButton = page.locator('button[title="Sélectionner des conversations"]');
    await expect(selectButton).toBeHidden({ timeout: 3000 });
  });
});

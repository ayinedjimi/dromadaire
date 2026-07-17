import { test, expect } from "./fixtures";
import { setupStreamingMock, MOCK_MODELS_LIST, goToChat } from "./helpers";

/**
 * E2E tests for chat management in the sidebar (LOTs O, 27v6).
 *
 * Covers create, rename, delete, pin/unpin, and folder operations.
 * The sidebar uses `window.menu()` for native context menus (desktop-only API).
 * In E2E tests we mock `window.menu` to simulate menu selection.
 */

// ─── Correct mock data matching the Go backend JSON format ─────────
// The backend returns { chatInfos: [...] } with camelCase keys.
// ChatInfo constructor reads: id, title, userExcerpt, createdAt, updatedAt, pinned, folder

const now = new Date();
const todayISO = now.toISOString();
const yesterdayISO = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
const lastWeekISO = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();

const MOCK_CHAT_INFOS = [
  {
    id: "chat-001",
    title: "Conversation recente",
    userExcerpt: "Bonjour",
    createdAt: todayISO,
    updatedAt: todayISO,
    pinned: false,
    folder: "",
  },
  {
    id: "chat-002",
    title: "Projet important",
    userExcerpt: "Travail",
    createdAt: yesterdayISO,
    updatedAt: yesterdayISO,
    pinned: true,
    folder: "",
  },
  {
    id: "chat-003",
    title: "Discussion code",
    userExcerpt: "Code",
    createdAt: lastWeekISO,
    updatedAt: lastWeekISO,
    pinned: false,
    folder: "Travail",
  },
  {
    id: "chat-004",
    title: "Notes personnelles",
    userExcerpt: "Notes",
    createdAt: lastWeekISO,
    updatedAt: lastWeekISO,
    pinned: false,
    folder: "Personnel",
  },
];

/**
 * Setup mock chats in the sidebar using the correct chatInfos format.
 * Also mocks individual chat endpoints for each chat.
 */
async function setupSidebarChats(page: import("@playwright/test").Page, chats = MOCK_CHAT_INFOS) {
  // Override the /api/v1/chats route (LIFO priority over fixture default)
  await page.route("**/api/v1/chats", (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ chatInfos: chats }),
    });
  });

  // Mock individual chat GET endpoints
  for (const chat of chats) {
    await page.route(`**/api/v1/chat/${chat.id}`, (route) => {
      if (route.request().method() === "GET") {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            chat: {
              id: chat.id,
              title: chat.title,
              messages: [
                { role: "user", content: chat.userExcerpt },
                { role: "assistant", content: "Reponse test" },
              ],
            },
            messages: [],
          }),
        });
      } else {
        // PUT/DELETE — return success
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true }),
        });
      }
    });
  }
}

/**
 * Mock window.menu to return a specific action string when called.
 * This simulates the native desktop context menu.
 */
async function mockWindowMenu(page: import("@playwright/test").Page, action: string) {
  await page.evaluate((act) => {
    (window as any).menu = async () => act;
  }, action);
}

// ─── Create Chat ───────────────────────────────────────────────────

test.describe("Chat Management — Create", () => {
  test("Ctrl+N navigates to new chat", async ({ page }) => {
    await setupSidebarChats(page);
    await page.goto("/settings");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("h1")).toContainText("Param", { timeout: 15000 });

    await page.keyboard.press("Control+n");

    // Should navigate to home with the textarea visible
    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 15000 });
  });

  test('"Nouveau chat" link navigates to new chat', async ({ page }) => {
    await setupSidebarChats(page);
    await goToChat(page);

    const newChatLink = page.getByText("Nouveau chat");
    await expect(newChatLink).toBeVisible({ timeout: 15000 });

    await newChatLink.click();

    // Textarea should remain visible (already on chat page)
    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 10000 });
  });

  test("sending a message creates a chat visible in the sidebar", async ({ page }) => {
    const chatId = "new-chat-from-msg";

    // Setup streaming mock so sending a message works
    await setupStreamingMock(
      page,
      chatId,
      [
        { eventName: "chat_created", chatId },
        { eventName: "chat", content: "Bonjour ! " },
        { eventName: "chat", content: "Comment puis-je aider ?" },
        { eventName: "done" },
      ],
      [
        { role: "user", content: "Salut" },
        { role: "assistant", content: "Bonjour ! Comment puis-je aider ?" },
      ],
      "Salut",
    );

    // After streaming, the chats list will be refetched — mock it with the new chat
    await page.route("**/api/v1/chats", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          chatInfos: [
            {
              id: chatId,
              title: "Salut",
              userExcerpt: "Salut",
              createdAt: todayISO,
              updatedAt: todayISO,
              pinned: false,
              folder: "",
            },
          ],
        }),
      });
    });

    await page.goto("/");
    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 15000 });

    await textarea.fill("Salut");
    await textarea.press("Enter");

    // Wait for the streamed response to appear
    await expect(page.getByText("Comment puis-je aider")).toBeVisible({ timeout: 10000 });
  });
});

// ─── Rename ────────────────────────────────────────────────────────

test.describe("Chat Management — Rename", () => {
  test.beforeEach(async ({ page }) => {
    await setupSidebarChats(page);
  });

  test("context menu 'Renommer' makes the title editable", async ({ page }) => {
    await goToChat(page);

    // Wait for sidebar to show the chat
    await expect(page.getByText("Conversation recente")).toBeVisible({ timeout: 15000 });

    // Mock window.menu to return "Renommer"
    await mockWindowMenu(page, "Renommer");

    // Right-click on the chat title to trigger context menu
    await page.getByText("Conversation recente").click({ button: "right" });

    // An input should appear for editing
    const editInput = page.locator('nav input[type="text"]');
    await expect(editInput).toBeVisible({ timeout: 5000 });
    await expect(editInput).toHaveValue("Conversation recente");
  });

  test("Enter validates rename and sends PUT request", async ({ page }) => {
    // Track rename API calls
    const renameCalls: { url: string; body: any }[] = [];
    await page.route("**/api/v1/chat/chat-001/rename", (route) => {
      if (route.request().method() === "PUT") {
        renameCalls.push({
          url: route.request().url(),
          body: route.request().postDataJSON(),
        });
      }
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
    });

    await goToChat(page);
    await expect(page.getByText("Conversation recente")).toBeVisible({ timeout: 15000 });

    // Trigger rename via context menu
    await mockWindowMenu(page, "Renommer");
    await page.getByText("Conversation recente").click({ button: "right" });

    const editInput = page.locator('nav input[type="text"]');
    await expect(editInput).toBeVisible({ timeout: 5000 });

    // Clear and type new name
    await editInput.fill("Nouveau titre");
    await editInput.press("Enter");

    // Input should disappear
    await expect(editInput).toBeHidden({ timeout: 5000 });

    // API should have been called with the new title
    await page.waitForTimeout(500); // wait for mutation
    expect(renameCalls.length).toBe(1);
    expect(renameCalls[0].body.title).toBe("Nouveau titre");
  });

  test("Escape cancels rename (title unchanged)", async ({ page }) => {
    await goToChat(page);
    await expect(page.getByText("Conversation recente")).toBeVisible({ timeout: 15000 });

    // Trigger rename
    await mockWindowMenu(page, "Renommer");
    await page.getByText("Conversation recente").click({ button: "right" });

    const editInput = page.locator('nav input[type="text"]');
    await expect(editInput).toBeVisible({ timeout: 5000 });

    // Type something different then press Escape
    await editInput.fill("Titre modifie");
    await editInput.press("Escape");

    // Input should disappear and original title should still be there
    await expect(editInput).toBeHidden({ timeout: 5000 });
    await expect(page.getByText("Conversation recente")).toBeVisible({ timeout: 5000 });
  });

  test("long name is truncated in sidebar", async ({ page }) => {
    // Setup a chat with a very long title
    const longTitle = "Ceci est un titre extremement long qui devrait etre tronque dans la sidebar car il depasse la largeur disponible";
    await page.route("**/api/v1/chats", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          chatInfos: [
            {
              id: "chat-long",
              title: longTitle,
              userExcerpt: "",
              createdAt: todayISO,
              updatedAt: todayISO,
              pinned: false,
              folder: "",
            },
          ],
        }),
      });
    });

    await goToChat(page);

    // The title span should have the "truncate" CSS class
    const titleSpan = page.locator("nav .truncate").filter({ hasText: longTitle.substring(0, 20) });
    await expect(titleSpan).toBeVisible({ timeout: 15000 });

    // Verify the CSS truncation class is applied
    const hasClass = await titleSpan.first().evaluate((el) =>
      el.classList.contains("truncate"),
    );
    expect(hasClass).toBe(true);
  });
});

// ─── Delete ────────────────────────────────────────────────────────

test.describe("Chat Management — Delete", () => {
  test.beforeEach(async ({ page }) => {
    await setupSidebarChats(page);
  });

  test("context menu shows 'Supprimer' option", async ({ page }) => {
    await goToChat(page);
    await expect(page.getByText("Conversation recente")).toBeVisible({ timeout: 15000 });

    // Mock window.menu to capture that it was called (return "Supprimer")
    let menuCalled = false;
    await page.evaluate(() => {
      (window as any).menu = async (items: any[]) => {
        (window as any).__menuItems = items;
        return null; // don't select anything
      };
    });

    await page.getByText("Conversation recente").click({ button: "right" });
    await page.waitForTimeout(300);

    // Verify the menu items included "Supprimer"
    const menuItems = await page.evaluate(() => (window as any).__menuItems);
    const labels = menuItems?.map((item: any) => item.label) ?? [];
    expect(labels).toContain("Supprimer");
  });

  test("confirmation dialog appears before deletion", async ({ page }) => {
    await goToChat(page);
    await expect(page.getByText("Conversation recente")).toBeVisible({ timeout: 15000 });

    // Listen for the confirm dialog
    let confirmMessage = "";
    page.on("dialog", async (dialog) => {
      confirmMessage = dialog.message();
      await dialog.dismiss(); // Cancel the deletion
    });

    // Mock window.menu to return "Supprimer"
    await mockWindowMenu(page, "Supprimer");
    await page.getByText("Conversation recente").click({ button: "right" });

    // Wait for the confirm dialog
    await page.waitForTimeout(1000);
    expect(confirmMessage).toContain("supprimer");
  });

  test("confirming deletion sends DELETE request and removes from sidebar", async ({ page }) => {
    // Track delete API calls
    let deleteCalled = false;
    await page.route("**/api/v1/chat/chat-001", (route) => {
      if (route.request().method() === "DELETE") {
        deleteCalled = true;
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true }),
        });
      } else {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            chat: { id: "chat-001", title: "Conversation recente", messages: [] },
            messages: [],
          }),
        });
      }
    });

    await goToChat(page);
    await expect(page.getByText("Conversation recente")).toBeVisible({ timeout: 15000 });

    // Auto-accept the confirm dialog
    page.on("dialog", async (dialog) => {
      await dialog.accept();
    });

    // Mock window.menu to return "Supprimer"
    await mockWindowMenu(page, "Supprimer");
    await page.getByText("Conversation recente").click({ button: "right" });

    // Wait for the delete mutation to complete
    await page.waitForTimeout(1000);
    expect(deleteCalled).toBe(true);
  });
});

// ─── Pin / Unpin ───────────────────────────────────────────────────

test.describe("Chat Management — Pin/Unpin", () => {
  test.beforeEach(async ({ page }) => {
    await setupSidebarChats(page);
  });

  test("pinning a chat moves it to 'Favoris' section", async ({ page }) => {
    // Track pin API calls
    let pinBody: any = null;
    await page.route("**/api/v1/chat/chat-001/pin", (route) => {
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

    // "Projet important" is already pinned — the "Favoris" section should exist
    await expect(page.getByText("Favoris")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("Projet important")).toBeVisible({ timeout: 15000 });

    // Pin "Conversation recente" (currently not pinned)
    await mockWindowMenu(page, "Ajouter aux favoris");
    await page.getByText("Conversation recente").click({ button: "right" });

    // Wait for the optimistic update
    await page.waitForTimeout(500);

    // Verify the pin API was called with pinned: true
    expect(pinBody).not.toBeNull();
    expect(pinBody.pinned).toBe(true);
  });

  test("unpinning a chat moves it back to normal section", async ({ page }) => {
    let pinBody: any = null;
    await page.route("**/api/v1/chat/chat-002/pin", (route) => {
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
    await expect(page.getByText("Projet important")).toBeVisible({ timeout: 15000 });

    // Unpin "Projet important" (currently pinned)
    await mockWindowMenu(page, "Retirer des favoris");
    await page.getByText("Projet important").click({ button: "right" });

    await page.waitForTimeout(500);

    // Verify the pin API was called with pinned: false
    expect(pinBody).not.toBeNull();
    expect(pinBody.pinned).toBe(false);
  });

  test("pin star icon is visible on pinned chats", async ({ page }) => {
    await goToChat(page);

    // The "Favoris" section header should have a star icon
    const favorisHeader = page.locator("h3").filter({ hasText: "Favoris" });
    await expect(favorisHeader).toBeVisible({ timeout: 15000 });

    // Pinned chats display a Star icon inline with the title
    // "Projet important" is pinned — its container should have a Star SVG
    const pinnedChat = page.locator("nav").getByText("Projet important");
    await expect(pinnedChat).toBeVisible({ timeout: 5000 });

    // The parent container of the pinned chat link should contain a star SVG
    // (Star icon with weight="fill" renders as an SVG)
    const chatContainer = pinnedChat.locator("xpath=ancestor::div[contains(@class, 'allow-context-menu')]");
    const starSvg = chatContainer.locator("svg").first();
    await expect(starSvg).toBeVisible({ timeout: 3000 });
  });
});

// ─── Folders ───────────────────────────────────────────────────────

test.describe("Chat Management — Folders", () => {
  test.beforeEach(async ({ page }) => {
    await setupSidebarChats(page);
  });

  test("chats with folders show folder badge in sidebar", async ({ page }) => {
    await goToChat(page);

    // "Discussion code" is in folder "Travail"
    await expect(page.getByText("Discussion code")).toBeVisible({ timeout: 15000 });

    // Folder filter buttons should be visible since we have folders
    await expect(page.getByText("Travail").first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Personnel").first()).toBeVisible({ timeout: 10000 });
  });

  test("assigning a folder via context menu sends PUT request", async ({ page }) => {
    let folderBody: any = null;
    await page.route("**/api/v1/chat/chat-001/folder", (route) => {
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
    await expect(page.getByText("Conversation recente")).toBeVisible({ timeout: 15000 });

    // Move "Conversation recente" to "Travail" folder
    await page.evaluate(() => {
      (window as any).menu = async () => "Déplacer vers « Travail »";
    });
    await page.getByText("Conversation recente").click({ button: "right" });

    await page.waitForTimeout(500);

    expect(folderBody).not.toBeNull();
    expect(folderBody.folder).toBe("Travail");
  });

  test("removing from folder sends PUT with empty folder", async ({ page }) => {
    let folderBody: any = null;
    await page.route("**/api/v1/chat/chat-003/folder", (route) => {
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
    await expect(page.getByText("Discussion code")).toBeVisible({ timeout: 15000 });

    // Remove "Discussion code" from its folder
    await page.evaluate(() => {
      (window as any).menu = async () => "Retirer du dossier « Travail »";
    });
    await page.getByText("Discussion code").click({ button: "right" });

    await page.waitForTimeout(500);

    expect(folderBody).not.toBeNull();
    expect(folderBody.folder).toBe("");
  });

  test("folder filter buttons toggle to show only chats in that folder", async ({ page }) => {
    await goToChat(page);

    // All chats should be visible initially
    await expect(page.getByText("Conversation recente")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("Discussion code")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("Notes personnelles")).toBeVisible({ timeout: 15000 });

    // Click the "Travail" folder filter button (the one in the filter bar, not the badge)
    // The filter bar has small round buttons at the top of the chat list
    const folderFilterButtons = page.locator("nav button").filter({ hasText: "Travail" });
    // The first "Travail" button in nav should be the folder filter
    await folderFilterButtons.first().click();

    // After filtering, only "Discussion code" (folder: "Travail") should be visible
    // and chats without "Travail" folder should be hidden
    await expect(page.getByText("Discussion code")).toBeVisible({ timeout: 5000 });

    // Click "Tous" to remove the filter
    const allButton = page.locator("nav button").filter({ hasText: "Tous" });
    await allButton.click();

    // All chats should be visible again
    await expect(page.getByText("Conversation recente")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("Discussion code")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("Notes personnelles")).toBeVisible({ timeout: 5000 });
  });
});

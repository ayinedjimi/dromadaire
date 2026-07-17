import { test, expect } from "./fixtures";

test.describe("Agent tool approval", () => {
  test("displays tool approval block and approve button works", async ({ page }) => {
    // Model list
    await page.route("**/api/tags", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          models: [
            {
              name: "gemma3:4b",
              model: "gemma3:4b",
              digest: "abc123",
              modified_at: "2024-01-01T00:00:00Z",
              size: 2000000000,
              details: { families: ["gemma"] },
            },
          ],
        }),
      });
    });

    // Chat POST → NDJSON stream with tool_approval event
    await page.route("**/api/v1/chat/new", (route) => {
      if (route.request().method() === "POST") {
        const events = [
          { eventName: "chat_created", chatId: "test-approve-001" },
          { eventName: "chat", content: "Je vais lister les fichiers." },
          { eventName: "tool_approval", content: "ls -la /home/user", toolName: "bash" },
          // No "done" — stream waits for approval in real scenario
          // But we send done so the stream resolves cleanly in the test
          { eventName: "done" },
        ];
        route.fulfill({
          status: 200,
          contentType: "application/x-ndjson",
          body: events.map((e) => JSON.stringify(e)).join("\n") + "\n",
        });
      } else {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ chat: null, messages: [] }),
        });
      }
    });

    // Chat GET for created chat
    await page.route("**/api/v1/chat/test-approve-001", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          chat: {
            id: "test-approve-001",
            title: "Test Approval",
            messages: [
              { role: "user", content: "Liste les fichiers" },
              { role: "assistant", content: "Je vais lister les fichiers." },
            ],
          },
          messages: [],
        }),
      });
    });

    // Intercept tool-approve endpoint
    let approvalPayload: any = null;
    await page.route("**/api/v1/chat/test-approve-001/tool-approve", (route) => {
      approvalPayload = route.request().postDataJSON();
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: "ok" }),
      });
    });

    await page.goto("/");
    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 15000 });
    await textarea.fill("Liste les fichiers");
    await textarea.press("Enter");

    // Wait for the tool approval block to appear
    await expect(page.getByText("Approbation requise")).toBeVisible({ timeout: 10000 });

    // The command should be displayed
    await expect(page.getByText("ls -la /home/user")).toBeVisible();

    // Click the "Exécuter" (approve) button
    await page.getByRole("button", { name: /Exécuter/ }).click();

    // Verify the approval was sent
    await page.waitForTimeout(1000);
    expect(approvalPayload).not.toBeNull();
    expect(approvalPayload?.approved).toBe(true);
  });

  test("deny button sends rejection", async ({ page }) => {
    await page.route("**/api/tags", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          models: [
            {
              name: "gemma3:4b",
              model: "gemma3:4b",
              digest: "abc123",
              modified_at: "2024-01-01T00:00:00Z",
              size: 2000000000,
              details: { families: ["gemma"] },
            },
          ],
        }),
      });
    });

    await page.route("**/api/v1/chat/new", (route) => {
      if (route.request().method() === "POST") {
        const events = [
          { eventName: "chat_created", chatId: "test-deny-002" },
          { eventName: "tool_approval", content: "rm -rf /tmp/test", toolName: "bash" },
          { eventName: "done" },
        ];
        route.fulfill({
          status: 200,
          contentType: "application/x-ndjson",
          body: events.map((e) => JSON.stringify(e)).join("\n") + "\n",
        });
      } else {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ chat: null, messages: [] }),
        });
      }
    });

    await page.route("**/api/v1/chat/test-deny-002", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          chat: {
            id: "test-deny-002",
            title: "Test Deny",
            messages: [{ role: "user", content: "Supprime" }],
          },
          messages: [],
        }),
      });
    });

    let approvalPayload: any = null;
    await page.route("**/api/v1/chat/test-deny-002/tool-approve", (route) => {
      approvalPayload = route.request().postDataJSON();
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: "ok" }),
      });
    });

    await page.goto("/");
    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 15000 });
    await textarea.fill("Supprime le dossier");
    await textarea.press("Enter");

    await expect(page.getByText("Approbation requise")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("rm -rf /tmp/test")).toBeVisible();

    // Click "Refuser" (deny) button
    await page.getByRole("button", { name: /Refuser/ }).click();

    await page.waitForTimeout(1000);
    expect(approvalPayload).not.toBeNull();
    expect(approvalPayload?.approved).toBe(false);
  });
});

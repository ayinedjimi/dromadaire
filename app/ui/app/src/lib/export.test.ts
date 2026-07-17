// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { exportConversation } from "./export";

// Mock URL.createObjectURL / revokeObjectURL
const mockCreateObjectURL = vi.fn(() => "blob:http://localhost/fake-blob-url");
const mockRevokeObjectURL = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  globalThis.URL.createObjectURL = mockCreateObjectURL;
  globalThis.URL.revokeObjectURL = mockRevokeObjectURL;
});

function makeChat(
  title: string,
  messages: Array<{ role: string; content: string; model?: string }>,
  created_at: any = "2025-06-15T10:30:00Z",
) {
  return {
    title,
    created_at,
    messages: messages.map((m) => ({
      role: m.role,
      content: m.content,
      model: m.model,
      thinking: "",
      stream: false,
      created_at: {},
      updated_at: {},
    })),
  };
}

describe("exportConversation — markdown format", () => {
  it("produces markdown with title, date, separator, and formatted messages", () => {
    let blobContent = "";
    const OriginalBlob = globalThis.Blob;
    vi.spyOn(globalThis, "Blob").mockImplementation(
      (parts?: BlobPart[], options?: BlobPropertyBag) => {
        blobContent = parts ? String(parts[0]) : "";
        return new OriginalBlob(parts, options);
      },
    );

    const chat = makeChat("Test Chat", [
      { role: "user", content: "Bonjour" },
      { role: "assistant", content: "Salut!" },
    ]);

    exportConversation(chat as any, "markdown");

    // Title line
    expect(blobContent).toContain("# Test Chat");
    // Separator
    expect(blobContent).toContain("---");
    // User message formatted with bold
    expect(blobContent).toContain("**Vous:** Bonjour");
    // Assistant message formatted with bold
    expect(blobContent).toContain("**Assistant:** Salut!");

    vi.restoreAllMocks();
  });

  it("creates a download link and triggers a click", () => {
    const clickSpy = vi.fn();
    const appendSpy = vi.spyOn(document.body, "appendChild");
    const removeSpy = vi.spyOn(document.body, "removeChild");

    // Mock createElement to spy on the anchor
    const origCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = origCreateElement(tag);
      if (tag === "a") {
        el.click = clickSpy;
      }
      return el;
    });

    const chat = makeChat("My Chat", [
      { role: "user", content: "Hello" },
    ]);

    exportConversation(chat as any, "markdown");

    expect(mockCreateObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(appendSpy).toHaveBeenCalled();
    expect(removeSpy).toHaveBeenCalled();
    expect(mockRevokeObjectURL).toHaveBeenCalledWith("blob:http://localhost/fake-blob-url");

    vi.restoreAllMocks();
  });

  it("uses default title 'Conversation' when title is empty", () => {
    let blobContent = "";
    const OriginalBlob = globalThis.Blob;
    vi.spyOn(globalThis, "Blob").mockImplementation(
      (parts?: BlobPart[], options?: BlobPropertyBag) => {
        blobContent = parts ? String(parts[0]) : "";
        return new OriginalBlob(parts, options);
      },
    );

    const chat = makeChat("", [{ role: "user", content: "Test" }]);
    exportConversation(chat as any, "markdown");

    expect(blobContent).toContain("# Conversation");

    vi.restoreAllMocks();
  });

  it("skips messages with roles other than user/assistant", () => {
    let blobContent = "";
    const OriginalBlob = globalThis.Blob;
    vi.spyOn(globalThis, "Blob").mockImplementation(
      (parts?: BlobPart[], options?: BlobPropertyBag) => {
        blobContent = parts ? String(parts[0]) : "";
        return new OriginalBlob(parts, options);
      },
    );

    const chat = makeChat("Chat", [
      { role: "user", content: "Hi" },
      { role: "system", content: "System prompt" },
      { role: "assistant", content: "Hello" },
    ]);

    exportConversation(chat as any, "markdown");

    expect(blobContent).toContain("**Vous:** Hi");
    expect(blobContent).toContain("**Assistant:** Hello");
    expect(blobContent).not.toContain("System prompt");

    vi.restoreAllMocks();
  });
});

describe("exportConversation — filename sanitization", () => {
  it("strips special characters from the filename", () => {
    const origCreateElement = document.createElement.bind(document);
    let downloadFilename = "";
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = origCreateElement(tag);
      if (tag === "a") {
        Object.defineProperty(el, "download", {
          set(val: string) {
            downloadFilename = val;
          },
          get() {
            return downloadFilename;
          },
        });
        el.click = vi.fn();
      }
      return el;
    });

    const chat = makeChat("Mon chat: <test> & (notes)!", [
      { role: "user", content: "Hi" },
    ]);

    exportConversation(chat as any, "markdown");

    // Special characters should be removed; alphanumeric, hyphens, underscores, spaces kept
    expect(downloadFilename).not.toContain(":");
    expect(downloadFilename).not.toContain("<");
    expect(downloadFilename).not.toContain(">");
    expect(downloadFilename).not.toContain("&");
    expect(downloadFilename).not.toContain("(");
    expect(downloadFilename).not.toContain(")");
    expect(downloadFilename).not.toContain("!");
    expect(downloadFilename).toContain(".md");

    vi.restoreAllMocks();
  });

  it("truncates long titles to at most 50 characters before extension", () => {
    const origCreateElement = document.createElement.bind(document);
    let downloadFilename = "";
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = origCreateElement(tag);
      if (tag === "a") {
        Object.defineProperty(el, "download", {
          set(val: string) {
            downloadFilename = val;
          },
          get() {
            return downloadFilename;
          },
        });
        el.click = vi.fn();
      }
      return el;
    });

    const longTitle = "A".repeat(100);
    const chat = makeChat(longTitle, [{ role: "user", content: "Hi" }]);

    exportConversation(chat as any, "markdown");

    // Filename minus extension should be at most 50 chars
    const nameWithoutExt = downloadFilename.replace(/\.md$/, "");
    expect(nameWithoutExt.length).toBeLessThanOrEqual(50);
    expect(downloadFilename).toContain(".md");

    vi.restoreAllMocks();
  });

  it("uses json extension for json format", () => {
    const origCreateElement = document.createElement.bind(document);
    let downloadFilename = "";
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = origCreateElement(tag);
      if (tag === "a") {
        Object.defineProperty(el, "download", {
          set(val: string) {
            downloadFilename = val;
          },
          get() {
            return downloadFilename;
          },
        });
        el.click = vi.fn();
      }
      return el;
    });

    const chat = makeChat("Test", [{ role: "user", content: "Hi" }]);
    exportConversation(chat as any, "json");

    expect(downloadFilename).toContain(".json");

    vi.restoreAllMocks();
  });

  it("uses txt extension for text format", () => {
    const origCreateElement = document.createElement.bind(document);
    let downloadFilename = "";
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = origCreateElement(tag);
      if (tag === "a") {
        Object.defineProperty(el, "download", {
          set(val: string) {
            downloadFilename = val;
          },
          get() {
            return downloadFilename;
          },
        });
        el.click = vi.fn();
      }
      return el;
    });

    const chat = makeChat("Test", [{ role: "user", content: "Hi" }]);
    exportConversation(chat as any, "text");

    expect(downloadFilename).toContain(".txt");

    vi.restoreAllMocks();
  });
});

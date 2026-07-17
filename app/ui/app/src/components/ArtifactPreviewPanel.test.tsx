// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import React from "react";

// ── Mocks ──

vi.mock("./MonacoCodeEditor", () => ({
  MonacoCodeEditor: (props: any) => (
    <textarea
      data-testid="monaco"
      value={props.code}
      onChange={(e) => props.onChange?.(e.target.value)}
    />
  ),
}));

vi.mock("./CopyButton", () => ({
  default: () => <button data-testid="copy-btn" />,
}));

// Explicit named mocks — a Proxy-based catch-all causes Vitest to hang because
// `Proxy.get("then")` returns a function, making the module look like a thenable.
vi.mock("@phosphor-icons/react", () => {
  const icon = (name: string) =>
    function MockIcon(p: any) {
      return React.createElement("span", { "data-testid": "icon-" + name });
    };
  return {
    X: icon("X"),
    Code: icon("Code"),
    Eye: icon("Eye"),
    DownloadSimple: icon("DownloadSimple"),
    ArrowCounterClockwise: icon("ArrowCounterClockwise"),
    Columns: icon("Columns"),
    Warning: icon("Warning"),
    ArrowsOut: icon("ArrowsOut"),
    ArrowsIn: icon("ArrowsIn"),
    MagnifyingGlassMinus: icon("MagnifyingGlassMinus"),
    MagnifyingGlassPlus: icon("MagnifyingGlassPlus"),
    ArrowSquareOut: icon("ArrowSquareOut"),
    Terminal: icon("Terminal"),
  };
});

vi.mock("dompurify", () => ({
  default: {
    sanitize: vi.fn((html: string, _opts?: any) => html),
  },
}));

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn().mockResolvedValue({ svg: "<svg>test</svg>" }),
  },
}));

vi.mock("@/lib/zipExport", () => ({
  hasLocalLibs: vi.fn(() => false),
  downloadAsZip: vi.fn(),
}));

// Global blob URL mocks
global.URL.createObjectURL = vi.fn(() => "blob:test");
global.URL.revokeObjectURL = vi.fn();

import {
  ArtifactPreviewPanel,
  isRenderable,
} from "./ArtifactPreviewPanel";
import { buildHTMLBlobContent } from "@/lib/renderers";
import DOMPurify from "dompurify";

// ── Helpers ──

function makeArtifact(overrides: Partial<{
  code: string;
  language: string;
  title: string;
  isStreaming: boolean;
}> = {}) {
  return {
    code: overrides.code ?? "<p>Hello</p>",
    language: overrides.language ?? "html",
    title: overrides.title,
    isStreaming: overrides.isStreaming,
  };
}

// Render helper that flushes React.lazy Suspense boundaries.
// React.lazy always creates an async component, even when the mock resolves
// synchronously — act(async) lets the microtask queue drain.
async function renderPanel(
  props: { artifact: ReturnType<typeof makeArtifact>; onClose: () => void; [k: string]: any },
) {
  let result!: ReturnType<typeof render>;
  await act(async () => {
    result = render(<ArtifactPreviewPanel {...props} />);
  });
  return result;
}

// ── Tests ──

describe("ArtifactPreviewPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ────────────────────────────────────────────
  // isRenderable
  // ────────────────────────────────────────────

  describe("isRenderable", () => {
    it("1. returns true for html, svg, mermaid, csv, json, markdown", () => {
      expect(isRenderable("html")).toBe(true);
      expect(isRenderable("svg")).toBe(true);
      expect(isRenderable("mermaid")).toBe(true);
      expect(isRenderable("csv")).toBe(true);
      expect(isRenderable("json")).toBe(true);
      expect(isRenderable("markdown")).toBe(true);
    });

    it("2. returns false for python, typescript, bash", () => {
      expect(isRenderable("python")).toBe(false);
      expect(isRenderable("typescript")).toBe(false);
      expect(isRenderable("bash")).toBe(false);
    });

    it("3. returns false for empty string", () => {
      expect(isRenderable("")).toBe(false);
    });
  });

  // ────────────────────────────────────────────
  // Tab logic
  // ────────────────────────────────────────────

  describe("Tab logic", () => {
    it("4. HTML artifact defaults to preview tab", async () => {
      await renderPanel({
        artifact: makeArtifact({ language: "html" }),
        onClose: vi.fn(),
      });
      const previewTab = screen.getByText("Apercu");
      expect(previewTab.closest("button")?.className).toContain("bg-[hsl(var(--bg-200))]");
    });

    it("5. Python artifact defaults to code tab (no tab bar for non-renderable)", async () => {
      await renderPanel({
        artifact: makeArtifact({ language: "python", code: "print('hi')" }),
        onClose: vi.fn(),
      });
      expect(screen.queryByText("Apercu")).toBeNull();
      expect(screen.queryByText("Split")).toBeNull();
      expect(screen.getByTestId("monaco")).toBeTruthy();
    });

    it("6. clicking Code tab shows Monaco editor", async () => {
      await renderPanel({
        artifact: makeArtifact({ language: "html", code: "<b>Test</b>" }),
        onClose: vi.fn(),
      });
      await act(async () => {
        fireEvent.click(screen.getByText("Code"));
      });
      expect(screen.getByTestId("monaco")).toBeTruthy();
    });

    it("7. clicking Split tab shows both Monaco and preview", async () => {
      await renderPanel({
        artifact: makeArtifact({ language: "html", code: "<p>Split</p>" }),
        onClose: vi.fn(),
      });
      await act(async () => {
        fireEvent.click(screen.getByText("Split"));
      });
      expect(screen.getByTestId("monaco")).toBeTruthy();
      const iframe = document.querySelector("iframe");
      expect(iframe).not.toBeNull();
    });
  });

  // ────────────────────────────────────────────
  // Header controls
  // ────────────────────────────────────────────

  describe("Header controls", () => {
    it("8. download button exists", async () => {
      await renderPanel({
        artifact: makeArtifact(),
        onClose: vi.fn(),
      });
      const downloadBtn = screen.getByLabelText("Télécharger le fichier");
      expect(downloadBtn).toBeTruthy();
    });

    it("9. close button calls onClose", async () => {
      const onClose = vi.fn();
      await renderPanel({ artifact: makeArtifact(), onClose });
      const closeBtn = screen.getByLabelText("Fermer le panneau");
      fireEvent.click(closeBtn);
      expect(onClose).toHaveBeenCalledOnce();
    });

    it("10. fullscreen button shown only when onToggleFullscreen provided", async () => {
      const { rerender } = await renderPanel({
        artifact: makeArtifact(),
        onClose: vi.fn(),
      });
      expect(screen.queryByLabelText("Plein écran")).toBeNull();

      const onToggle = vi.fn();
      await act(async () => {
        rerender(
          <ArtifactPreviewPanel
            artifact={makeArtifact()}
            onClose={vi.fn()}
            onToggleFullscreen={onToggle}
          />,
        );
      });
      const fsBtn = screen.getByLabelText("Plein écran");
      expect(fsBtn).toBeTruthy();
    });
  });

  // ────────────────────────────────────────────
  // HTML preview
  // ────────────────────────────────────────────

  describe("HTML preview", () => {
    it("11. iframe has sandbox='allow-scripts allow-same-origin allow-forms' (NO allow-popups)", async () => {
      await renderPanel({
        artifact: makeArtifact({ language: "html", code: "<p>Sandbox test</p>" }),
        onClose: vi.fn(),
      });
      const iframe = document.querySelector("iframe");
      expect(iframe).not.toBeNull();
      const sandboxAttr = iframe!.getAttribute("sandbox");
      expect(sandboxAttr).toBe("allow-scripts allow-same-origin allow-forms");
      expect(sandboxAttr).not.toContain("allow-popups");
    });

    it("12. 'Open in new tab' button only for HTML", async () => {
      const { rerender } = await renderPanel({
        artifact: makeArtifact({ language: "html" }),
        onClose: vi.fn(),
      });
      expect(screen.getByLabelText("Ouvrir dans un nouvel onglet")).toBeTruthy();

      await act(async () => {
        rerender(
          <ArtifactPreviewPanel
            artifact={makeArtifact({ language: "svg", code: "<svg></svg>" })}
            onClose={vi.fn()}
          />,
        );
      });
      expect(screen.queryByLabelText("Ouvrir dans un nouvel onglet")).toBeNull();
    });

    it("13. console toggle only for HTML", async () => {
      const { rerender } = await renderPanel({
        artifact: makeArtifact({ language: "html" }),
        onClose: vi.fn(),
      });
      expect(screen.getByLabelText("Basculer la console JavaScript")).toBeTruthy();

      await act(async () => {
        rerender(
          <ArtifactPreviewPanel
            artifact={makeArtifact({ language: "json", code: '{"a":1}' })}
            onClose={vi.fn()}
          />,
        );
      });
      expect(screen.queryByLabelText("Basculer la console JavaScript")).toBeNull();
    });
  });

  // ────────────────────────────────────────────
  // SVG security
  // ────────────────────────────────────────────

  describe("SVG security", () => {
    it("14. DOMPurify.sanitize called with FORBID_TAGS and FORBID_ATTR", async () => {
      await renderPanel({
        artifact: makeArtifact({
          language: "svg",
          code: '<svg xmlns="http://www.w3.org/2000/svg"><circle r="5"/></svg>',
        }),
        onClose: vi.fn(),
      });
      expect(DOMPurify.sanitize).toHaveBeenCalled();
      const call = (DOMPurify.sanitize as ReturnType<typeof vi.fn>).mock.calls.find(
        (c: any[]) => c[1]?.FORBID_TAGS,
      );
      expect(call).toBeDefined();
      expect(call![1].FORBID_TAGS).toContain("script");
      expect(call![1].FORBID_TAGS).toContain("iframe");
      expect(call![1].FORBID_ATTR).toBeDefined();
    });

    it("15. FORBID_ATTR includes onerror, onload, onclick", async () => {
      await renderPanel({
        artifact: makeArtifact({
          language: "svg",
          code: '<svg><rect width="10" height="10"/></svg>',
        }),
        onClose: vi.fn(),
      });
      const call = (DOMPurify.sanitize as ReturnType<typeof vi.fn>).mock.calls.find(
        (c: any[]) => c[1]?.FORBID_ATTR,
      );
      expect(call).toBeDefined();
      const forbidAttr: string[] = call![1].FORBID_ATTR;
      expect(forbidAttr).toContain("onerror");
      expect(forbidAttr).toContain("onload");
      expect(forbidAttr).toContain("onclick");
    });
  });

  // ────────────────────────────────────────────
  // CSV
  // ────────────────────────────────────────────

  describe("CSV", () => {
    it("16. renders table with headers", async () => {
      const csvCode = "Name,Age,City\nAlice,30,Paris\nBob,25,Lyon";
      await renderPanel({
        artifact: makeArtifact({ language: "csv", code: csvCode }),
        onClose: vi.fn(),
      });
      expect(screen.getByText("Name")).toBeTruthy();
      expect(screen.getByText("Age")).toBeTruthy();
      expect(screen.getByText("City")).toBeTruthy();
      expect(screen.getByText("Alice")).toBeTruthy();
      expect(screen.getByText("30")).toBeTruthy();
      const table = document.querySelector("table");
      expect(table).not.toBeNull();
    });

    it("17. empty CSV shows message", async () => {
      await renderPanel({
        artifact: makeArtifact({ language: "csv", code: "" }),
        onClose: vi.fn(),
      });
      expect(screen.getByText("Fichier CSV vide")).toBeTruthy();
    });
  });

  // ────────────────────────────────────────────
  // Security
  // ────────────────────────────────────────────

  describe("Security", () => {
    it("18. buildHTMLBlobContent output contains localStorage blocking script", () => {
      const output = buildHTMLBlobContent("<p>Test</p>");
      expect(output).toContain("Object.defineProperty(window,'localStorage'");
      expect(output).toContain("SecurityError");
    });
  });

  // ────────────────────────────────────────────
  // Other
  // ────────────────────────────────────────────

  describe("Other", () => {
    it("19. Escape key calls onClose", async () => {
      const onClose = vi.fn();
      await renderPanel({ artifact: makeArtifact(), onClose });
      fireEvent.keyDown(window, { key: "Escape" });
      expect(onClose).toHaveBeenCalledOnce();
    });

    it("20. streaming indicator shown when artifact.isStreaming=true", async () => {
      await renderPanel({
        artifact: makeArtifact({ isStreaming: true }),
        onClose: vi.fn(),
      });
      expect(screen.getByText("streaming")).toBeTruthy();
    });
  });
});

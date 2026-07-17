// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ArtifactRenderer } from "./ArtifactRenderer";

vi.mock("dompurify", () => ({
  default: {
    sanitize: vi.fn((html: string) => html),
  },
}));

// Mock blob URL APIs for jsdom
globalThis.URL.createObjectURL = vi.fn(() => "blob:mock-url");
globalThis.URL.revokeObjectURL = vi.fn();

describe("ArtifactRenderer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("affiche le bouton preview SVG", () => {
    render(<ArtifactRenderer code="<svg></svg>" language="svg" />);
    expect(screen.getByText("Apercu SVG")).toBeTruthy();
  });

  it("affiche le bouton preview HTML", () => {
    render(<ArtifactRenderer code="<p>Hello</p>" language="html" />);
    expect(screen.getByText("Apercu HTML")).toBeTruthy();
  });

  it("affiche le bouton preview Mermaid", () => {
    render(
      <ArtifactRenderer code="graph TD; A-->B;" language="mermaid" />
    );
    expect(screen.getByText("Apercu Mermaid")).toBeTruthy();
  });

  it("SVG: click preview rend le SVG sanitise", () => {
    const svgCode = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="5"/></svg>';
    render(<ArtifactRenderer code={svgCode} language="svg" />);

    fireEvent.click(screen.getByText("Apercu SVG"));

    // After clicking, the button should disappear and SVG should be rendered
    expect(screen.queryByText("Apercu SVG")).toBeNull();
  });

  it("HTML: click preview rend dans une iframe sandboxee", () => {
    render(<ArtifactRenderer code="<p>Hello World</p>" language="html" />);

    fireEvent.click(screen.getByText("Apercu HTML"));

    const iframe = document.querySelector("iframe");
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute("sandbox")).toBe("allow-scripts allow-same-origin allow-forms");
    expect(iframe?.title).toBe("Artifact HTML");
  });

  it("code vide HTML: affiche le bouton puis rend iframe vide au click", () => {
    render(<ArtifactRenderer code="" language="html" />);

    expect(screen.getByText("Apercu HTML")).toBeTruthy();

    fireEvent.click(screen.getByText("Apercu HTML"));

    const iframe = document.querySelector("iframe");
    expect(iframe).not.toBeNull();
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ModelPicker } from "./ModelPicker";

const mockSetSettings = vi.fn();

vi.mock("@/hooks/useSelectedModel", () => ({
  useSelectedModel: () => ({
    selectedModel: { model: "qwen2.5:1.5b", digest: "abc123" },
    setSettings: mockSetSettings,
    models: [
      { model: "qwen2.5:1.5b", digest: "abc123", isCloud: () => false },
      { model: "gemma3:4b", digest: "def456", isCloud: () => false },
    ],
    loading: false,
  }),
}));

vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({
    settings: { airplaneMode: false },
  }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    getQueryData: vi.fn(),
    setQueryData: vi.fn(),
  }),
}));

vi.mock("@/api", () => ({
  getModelUpstreamInfo: vi.fn(),
}));

vi.mock("@phosphor-icons/react", () => ({
  DownloadSimple: (props: any) => <span data-testid="icon-download" {...props} />,
}));

describe("ModelPicker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("affiche le modele selectionne", () => {
    render(<ModelPicker />);
    expect(screen.getByText("qwen2.5:1.5b")).toBeTruthy();
  });

  it("click ouvre le dropdown", () => {
    render(<ModelPicker />);

    const button = screen.getByTitle("Choisir un modèle");
    fireEvent.click(button);

    expect(
      screen.getByPlaceholderText("Rechercher un modèle...")
    ).toBeTruthy();
  });

  it("isDisabled affiche le modele avec opacity reduite", () => {
    render(<ModelPicker isDisabled />);
    // When disabled, model name is still shown but with opacity-50 class
    expect(screen.getByText("qwen2.5:1.5b")).toBeTruthy();
    const container = screen.getByText("qwen2.5:1.5b").closest("div");
    expect(container?.className).toContain("opacity-50");
  });
});

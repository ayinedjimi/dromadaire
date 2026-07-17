// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import CopyButton from "./CopyButton";

const mockSecureClipboardWrite = vi.fn().mockResolvedValue(undefined);

vi.mock("@/utils/secureClipboard", () => ({
  secureClipboardWrite: (...args: unknown[]) => mockSecureClipboardWrite(...args),
  secureClipboardWriteItems: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({
    settings: { clipboardClearSeconds: 30 },
  }),
}));

vi.mock("@phosphor-icons/react", () => ({
  Check: () => <span data-testid="icon-check" />,
  CopySimple: () => <span data-testid="icon-copy" />,
}));

describe("CopyButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("click copie le contenu via secureClipboardWrite", async () => {
    render(<CopyButton content="Hello World" />);

    const button = screen.getByRole("button");

    await act(async () => {
      fireEvent.click(button);
    });

    expect(mockSecureClipboardWrite).toHaveBeenCalledWith("Hello World", 30);
  });

  it("icone change en Check apres copie puis revient apres 2s", async () => {
    render(<CopyButton content="test" />);

    // Initially shows copy icon (mocked CopySimple)
    expect(screen.getByTestId("icon-copy")).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });

    // After copy, shows inline check SVG (green checkmark) instead of phosphor Check
    const button = screen.getByRole("button");
    const svg = button.querySelector("svg.text-green-500");
    expect(svg).not.toBeNull();

    // Advance timer by 2 seconds
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    // Should revert back to copy icon
    expect(screen.getByTestId("icon-copy")).toBeTruthy();
  });

  it("affiche les labels quand showLabels=true", () => {
    render(<CopyButton content="test" showLabels />);

    expect(screen.getByText("Copier")).toBeTruthy();
  });

  it("affiche Copie apres click avec showLabels", async () => {
    render(<CopyButton content="test" showLabels />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });

    expect(screen.getByText("Copié")).toBeTruthy();
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AlternativesNav } from "./AlternativesNav";

const mockGetAlternatives = vi.fn();

vi.mock("@/lib/alternatives", () => ({
  getAlternatives: (...args: unknown[]) => mockGetAlternatives(...args),
}));

describe("AlternativesNav", () => {
  const baseProps = {
    chatId: "chat-1",
    messageIndex: 0,
    currentContent: "Current response content",
    onSwitch: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAlternatives.mockReturnValue([]);
  });

  it("retourne null quand il n'y a pas d'alternatives", () => {
    mockGetAlternatives.mockReturnValue([]);

    const { container } = render(<AlternativesNav {...baseProps} />);

    expect(container.innerHTML).toBe("");
  });

  it("affiche le texte 1/N", () => {
    mockGetAlternatives.mockReturnValue([
      { content: "Alt 1", thinking: "", model: "gemma3", created_at: "2025-01-01" },
      { content: "Alt 2", thinking: "", model: "gemma3", created_at: "2025-01-02" },
    ]);

    render(<AlternativesNav {...baseProps} />);

    // Current is position 1, total is 3 (1 current + 2 alternatives)
    expect(screen.getByText("1/3")).toBeTruthy();
  });

  it("bouton gauche est desactive a la position initiale", () => {
    mockGetAlternatives.mockReturnValue([
      { content: "Alt 1", thinking: "", model: "gemma3", created_at: "2025-01-01" },
    ]);

    render(<AlternativesNav {...baseProps} />);

    const leftBtn = screen.getByText("<");
    expect(leftBtn).toBeTruthy();
    expect((leftBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it("bouton droit appelle onSwitch avec l'alternative", () => {
    const alt = { content: "Alt 1", thinking: "", model: "gemma3", created_at: "2025-01-01" };
    mockGetAlternatives.mockReturnValue([alt]);
    const onSwitch = vi.fn();

    render(<AlternativesNav {...baseProps} onSwitch={onSwitch} />);

    const rightBtn = screen.getByText(">");
    fireEvent.click(rightBtn);

    expect(onSwitch).toHaveBeenCalledOnce();
    expect(onSwitch).toHaveBeenCalledWith(alt);
  });

  it("navigation avant puis arriere revient au contenu courant", () => {
    const alt = { content: "Alt 1", thinking: "", model: "gemma3", created_at: "2025-01-01" };
    mockGetAlternatives.mockReturnValue([alt]);
    const onSwitch = vi.fn();

    render(<AlternativesNav {...baseProps} onSwitch={onSwitch} />);

    // Go right to alt
    fireEvent.click(screen.getByText(">"));
    expect(screen.getByText("2/2")).toBeTruthy();

    // Go left back to current
    fireEvent.click(screen.getByText("<"));
    expect(screen.getByText("1/2")).toBeTruthy();
    expect(onSwitch).toHaveBeenCalledTimes(2);
    // Second call should be back to current with isCurrent flag
    expect(onSwitch.mock.calls[1][0]).toEqual(
      expect.objectContaining({ content: "Current response content", isCurrent: true })
    );
  });
});

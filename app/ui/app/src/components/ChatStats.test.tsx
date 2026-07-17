// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChatStats } from "./ChatStats";

describe("ChatStats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retourne null quand messages est vide", () => {
    const { container } = render(<ChatStats messages={[]} />);

    expect(container.innerHTML).toBe("");
  });

  it("click ouvre le popover avec les statistiques", () => {
    const messages = [
      { role: "user", content: "Bonjour", thinking: "", stream: false, created_at: "2025-01-01T10:00:00Z", updated_at: "" },
      { role: "assistant", content: "Salut!", thinking: "", stream: false, model: "gemma3", created_at: "2025-01-01T10:01:00Z", updated_at: "" },
    ] as any[];

    render(<ChatStats messages={messages} />);

    // Popover should not be visible initially
    expect(screen.queryByText("Statistiques")).toBeNull();

    // Click the stats button
    const btn = screen.getByTitle("Statistiques");
    fireEvent.click(btn);

    // Now the popover should be visible
    expect(screen.getByText("Statistiques")).toBeTruthy();
  });

  it("affiche le bon nombre de messages user et assistant", () => {
    const messages = [
      { role: "user", content: "Q1", thinking: "", stream: false, created_at: "2025-01-01T10:00:00Z", updated_at: "" },
      { role: "assistant", content: "A1", thinking: "", stream: false, model: "gemma3", created_at: "2025-01-01T10:00:30Z", updated_at: "" },
      { role: "user", content: "Q2", thinking: "", stream: false, created_at: "2025-01-01T10:01:00Z", updated_at: "" },
      { role: "assistant", content: "A2 plus long", thinking: "", stream: false, model: "gemma3", created_at: "2025-01-01T10:01:30Z", updated_at: "" },
    ] as any[];

    render(<ChatStats messages={messages} />);
    fireEvent.click(screen.getByTitle("Statistiques"));

    expect(screen.getByText("2 user / 2 assistant")).toBeTruthy();
  });

  it("calcule les tokens estimes (totalChars / 4)", () => {
    // "AAAA" = 4 chars => 1 token, "BBBBBBBB" = 8 chars => 2 tokens. Total = 12 chars => 3 tokens
    const messages = [
      { role: "user", content: "AAAA", thinking: "", stream: false, created_at: "2025-01-01T10:00:00Z", updated_at: "" },
      { role: "assistant", content: "BBBBBBBB", thinking: "", stream: false, model: "m", created_at: "2025-01-01T10:00:30Z", updated_at: "" },
    ] as any[];

    render(<ChatStats messages={messages} />);
    fireEvent.click(screen.getByTitle("Statistiques"));

    expect(screen.getByText("~3")).toBeTruthy();
  });

  it("affiche la duree de la conversation", () => {
    const messages = [
      { role: "user", content: "Salut", thinking: "", stream: false, created_at: "2025-01-01T10:00:00Z", updated_at: "" },
      { role: "assistant", content: "Hello", thinking: "", stream: false, model: "m", created_at: "2025-01-01T10:05:00Z", updated_at: "" },
    ] as any[];

    render(<ChatStats messages={messages} />);
    fireEvent.click(screen.getByTitle("Statistiques"));

    // 5 minutes difference
    expect(screen.getByText("5m")).toBeTruthy();
  });
});

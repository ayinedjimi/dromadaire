// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ErrorMessage } from "./ErrorMessage";
import { ErrorEvent } from "@/gotypes";

const mockSetSettings = vi.fn().mockResolvedValue(undefined);

vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({
    settings: {},
    setSettings: mockSetSettings,
  }),
}));

describe("ErrorMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("affiche le message d'erreur generique", () => {
    const error = new ErrorEvent({ error: "Something went wrong" });
    render(<ErrorMessage error={error} />);

    expect(screen.getByText("Erreur")).toBeTruthy();
    expect(screen.getByText("Something went wrong")).toBeTruthy();
  });

  it("affiche l'UI airplane_blocked avec bouton desactiver", () => {
    const error = new ErrorEvent({
      error: "Download blocked",
      code: "airplane_blocked",
      details: "Le mode avion empeche le telechargement",
    });
    render(<ErrorMessage error={error} />);

    expect(screen.getByText("Mode avion actif")).toBeTruthy();
    expect(
      screen.getByText("Le mode avion empeche le telechargement")
    ).toBeTruthy();
    expect(
      screen.getByText("Desactiver le mode avion et reessayer")
    ).toBeTruthy();
  });

  it("click desactiver appelle setSettings et onDismiss", async () => {
    const onDismiss = vi.fn();
    const error = new ErrorEvent({
      error: "Blocked",
      code: "airplane_blocked",
    });
    render(<ErrorMessage error={error} onDismiss={onDismiss} />);

    fireEvent.click(
      screen.getByText("Desactiver le mode avion et reessayer")
    );

    await waitFor(() => {
      expect(mockSetSettings).toHaveBeenCalledWith({ AirplaneMode: false });
    });
    await waitFor(() => {
      expect(onDismiss).toHaveBeenCalled();
    });
  });

  it("renderWithLinks: URLs deviennent des liens cliquables", () => {
    const error = new ErrorEvent({
      error: "Visit https://ollama.com for help",
    });
    render(<ErrorMessage error={error} />);

    const link = screen.getByRole("link", { name: "https://ollama.com" });
    expect(link).toBeTruthy();
    expect(link.getAttribute("href")).toBe("https://ollama.com");
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("renderWithLinks: URLs localhost ne sont PAS linkifiees", () => {
    const error = new ErrorEvent({
      error: "Server at http://localhost:11434 and http://127.0.0.1:8080 failed",
    });
    render(<ErrorMessage error={error} />);

    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("airplane_blocked sans details utilise error comme fallback", () => {
    const error = new ErrorEvent({
      error: "Download blocked by airplane mode",
      code: "airplane_blocked",
    });
    render(<ErrorMessage error={error} />);

    expect(
      screen.getByText("Download blocked by airplane mode")
    ).toBeTruthy();
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import PasswordPrompt from "./PasswordPrompt";

const mockVerifyPassword = vi.fn();

vi.mock("@/api", () => ({
  verifyPassword: (...args: unknown[]) => mockVerifyPassword(...args),
}));

vi.mock("@phosphor-icons/react", () => ({
  Lock: (props: any) => <span data-testid="icon-lock" {...props} />,
}));

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, initial, animate, transition, ...rest }: any) => <div {...rest}>{children}</div>,
    p: ({ children, initial, animate, transition, ...rest }: any) => <p {...rest}>{children}</p>,
  },
}));

describe("PasswordPrompt", () => {
  const onSuccess = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("input mot de passe visible au montage", () => {
    render(<PasswordPrompt onSuccess={onSuccess} />);

    const input = screen.getByPlaceholderText("Mot de passe") as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.type).toBe("password");
  });

  it("affiche le titre Dromadaire", () => {
    render(<PasswordPrompt onSuccess={onSuccess} />);
    expect(screen.getByText("Dromadaire")).toBeTruthy();
  });

  it("submit avec mot de passe correct appelle onSuccess", async () => {
    mockVerifyPassword.mockResolvedValue({
      authenticated: true,
      wiped: false,
    });

    render(<PasswordPrompt onSuccess={onSuccess} />);

    const input = screen.getByPlaceholderText("Mot de passe");
    fireEvent.change(input, { target: { value: "correct-password" } });

    const button = screen.getByText("Deverrouiller");
    fireEvent.click(button);

    await waitFor(() => {
      expect(mockVerifyPassword).toHaveBeenCalledWith("correct-password");
    });
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalled();
    });
  });

  it("mot de passe incorrect affiche message erreur", async () => {
    mockVerifyPassword.mockResolvedValue({
      authenticated: false,
      wiped: false,
      attemptsLeft: 2,
    });

    render(<PasswordPrompt onSuccess={onSuccess} />);

    const input = screen.getByPlaceholderText("Mot de passe");
    fireEvent.change(input, { target: { value: "wrong-password" } });

    const button = screen.getByText("Deverrouiller");
    fireEvent.click(button);

    await waitFor(() => {
      expect(
        screen.getByText("Mot de passe incorrect. 2 tentatives restantes.")
      ).toBeTruthy();
    });
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("erreur serveur affiche message connexion", async () => {
    mockVerifyPassword.mockRejectedValue(new Error("Network error"));

    render(<PasswordPrompt onSuccess={onSuccess} />);

    const input = screen.getByPlaceholderText("Mot de passe");
    fireEvent.change(input, { target: { value: "any-password" } });

    fireEvent.click(screen.getByText("Deverrouiller"));

    await waitFor(() => {
      expect(
        screen.getByText("Erreur de connexion au serveur.")
      ).toBeTruthy();
    });
  });

  it("bouton desactive quand mot de passe vide", () => {
    render(<PasswordPrompt onSuccess={onSuccess} />);

    const button = screen.getByText("Deverrouiller") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });
});

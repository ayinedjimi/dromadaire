// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SearchModal } from "./SearchModal";

const mockNavigate = vi.fn();
const mockUseSearch = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("@/hooks/useSearch", () => ({
  useSearch: (...args: unknown[]) => mockUseSearch(...args),
}));

vi.mock("@phosphor-icons/react", () => ({
  MagnifyingGlass: (props: any) => <span data-testid="icon-search" {...props} />,
  X: (props: any) => <span data-testid="icon-x" {...props} />,
}));

describe("SearchModal", () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSearch.mockReturnValue({ data: undefined, isLoading: false });
  });

  it("est visible quand monte", () => {
    render(<SearchModal onClose={onClose} />);

    expect(
      screen.getByPlaceholderText("Rechercher dans les conversations...")
    ).toBeTruthy();
  });

  it("Escape ferme la modal", () => {
    render(<SearchModal onClose={onClose} />);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("saisie dans l'input change la query", () => {
    render(<SearchModal onClose={onClose} />);

    const input = screen.getByPlaceholderText(
      "Rechercher dans les conversations..."
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "test query" } });
    expect(input.value).toBe("test query");
  });

  it("pas de resultats affiche message aucun resultat", () => {
    mockUseSearch.mockReturnValue({ data: [], isLoading: false });

    render(<SearchModal onClose={onClose} />);

    const input = screen.getByPlaceholderText(
      "Rechercher dans les conversations..."
    );
    fireEvent.change(input, { target: { value: "xyz" } });

    expect(screen.getByText(/Aucun résultat pour/)).toBeTruthy();
  });

  it("affiche les resultats quand il y en a", () => {
    mockUseSearch.mockReturnValue({
      data: [
        {
          chat_id: "abc",
          chat_title: "Ma conversation",
          role: "user",
          excerpt: "un extrait de texte",
          created_at: "2025-01-01",
        },
      ],
      isLoading: false,
    });

    render(<SearchModal onClose={onClose} />);

    const input = screen.getByPlaceholderText(
      "Rechercher dans les conversations..."
    );
    fireEvent.change(input, { target: { value: "extrait" } });

    expect(screen.getByText("Ma conversation")).toBeTruthy();
  });

  it("click sur le backdrop ferme la modal", () => {
    render(<SearchModal onClose={onClose} />);

    // Click on the overlay backdrop (the outer div with fixed class)
    const backdrop = screen.getByPlaceholderText(
      "Rechercher dans les conversations..."
    ).closest(".fixed")!;
    // fireEvent.click fires with target=currentTarget only if we click the element directly
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });

  it("affiche message initial quand query est vide", () => {
    render(<SearchModal onClose={onClose} />);

    expect(
      screen.getByText("Tapez pour rechercher dans vos conversations")
    ).toBeTruthy();
  });
});

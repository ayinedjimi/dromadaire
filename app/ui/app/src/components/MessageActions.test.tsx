// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MessageActions } from "./MessageActions";

vi.mock("./CopyButton", () => ({
  default: (props: any) => <button data-testid="copy-button" />,
}));

describe("MessageActions", () => {
  const baseProps = {
    content: "Hello world",
    copyRef: { current: document.createElement("div") },
    isLastAssistantMessage: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("affiche toujours le CopyButton", () => {
    render(<MessageActions {...baseProps} />);

    expect(screen.getByTestId("copy-button")).toBeTruthy();
  });

  it("affiche le bouton regenerer seulement quand onRegenerate est fourni", () => {
    const onRegenerate = vi.fn();

    const { rerender } = render(<MessageActions {...baseProps} />);

    // Without onRegenerate, no regenerate button
    expect(screen.queryByTitle("Regenerer")).toBeNull();

    // With onRegenerate, button appears
    rerender(<MessageActions {...baseProps} onRegenerate={onRegenerate} />);

    const btn = screen.getByTitle("Regenerer");
    expect(btn).toBeTruthy();

    fireEvent.click(btn);
    expect(onRegenerate).toHaveBeenCalledOnce();
  });

  it("affiche le bouton continuer seulement quand isLastAssistantMessage ET onContinue sont fournis", () => {
    const onContinue = vi.fn();

    render(
      <MessageActions
        {...baseProps}
        isLastAssistantMessage={true}
        onContinue={onContinue}
      />
    );

    const btn = screen.getByTitle("Continuer la reponse");
    expect(btn).toBeTruthy();

    fireEvent.click(btn);
    expect(onContinue).toHaveBeenCalledOnce();
  });

  it("n'affiche pas le bouton continuer quand isLastAssistantMessage est false", () => {
    const onContinue = vi.fn();

    render(
      <MessageActions
        {...baseProps}
        isLastAssistantMessage={false}
        onContinue={onContinue}
      />
    );

    expect(screen.queryByTitle("Continuer la reponse")).toBeNull();
  });
});

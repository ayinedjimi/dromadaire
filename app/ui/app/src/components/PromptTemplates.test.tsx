// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PromptTemplates } from "./PromptTemplates";

describe("PromptTemplates", () => {
  const onSelectTemplate = vi.fn();
  const onModeChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders all 6 template buttons", () => {
    render(
      <PromptTemplates
        onSelectTemplate={onSelectTemplate}
        onModeChange={onModeChange}
      />,
    );

    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(6);
  });

  it("renders correct labels for each template", () => {
    render(
      <PromptTemplates
        onSelectTemplate={onSelectTemplate}
        onModeChange={onModeChange}
      />,
    );

    expect(screen.getByText(/Résumer/)).toBeTruthy();
    expect(screen.getByText(/Traduire/)).toBeTruthy();
    expect(screen.getByText(/Code/)).toBeTruthy();
    expect(screen.getByText(/Mail/)).toBeTruthy();
    expect(screen.getByText(/Page web/)).toBeTruthy();
    expect(screen.getByText(/Brainstorm/)).toBeTruthy();
  });

  it("click on template calls onSelectTemplate with the prompt text", () => {
    render(
      <PromptTemplates
        onSelectTemplate={onSelectTemplate}
        onModeChange={onModeChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Résumer/ }));
    expect(onSelectTemplate).toHaveBeenCalledOnce();
    expect(onSelectTemplate).toHaveBeenCalledWith(
      "Resume le texte suivant en points cles :\n\n",
    );
  });

  it("Traduire template sends correct prompt", () => {
    render(
      <PromptTemplates
        onSelectTemplate={onSelectTemplate}
        onModeChange={onModeChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Traduire/ }));
    expect(onSelectTemplate).toHaveBeenCalledWith(
      "Traduis le texte suivant en [langue] :\n\n",
    );
  });

  it("click on template without mode does not call onModeChange", () => {
    render(
      <PromptTemplates
        onSelectTemplate={onSelectTemplate}
        onModeChange={onModeChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Brainstorm/ }));
    expect(onSelectTemplate).toHaveBeenCalledOnce();
    expect(onModeChange).not.toHaveBeenCalled();
  });

  it("Mail activates human mode with email subMode", () => {
    render(
      <PromptTemplates
        onSelectTemplate={onSelectTemplate}
        onModeChange={onModeChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Mail/ }));
    expect(onSelectTemplate).toHaveBeenCalledOnce();
    expect(onModeChange).toHaveBeenCalledOnce();
    expect(onModeChange).toHaveBeenCalledWith({
      ResponseMode: "human",
      HumanSubMode: "email",
    });
  });

  it("Page web activates ui-ux mode with landing subMode", () => {
    render(
      <PromptTemplates
        onSelectTemplate={onSelectTemplate}
        onModeChange={onModeChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Page web/ }));
    expect(onSelectTemplate).toHaveBeenCalledWith(
      "Cree une page web moderne et belle pour ",
    );
    expect(onModeChange).toHaveBeenCalledWith({
      ResponseMode: "ui-ux",
      HumanSubMode: "landing",
    });
  });

  it("works without onModeChange prop (optional)", () => {
    render(<PromptTemplates onSelectTemplate={onSelectTemplate} />);

    fireEvent.click(screen.getByRole("button", { name: /Mail/ }));
    expect(onSelectTemplate).toHaveBeenCalledOnce();
  });

  it("all templates have uniform neutral styling", () => {
    render(
      <PromptTemplates
        onSelectTemplate={onSelectTemplate}
        onModeChange={onModeChange}
      />,
    );

    const buttons = screen.getAllByRole("button");
    for (const btn of buttons) {
      expect(btn.className).toContain("border-neutral-200");
    }
  });

  it("buttons have staggered animation delays", () => {
    render(
      <PromptTemplates
        onSelectTemplate={onSelectTemplate}
        onModeChange={onModeChange}
      />,
    );

    const buttons = screen.getAllByRole("button");
    buttons.forEach((btn, i) => {
      expect(btn.style.animationDelay).toBe(`${i * 40}ms`);
    });
  });

  it("Code template includes code fence in prompt", () => {
    render(
      <PromptTemplates
        onSelectTemplate={onSelectTemplate}
        onModeChange={onModeChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Code/ }));
    const prompt = onSelectTemplate.mock.calls[0][0] as string;
    expect(prompt).toContain("```");
  });

  it("non-mode templates do not call onModeChange", () => {
    render(
      <PromptTemplates
        onSelectTemplate={onSelectTemplate}
        onModeChange={onModeChange}
      />,
    );

    const noModeLabels = [/Résumer/, /Traduire/, /Code/, /Brainstorm/];

    for (const label of noModeLabels) {
      vi.clearAllMocks();
      fireEvent.click(screen.getByRole("button", { name: label }));
      expect(onModeChange).not.toHaveBeenCalled();
    }
  });
});

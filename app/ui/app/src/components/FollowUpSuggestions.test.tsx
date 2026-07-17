// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FollowUpSuggestions, stripFollowUps } from "./FollowUpSuggestions";

describe("stripFollowUps", () => {
  it("removes <<FOLLOWUP: text>> tags and surrounding newlines", () => {
    const content =
      "Here is my answer.\n\n<<FOLLOWUP: Tell me more>>\n<<FOLLOWUP: Another one>>\n";
    const result = stripFollowUps(content);
    expect(result).toBe("Here is my answer.");
  });

  it("returns content unchanged when no tags present", () => {
    const content = "Just a normal response with no special tags.";
    expect(stripFollowUps(content)).toBe(content);
  });

  it("handles multiple tags scattered throughout content", () => {
    const content =
      "Line one.\n<<FOLLOWUP: suggestion A>>\nLine two.\n<<FOLLOWUP: suggestion B>>";
    const result = stripFollowUps(content);
    expect(result).not.toContain("<<FOLLOWUP:");
    expect(result).toContain("Line one.");
    expect(result).toContain("Line two.");
  });
});

describe("extractFollowUps (via component)", () => {
  const onSelect = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("extracts <<FOLLOWUP: text>> tags from content and renders them", () => {
    const content =
      "Here is the answer.\n\n<<FOLLOWUP: Explain in more detail>>\n<<FOLLOWUP: Show an example>>";
    render(
      <FollowUpSuggestions assistantMessage={content} onSelect={onSelect} />,
    );

    expect(screen.getByText("Explain in more detail")).toBeTruthy();
    expect(screen.getByText("Show an example")).toBeTruthy();
  });

  it("limits to max 3 follow-ups", () => {
    const content = [
      "Long answer here.",
      "<<FOLLOWUP: First>>",
      "<<FOLLOWUP: Second>>",
      "<<FOLLOWUP: Third>>",
      "<<FOLLOWUP: Fourth>>",
      "<<FOLLOWUP: Fifth>>",
    ].join("\n");
    render(
      <FollowUpSuggestions assistantMessage={content} onSelect={onSelect} />,
    );

    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(3);
    expect(screen.getByText("First")).toBeTruthy();
    expect(screen.getByText("Second")).toBeTruthy();
    expect(screen.getByText("Third")).toBeTruthy();
    expect(screen.queryByText("Fourth")).toBeNull();
    expect(screen.queryByText("Fifth")).toBeNull();
  });

  it("filters out too-short suggestions (<=3 chars)", () => {
    const content =
      "Some answer text.\n<<FOLLOWUP: OK>>\n<<FOLLOWUP: Abc>>\n<<FOLLOWUP: This one is valid>>";
    render(
      <FollowUpSuggestions assistantMessage={content} onSelect={onSelect} />,
    );

    // "OK" (2 chars) and "Abc" (3 chars) should be filtered out (text.length > 3 required)
    expect(screen.queryByText("OK")).toBeNull();
    expect(screen.queryByText("Abc")).toBeNull();
    expect(screen.getByText("This one is valid")).toBeTruthy();
  });

  it("filters out too-long suggestions (>=100 chars)", () => {
    const longText = "A".repeat(100);
    const content = `Answer.\n<<FOLLOWUP: ${longText}>>\n<<FOLLOWUP: Valid suggestion>>`;
    render(
      <FollowUpSuggestions assistantMessage={content} onSelect={onSelect} />,
    );

    expect(screen.queryByText(longText)).toBeNull();
    expect(screen.getByText("Valid suggestion")).toBeTruthy();
  });

  it("returns nothing for content without FOLLOWUP tags when content is short", () => {
    const content = "Short answer.";
    const { container } = render(
      <FollowUpSuggestions assistantMessage={content} onSelect={onSelect} />,
    );

    // Component returns null when no suggestions
    expect(container.innerHTML).toBe("");
  });
});

describe("generateContextual (via component)", () => {
  const onSelect = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when content < 100 chars (no contextual suggestions)", () => {
    const content = "This is a short response that has no follow-up tags and is under 100 chars.";
    expect(content.length).toBeLessThan(100);
    const { container } = render(
      <FollowUpSuggestions assistantMessage={content} onSelect={onSelect} />,
    );

    expect(container.innerHTML).toBe("");
  });

  it("content with code block produces code-related suggestion", () => {
    // Must be >100 chars, have a code block (```...``` with >=10 chars inside), no FOLLOWUP tags
    const content = [
      "Here is how you can implement the feature. This is a detailed explanation that exceeds one hundred characters to trigger contextual suggestions.",
      "",
      "```",
      "function hello() {",
      '  console.log("hello world");',
      "  return true;",
      "}",
      "```",
    ].join("\n");

    render(
      <FollowUpSuggestions assistantMessage={content} onSelect={onSelect} />,
    );

    const buttons = screen.getAllByRole("button");
    // At least one suggestion should be code-related
    const buttonTexts = buttons.map((b) => b.textContent || "");
    const hasCodeRelated = buttonTexts.some(
      (t) =>
        t.includes("code") ||
        t.includes("test") ||
        t.includes("commentaire") ||
        t.includes("exemple") ||
        t.includes("erreur"),
    );
    expect(hasCodeRelated).toBe(true);
  });

  it("content with Python code block produces pytest suggestion", () => {
    const content = [
      "Here is a Python implementation that solves your problem. This explanation is long enough to pass the 100-character threshold for contextual generation.",
      "",
      "```python",
      "def calculate_sum(a, b):",
      "    return a + b",
      "",
      "result = calculate_sum(1, 2)",
      "print(result)",
      "```",
    ].join("\n");

    render(
      <FollowUpSuggestions assistantMessage={content} onSelect={onSelect} />,
    );

    const buttons = screen.getAllByRole("button");
    const buttonTexts = buttons.map((b) => b.textContent || "");
    const hasPytest = buttonTexts.some((t) => t.includes("pytest"));
    expect(hasPytest).toBe(true);
  });

  it("content with numbered list (5+ items) produces summary suggestion", () => {
    const content = [
      "Here is a comprehensive list of techniques you should consider. This is long enough to surpass the minimum threshold for follow-up generation.",
      "",
      "1. First technique for improvement",
      "2. Second technique for improvement",
      "3. Third technique for improvement",
      "4. Fourth technique for improvement",
      "5. Fifth technique for improvement",
      "6. Sixth technique for improvement",
    ].join("\n");

    render(
      <FollowUpSuggestions assistantMessage={content} onSelect={onSelect} />,
    );

    const buttons = screen.getAllByRole("button");
    const buttonTexts = buttons.map((b) => b.textContent || "");
    const hasSummary = buttonTexts.some(
      (t) =>
        t.toLowerCase().includes("resume") ||
        t.toLowerCase().includes("point"),
    );
    expect(hasSummary).toBe(true);
  });

  it("long content (>500 chars) without code produces simplify suggestion", () => {
    // Must be >500 chars, no code blocks, no FOLLOWUP tags, and trigger the hasExplanation path
    const paragraph = "This is a very detailed explanation about a complex topic that goes into significant depth. ";
    const content = paragraph.repeat(8); // ~720 chars
    expect(content.length).toBeGreaterThan(500);

    render(
      <FollowUpSuggestions assistantMessage={content} onSelect={onSelect} />,
    );

    const buttons = screen.getAllByRole("button");
    const buttonTexts = buttons.map((b) => b.textContent || "");
    const hasSimplify = buttonTexts.some(
      (t) =>
        t.toLowerCase().includes("simplif") ||
        t.toLowerCase().includes("exemple"),
    );
    expect(hasSimplify).toBe(true);
  });
});

describe("FollowUpSuggestions component", () => {
  const onSelect = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when no suggestions can be generated (short content)", () => {
    const { container } = render(
      <FollowUpSuggestions assistantMessage="Hi!" onSelect={onSelect} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders suggestion buttons and click calls onSelect with the suggestion text", () => {
    const content =
      "Here is the answer.\n\n<<FOLLOWUP: Tell me more about this>>\n<<FOLLOWUP: Can you elaborate?>>";
    render(
      <FollowUpSuggestions assistantMessage={content} onSelect={onSelect} />,
    );

    const btn = screen.getByText("Tell me more about this");
    expect(btn).toBeTruthy();
    expect(btn.tagName).toBe("BUTTON");

    fireEvent.click(btn);
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith("Tell me more about this");
  });

  it("renders all suggestion buttons with correct styling classes", () => {
    const content =
      "Answer.\n<<FOLLOWUP: First suggestion>>\n<<FOLLOWUP: Second suggestion>>";
    render(
      <FollowUpSuggestions assistantMessage={content} onSelect={onSelect} />,
    );

    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBe(2);
    // Each button should have the rounded-full class
    for (const btn of buttons) {
      expect(btn.className).toContain("rounded-full");
    }
  });

  it("calls onSelect with the correct text for each button", () => {
    const content =
      "Answer.\n<<FOLLOWUP: Alpha option>>\n<<FOLLOWUP: Beta option>>";
    render(
      <FollowUpSuggestions assistantMessage={content} onSelect={onSelect} />,
    );

    fireEvent.click(screen.getByText("Alpha option"));
    expect(onSelect).toHaveBeenCalledWith("Alpha option");

    fireEvent.click(screen.getByText("Beta option"));
    expect(onSelect).toHaveBeenCalledWith("Beta option");
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it("prioritizes FOLLOWUP tags over contextual generation", () => {
    // Content that would trigger contextual suggestions (>100 chars, code)
    // BUT also has FOLLOWUP tags, which should take priority
    const content = [
      "Here is a detailed code explanation that is long enough to trigger contextual suggestions if FOLLOWUP tags were absent.",
      "",
      "```python",
      "def hello():",
      '    print("world")',
      "```",
      "",
      "<<FOLLOWUP: My custom follow-up>>",
    ].join("\n");

    render(
      <FollowUpSuggestions assistantMessage={content} onSelect={onSelect} />,
    );

    // Should show the parsed FOLLOWUP, not the contextual "pytest" suggestion
    expect(screen.getByText("My custom follow-up")).toBeTruthy();
    expect(screen.queryByText(/pytest/)).toBeNull();
  });
});

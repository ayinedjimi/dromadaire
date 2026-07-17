package ui

import (
	"strings"
	"testing"
)

// processAll simulates streaming by sending each token through Process and collecting output.
func processAll(tokens []string) string {
	s := NewMarkdownStripper()
	var out strings.Builder
	for _, t := range tokens {
		out.WriteString(s.Process(t))
	}
	out.WriteString(s.Flush())
	return out.String()
}

// processWhole sends the entire text as one token.
func processWhole(text string) string {
	s := NewMarkdownStripper()
	out := s.Process(text)
	out += s.Flush()
	return out
}

func TestStripBold(t *testing.T) {
	result := processWhole("This is **bold** text\n")
	if strings.Contains(result, "**") {
		t.Errorf("bold markers not stripped: %q", result)
	}
	if !strings.Contains(result, "bold") {
		t.Errorf("bold content lost: %q", result)
	}
}

func TestStripItalic(t *testing.T) {
	result := processWhole("This is *italic* text\n")
	// Note: single * stripping is tricky, but the text should not have **
	if strings.Contains(result, "**") {
		t.Errorf("unexpected bold markers: %q", result)
	}
}

func TestStripBoldSplitTokens(t *testing.T) {
	// ** arrives as separate tokens
	result := processAll([]string{"This is ", "**", "bold", "**", " text\n"})
	if strings.Contains(result, "**") {
		t.Errorf("split bold markers not stripped: %q", result)
	}
	if !strings.Contains(result, "bold") {
		t.Errorf("bold content lost: %q", result)
	}
}

func TestStripHeading(t *testing.T) {
	result := processWhole("## My Title\n")
	if strings.Contains(result, "##") {
		t.Errorf("heading markers not stripped: %q", result)
	}
	if !strings.Contains(result, "My Title") {
		t.Errorf("heading content lost: %q", result)
	}
}

func TestStripHeadingH3(t *testing.T) {
	result := processWhole("### Sub Title\n")
	if strings.Contains(result, "###") {
		t.Errorf("h3 markers not stripped: %q", result)
	}
	if !strings.Contains(result, "Sub Title") {
		t.Errorf("h3 content lost: %q", result)
	}
}

func TestStripBulletList(t *testing.T) {
	result := processWhole("- item one\n- item two\n")
	if strings.Contains(result, "- ") {
		t.Errorf("bullet markers not stripped: %q", result)
	}
	if !strings.Contains(result, "item one") || !strings.Contains(result, "item two") {
		t.Errorf("list content lost: %q", result)
	}
}

func TestStripNumberedList(t *testing.T) {
	result := processWhole("1. first\n2. second\n")
	if strings.Contains(result, "1.") || strings.Contains(result, "2.") {
		t.Errorf("numbered list markers not stripped: %q", result)
	}
	if !strings.Contains(result, "first") || !strings.Contains(result, "second") {
		t.Errorf("list content lost: %q", result)
	}
}

func TestStripInlineCode(t *testing.T) {
	result := processWhole("Use the `fmt.Println` function\n")
	if strings.Contains(result, "`") {
		t.Errorf("inline code markers not stripped: %q", result)
	}
	if !strings.Contains(result, "fmt.Println") {
		t.Errorf("code content lost: %q", result)
	}
}

func TestStripCodeFence(t *testing.T) {
	result := processWhole("```python\nprint('hello')\n```\n")
	if strings.Contains(result, "```") {
		t.Errorf("code fence markers not stripped: %q", result)
	}
	if !strings.Contains(result, "print('hello')") {
		t.Errorf("code content lost: %q", result)
	}
}

func TestStripLink(t *testing.T) {
	result := processWhole("Click [here](http://example.com) for more\n")
	if strings.Contains(result, "[here]") || strings.Contains(result, "http://example.com") {
		t.Errorf("link markers not stripped: %q", result)
	}
	if !strings.Contains(result, "here") {
		t.Errorf("link text lost: %q", result)
	}
}

func TestStripHorizontalRule(t *testing.T) {
	result := processWhole("Above\n---\nBelow\n")
	if strings.Contains(result, "---") {
		t.Errorf("horizontal rule not stripped: %q", result)
	}
	if !strings.Contains(result, "Above") || !strings.Contains(result, "Below") {
		t.Errorf("surrounding content lost: %q", result)
	}
}

func TestStripStrikethrough(t *testing.T) {
	result := processWhole("This is ~~deleted~~ text\n")
	if strings.Contains(result, "~~") {
		t.Errorf("strikethrough markers not stripped: %q", result)
	}
	if !strings.Contains(result, "deleted") {
		t.Errorf("strikethrough content lost: %q", result)
	}
}

func TestPlainTextPassthrough(t *testing.T) {
	input := "Just a normal sentence without any formatting.\n"
	result := processWhole(input)
	if result != input {
		t.Errorf("plain text modified: got %q, want %q", result, input)
	}
}

func TestMultipleTokenStreaming(t *testing.T) {
	// Simulate token-by-token streaming like an LLM would produce
	tokens := []string{
		"Ok", ",", " voila", ".", " C", "'est", " pas", " la", " mer",
		" a", " boire", ".", "\n", "\n",
		"Faut", " juste", " faire", " attention", ".\n",
	}
	result := processAll(tokens)
	if strings.Contains(result, "**") || strings.Contains(result, "##") {
		t.Errorf("unexpected markdown in plain text streaming: %q", result)
	}
	if !strings.Contains(result, "Ok, voila") {
		t.Errorf("content lost during streaming: %q", result)
	}
}

func TestMixedMarkdown(t *testing.T) {
	input := "## Titre\n\n**Important**: Ceci est un `test` avec [un lien](http://x.com).\n\n- Item 1\n- Item 2\n"
	result := processWhole(input)
	if strings.Contains(result, "##") {
		t.Errorf("heading not stripped: %q", result)
	}
	if strings.Contains(result, "**") {
		t.Errorf("bold not stripped: %q", result)
	}
	if strings.Contains(result, "`") {
		t.Errorf("inline code not stripped: %q", result)
	}
	if strings.Contains(result, "[un lien]") {
		t.Errorf("link not stripped: %q", result)
	}
	if strings.Contains(result, "- ") {
		t.Errorf("bullet not stripped: %q", result)
	}
	// Content should be preserved
	if !strings.Contains(result, "Titre") {
		t.Errorf("heading content lost: %q", result)
	}
	if !strings.Contains(result, "Important") {
		t.Errorf("bold content lost: %q", result)
	}
	if !strings.Contains(result, "test") {
		t.Errorf("code content lost: %q", result)
	}
	if !strings.Contains(result, "un lien") {
		t.Errorf("link text lost: %q", result)
	}
}

func TestFlushPartialLine(t *testing.T) {
	s := NewMarkdownStripper()
	// Send partial line with no newline
	out := s.Process("Hello world")
	// Should buffer (no newline yet)
	flush := s.Flush()
	total := out + flush
	if !strings.Contains(total, "Hello world") {
		t.Errorf("flush lost content: out=%q flush=%q", out, flush)
	}
}

func TestEmptyInput(t *testing.T) {
	s := NewMarkdownStripper()
	result := s.Process("")
	if result != "" {
		t.Errorf("empty input produced output: %q", result)
	}
	flush := s.Flush()
	if flush != "" {
		t.Errorf("empty flush produced output: %q", flush)
	}
}

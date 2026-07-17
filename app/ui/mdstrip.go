package ui

import (
	"regexp"
	"strings"
)

// MarkdownStripper removes markdown formatting from streaming tokens in real-time.
// It buffers content line-by-line, stripping markdown when a complete line is available.
// Used in "human" response mode to ensure zero-markdown output regardless of model behavior.
type MarkdownStripper struct {
	lineBuf strings.Builder // Current line being accumulated
	emitted int             // Chars already emitted from current line (for partial emit)
}

// NewMarkdownStripper creates a new MarkdownStripper ready to process tokens.
func NewMarkdownStripper() *MarkdownStripper {
	return &MarkdownStripper{}
}

// Regexes for stripping (compiled once)
var (
	// Bold/italic: **text**, *text*, __text__, _text_, ***text***
	reBoldItalic3 = regexp.MustCompile(`\*{3}(.+?)\*{3}`)
	reBoldItalic2 = regexp.MustCompile(`\*{2}(.+?)\*{2}`)
	reBoldItalic1 = regexp.MustCompile(`(?:^|[^*])\*([^*]+?)\*(?:[^*]|$)`)
	reUnderscore2 = regexp.MustCompile(`__(.+?)__`)
	reUnderscore1 = regexp.MustCompile(`(?:^|[^_])_([^_]+?)_(?:[^_]|$)`)

	// Inline code: `code`
	reInlineCode = regexp.MustCompile("`([^`]+)`")

	// Links: [text](url)
	reLink = regexp.MustCompile(`\[([^\]]+)\]\([^)]+\)`)

	// Heading at line start: # Title, ## Title, ### Title
	reHeading = regexp.MustCompile(`^#{1,6}\s+`)

	// List bullets at line start: - item, * item, + item
	reBulletList = regexp.MustCompile(`^[\-\*\+]\s+`)

	// Numbered list at line start: 1. item, 2. item
	reNumberedList = regexp.MustCompile(`^\d+\.\s+`)

	// Horizontal rules: ---, ***, ___
	reHorizontalRule = regexp.MustCompile(`^[\-\*_]{3,}\s*$`)

	// Code fence: ```lang or ```
	reCodeFence = regexp.MustCompile("^```")

	// Strikethrough: ~~text~~
	reStrikethrough = regexp.MustCompile(`~~(.+?)~~`)
)

// stripLine removes markdown formatting from a single complete line.
func stripLine(line string) string {
	// Skip empty lines
	if strings.TrimSpace(line) == "" {
		return line
	}

	// Horizontal rule → empty (skip entirely)
	if reHorizontalRule.MatchString(strings.TrimSpace(line)) {
		return ""
	}

	// Code fence → skip
	if reCodeFence.MatchString(strings.TrimSpace(line)) {
		return ""
	}

	// Headings: remove # prefix
	line = reHeading.ReplaceAllString(line, "")

	// Bullet lists: remove - or * or + prefix
	line = reBulletList.ReplaceAllString(line, "")

	// Numbered lists: remove 1. prefix
	line = reNumberedList.ReplaceAllString(line, "")

	// Bold+italic (***text***) → text
	line = reBoldItalic3.ReplaceAllString(line, "$1")

	// Bold (**text**) → text
	line = reBoldItalic2.ReplaceAllString(line, "$1")

	// Underscore bold (__text__) → text
	line = reUnderscore2.ReplaceAllString(line, "$1")

	// Strikethrough (~~text~~) → text
	line = reStrikethrough.ReplaceAllString(line, "$1")

	// Inline code (`code`) → code
	line = reInlineCode.ReplaceAllString(line, "$1")

	// Links [text](url) → text
	line = reLink.ReplaceAllString(line, "$1")

	return line
}

// Process takes a streaming token and returns cleaned output.
// It buffers incomplete lines and strips markdown from complete lines.
// May return empty string if the token is still being buffered.
func (s *MarkdownStripper) Process(token string) string {
	var result strings.Builder

	for _, ch := range token {
		if ch == '\n' {
			// Complete line — strip and emit
			line := s.lineBuf.String()
			s.lineBuf.Reset()
			s.emitted = 0

			stripped := stripLine(line)
			result.WriteString(stripped)
			result.WriteRune('\n')
		} else {
			s.lineBuf.WriteRune(ch)
		}
	}

	// For responsiveness: if the line buffer is getting long (>50 chars)
	// and doesn't start with ambiguous markdown prefixes, emit a partial
	// to avoid holding tokens for too long during streaming.
	if s.lineBuf.Len() > 50 && s.emitted == 0 {
		current := s.lineBuf.String()
		// Only hold back if line starts with potential markdown
		trimmed := strings.TrimSpace(current)
		startsWithMD := strings.HasPrefix(trimmed, "#") ||
			strings.HasPrefix(trimmed, "-") ||
			strings.HasPrefix(trimmed, "*") ||
			strings.HasPrefix(trimmed, "+") ||
			strings.HasPrefix(trimmed, "`")
		if !startsWithMD {
			// Safe to partially emit — strip inline markdown from what we have
			stripped := stripLine(current)
			result.WriteString(stripped)
			s.lineBuf.Reset()
			s.emitted = len(stripped)
		}
	}

	return result.String()
}

// Flush returns any remaining buffered content. Call at end of stream.
func (s *MarkdownStripper) Flush() string {
	if s.lineBuf.Len() == 0 {
		return ""
	}
	line := s.lineBuf.String()
	s.lineBuf.Reset()
	s.emitted = 0
	return stripLine(line)
}

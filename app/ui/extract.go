//go:build windows || darwin

package ui

import (
	"bytes"
	"fmt"
	"path/filepath"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/ledongthuc/pdf"
)

// convertBytesToText converts raw file bytes to text based on file extension
func convertBytesToText(data []byte, filename string) string {
	ext := strings.ToLower(filepath.Ext(filename))

	if ext == ".pdf" {
		text, err := extractPDFText(data)
		if err != nil {
			return fmt.Sprintf("[PDF file - %d bytes - failed to extract text: %v]", len(data), err)
		}
		if strings.TrimSpace(text) == "" {
			return fmt.Sprintf("[PDF file - %d bytes - no text content found]", len(data))
		}
		return text
	}

	binaryExtensions := []string{
		".xlsx", ".pptx", ".zip", ".tar", ".gz", ".rar",
		".jpg", ".jpeg", ".png", ".gif", ".bmp", ".svg", ".ico",
		".mp3", ".mp4", ".avi", ".mov", ".wmv", ".flv", ".webm",
		".exe", ".dll", ".so", ".dylib", ".app", ".dmg", ".pkg",
	}

	if slices.Contains(binaryExtensions, ext) {
		return fmt.Sprintf("[Binary file of type %s - %d bytes]", ext, len(data))
	}

	if utf8.Valid(data) {
		return string(data)
	}

	// If not valid UTF-8, return a placeholder
	return fmt.Sprintf("[Binary file - %d bytes - not valid UTF-8]", len(data))
}

// ChunkText splits text into chunks of approximately maxTokens words each,
// with an overlap of overlapTokens words between consecutive chunks.
func ChunkText(text string, maxTokens, overlapTokens int) []string {
	words := strings.Fields(text)
	if len(words) == 0 {
		return nil
	}
	if maxTokens <= 0 {
		maxTokens = 512
	}
	if overlapTokens < 0 || overlapTokens >= maxTokens {
		overlapTokens = 0
	}

	var chunks []string
	start := 0
	for start < len(words) {
		end := start + maxTokens
		if end > len(words) {
			end = len(words)
		}
		chunk := strings.Join(words[start:end], " ")
		chunks = append(chunks, chunk)
		if end >= len(words) {
			break
		}
		start += maxTokens - overlapTokens
	}
	return chunks
}

// extractPDFText extracts text content from PDF bytes
func extractPDFText(data []byte) (string, error) {
	reader := bytes.NewReader(data)
	pdfReader, err := pdf.NewReader(reader, int64(len(data)))
	if err != nil {
		return "", fmt.Errorf("failed to create PDF reader: %w", err)
	}

	var textBuilder strings.Builder
	numPages := pdfReader.NumPage()

	for i := 1; i <= numPages; i++ {
		page := pdfReader.Page(i)
		if page.V.IsNull() {
			continue
		}

		text, err := page.GetPlainText(nil)
		if err != nil {
			// Log the error but continue with other pages
			continue
		}

		if strings.TrimSpace(text) != "" {
			if textBuilder.Len() > 0 {
				textBuilder.WriteString("\n\n--- Page ")
				textBuilder.WriteString(fmt.Sprintf("%d", i))
				textBuilder.WriteString(" ---\n")
			}
			textBuilder.WriteString(text)
		}
	}

	return textBuilder.String(), nil
}

import { useRef, useEffect, useCallback } from "react";
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching, foldGutter } from "@codemirror/language";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { css } from "@codemirror/lang-css";
import { python } from "@codemirror/lang-python";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { xml } from "@codemirror/lang-xml";
import { sql } from "@codemirror/lang-sql";
import { java } from "@codemirror/lang-java";
import { rust } from "@codemirror/lang-rust";
import { go } from "@codemirror/lang-go";
import { cpp } from "@codemirror/lang-cpp";
import { php } from "@codemirror/lang-php";
import { oneDark } from "@codemirror/theme-one-dark";

// Build a CodeMirror theme dynamically from the app's CSS custom properties.
// This ensures the editor matches all 6 Dromadaire themes (light, dark, oled, sepia, blue-night, nord).
function buildThemeFromCSSVars() {
  const root = document.documentElement;
  const style = getComputedStyle(root);
  const isDark = root.classList.contains("dark") ||
    root.classList.contains("oled") ||
    root.classList.contains("blue-night") ||
    root.classList.contains("nord");

  const hsl = (v: string) => {
    const val = style.getPropertyValue(v).trim();
    return val ? `hsl(${val})` : undefined;
  };

  const bg = hsl("--bg-000") || (isDark ? "#1a1a1a" : "#ffffff");
  const bgActive = hsl("--bg-100") || (isDark ? "#262626" : "#f5f5f5");
  const text = hsl("--text-000") || (isDark ? "#f5f5f5" : "#171717");
  const textMuted = hsl("--text-400") || (isDark ? "#737373" : "#a3a3a3");
  const border = hsl("--border-100") || (isDark ? "#404040" : "#e5e5e5");
  const selection = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)";
  const selectionFocused = isDark ? "rgba(96,165,250,0.25)" : "rgba(191,219,254,1)";

  return {
    isDark,
    theme: EditorView.theme({
      "&": {
        fontSize: "13px",
        backgroundColor: bg,
      },
      ".cm-content": {
        fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
        padding: "12px 0",
        caretColor: text,
      },
      ".cm-gutters": {
        backgroundColor: bg,
        borderRight: `1px solid ${border}`,
        color: textMuted,
      },
      ".cm-activeLineGutter": {
        backgroundColor: "transparent",
        color: text,
      },
      ".cm-activeLine": {
        backgroundColor: bgActive,
      },
      ".cm-cursor": {
        borderLeftColor: text,
      },
      ".cm-selectionBackground": {
        backgroundColor: `${selection} !important`,
      },
      "&.cm-focused .cm-selectionBackground": {
        backgroundColor: `${selectionFocused} !important`,
      },
      ".cm-foldGutter span": {
        color: textMuted,
      },
    }, { dark: isDark }),
  };
}

function getLanguageExtension(language: string) {
  switch (language) {
    case "html":
    case "svg":
      return html();
    case "css":
      return css();
    case "javascript":
    case "js":
    case "jsx":
      return javascript({ jsx: true });
    case "typescript":
    case "ts":
    case "tsx":
      return javascript({ jsx: true, typescript: true });
    case "python":
    case "py":
      return python();
    case "json":
    case "jsonc":
      return json();
    case "markdown":
    case "md":
      return markdown();
    case "xml":
    case "xsl":
    case "xhtml":
      return xml();
    case "sql":
      return sql();
    case "java":
      return java();
    case "rust":
    case "rs":
      return rust();
    case "go":
    case "golang":
      return go();
    case "c":
    case "cpp":
    case "c++":
    case "csharp":
    case "cs":
    case "h":
    case "hpp":
      return cpp();
    case "php":
      return php();
    default:
      return [];
  }
}

interface CodeEditorProps {
  code: string;
  language: string;
  onChange?: (code: string) => void;
  readOnly?: boolean;
  wordWrap?: boolean;
}

export function CodeEditor({ code, language, onChange, readOnly = false, wordWrap = true }: CodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Detect theme class for reactivity
  const themeClass = typeof document !== "undefined"
    ? document.documentElement.className
    : "";

  const createEditor = useCallback(() => {
    if (!containerRef.current) return;

    // Destroy previous instance
    if (viewRef.current) {
      viewRef.current.destroy();
      viewRef.current = null;
    }

    const { isDark, theme } = buildThemeFromCSSVars();

    const extensions = [
      lineNumbers(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      bracketMatching(),
      foldGutter(),
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      getLanguageExtension(language),
      // Dynamic theme from CSS vars
      theme,
      // oneDark provides syntax token colors for dark themes
      ...(isDark ? [oneDark] : []),
    ];

    if (wordWrap) {
      extensions.push(EditorView.lineWrapping);
    }

    if (readOnly) {
      extensions.push(EditorState.readOnly.of(true));
    }

    if (onChangeRef.current) {
      extensions.push(
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current?.(update.state.doc.toString());
          }
        }),
      );
    }

    const state = EditorState.create({
      doc: code,
      extensions,
    });

    viewRef.current = new EditorView({
      state,
      parent: containerRef.current,
    });
  }, [language, themeClass, readOnly, wordWrap]); // code intentionally excluded - handled by effect below

  // Create editor on mount and when config changes
  useEffect(() => {
    createEditor();
    return () => {
      viewRef.current?.destroy();
      viewRef.current = null;
    };
  }, [createEditor]);

  // Update content when code prop changes externally (not from user edits)
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const currentContent = view.state.doc.toString();
    if (currentContent !== code) {
      view.dispatch({
        changes: {
          from: 0,
          to: currentContent.length,
          insert: code,
        },
      });
    }
  }, [code]);

  return (
    <div
      ref={containerRef}
      className="h-full overflow-auto [&_.cm-editor]:h-full [&_.cm-editor]:outline-none [&_.cm-scroller]:overflow-auto"
    />
  );
}

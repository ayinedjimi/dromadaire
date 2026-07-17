import { useRef, useEffect, useCallback, useState } from "react";
import "@/lib/monaco-env"; // Register workers before first use
import * as monaco from "monaco-editor";

// Map our language identifiers to Monaco language IDs
function getMonacoLanguage(lang: string): string {
  const map: Record<string, string> = {
    html: "html",
    svg: "html",
    css: "css",
    javascript: "javascript",
    js: "javascript",
    jsx: "javascript",
    typescript: "typescript",
    ts: "typescript",
    tsx: "typescript",
    python: "python",
    py: "python",
    json: "json",
    jsonc: "json",
    markdown: "markdown",
    md: "markdown",
    xml: "xml",
    xsl: "xml",
    xhtml: "xml",
    sql: "sql",
    java: "java",
    rust: "rust",
    rs: "rust",
    go: "go",
    golang: "go",
    c: "c",
    cpp: "cpp",
    "c++": "cpp",
    csharp: "csharp",
    cs: "csharp",
    h: "c",
    hpp: "cpp",
    php: "php",
    bash: "shell",
    shell: "shell",
    sh: "shell",
    yaml: "yaml",
    yml: "yaml",
    dockerfile: "dockerfile",
    toml: "plaintext",
    mermaid: "plaintext",
    csv: "plaintext",
  };
  return map[lang] || "plaintext";
}

// Build Monaco theme from CSS custom properties — reads live design tokens
function buildMonacoTheme(): { isDark: boolean; themeData: monaco.editor.IStandaloneThemeData } {
  const root = document.documentElement;
  const style = getComputedStyle(root);
  const isDark =
    root.classList.contains("dark") ||
    root.classList.contains("oled") ||
    root.classList.contains("blue-night") ||
    root.classList.contains("nord");

  // Read HSL token and wrap in hsl()
  const hsl = (v: string) => {
    const val = style.getPropertyValue(v).trim();
    return val ? `hsl(${val})` : undefined;
  };

  const bg = hsl("--bg-000") || (isDark ? "#1a1a1a" : "#ffffff");
  const bgActive = hsl("--bg-100") || (isDark ? "#262626" : "#f5f5f5");
  const bgDeep = hsl("--bg-200") || (isDark ? "#1f1f1f" : "#ededed");
  const text = hsl("--text-000") || (isDark ? "#f5f5f5" : "#171717");
  const textMuted = hsl("--text-300") || (isDark ? "#a3a3a3" : "#737373");
  const textFaint = hsl("--text-400") || (isDark ? "#737373" : "#a3a3a3");
  const border = hsl("--border-100") || (isDark ? "#404040" : "#e5e5e5");
  const accent = hsl("--accent-000") || "#b37a2a";

  // Convert any CSS color string to hex for Monaco (it doesn't accept hsl())
  const toHex = (color: string): string => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
  };

  const bgHex = toHex(bg);
  const bgActiveHex = toHex(bgActive);
  const bgDeepHex = toHex(bgDeep);
  const textHex = toHex(text);
  const textMutedHex = toHex(textMuted);
  const textFaintHex = toHex(textFaint);
  const borderHex = toHex(border);
  const accentHex = toHex(accent);

  // Derive selection color from accent with alpha
  const selectionBg = isDark ? accentHex + "33" : accentHex + "22";
  const inactiveSelectionBg = isDark ? accentHex + "1a" : accentHex + "11";

  return {
    isDark,
    themeData: {
      base: isDark ? "vs-dark" : "vs",
      inherit: true,
      rules: [],
      colors: {
        "editor.background": bgHex,
        "editor.foreground": textHex,
        "editor.lineHighlightBackground": bgActiveHex,
        "editorLineNumber.foreground": textFaintHex,
        "editorLineNumber.activeForeground": textMutedHex,
        "editorGutter.background": bgHex,
        "editorCursor.foreground": accentHex,
        "editor.selectionBackground": selectionBg,
        "editor.inactiveSelectionBackground": inactiveSelectionBg,
        "editor.findMatchBackground": accentHex + "44",
        "editor.findMatchHighlightBackground": accentHex + "22",
        "editorBracketMatch.background": accentHex + "22",
        "editorBracketMatch.border": accentHex + "66",
        "editorIndentGuide.background": borderHex + "66",
        "editorIndentGuide.activeBackground": borderHex,
        "editorWidget.background": bgActiveHex,
        "editorWidget.border": borderHex,
        "editorSuggestWidget.background": bgActiveHex,
        "editorSuggestWidget.border": borderHex,
        "editorSuggestWidget.selectedBackground": bgDeepHex,
        "editorHoverWidget.background": bgActiveHex,
        "editorHoverWidget.border": borderHex,
        "input.background": bgHex,
        "input.border": borderHex,
        "scrollbar.shadow": "#00000000",
        "scrollbarSlider.background": textFaintHex + "33",
        "scrollbarSlider.hoverBackground": textFaintHex + "55",
        "scrollbarSlider.activeBackground": textFaintHex + "77",
        "editorOverviewRuler.border": "#00000000",
      },
    },
  };
}

interface MonacoCodeEditorProps {
  code: string;
  language: string;
  onChange?: (code: string) => void;
  readOnly?: boolean;
  wordWrap?: boolean;
  fontSize?: number;
}

export function MonacoCodeEditor({
  code,
  language,
  onChange,
  readOnly = false,
  wordWrap = true,
  fontSize = 13,
}: MonacoCodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Reactive theme tracking via MutationObserver on <html> class
  const [themeClass, setThemeClass] = useState(
    typeof document !== "undefined" ? document.documentElement.className : ""
  );

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setThemeClass(document.documentElement.className);
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  const createEditor = useCallback(() => {
    if (!containerRef.current) return;

    // Destroy previous instance
    if (editorRef.current) {
      editorRef.current.dispose();
      editorRef.current = null;
    }

    // Build and register theme
    const { themeData } = buildMonacoTheme();
    monaco.editor.defineTheme("dromadaire", themeData);

    const editor = monaco.editor.create(containerRef.current, {
      value: code,
      language: getMonacoLanguage(language),
      theme: "dromadaire",
      readOnly,
      wordWrap: wordWrap ? "on" : "off",
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontSize,
      fontFamily:
        "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
      lineNumbers: "on",
      renderLineHighlight: "line",
      overviewRulerLanes: 0,
      hideCursorInOverviewRuler: true,
      overviewRulerBorder: false,
      scrollbar: {
        vertical: "auto",
        horizontal: "auto",
        verticalScrollbarSize: 10,
        horizontalScrollbarSize: 10,
      },
      padding: { top: 12, bottom: 12 },
      automaticLayout: true,
      bracketPairColorization: { enabled: true },
      folding: true,
      tabSize: 2,
      insertSpaces: true,
      contextmenu: false,
    });

    // Listen for changes
    if (onChangeRef.current) {
      editor.onDidChangeModelContent(() => {
        onChangeRef.current?.(editor.getValue());
      });
    }

    // Prevent Ctrl+S from triggering browser save
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      // No-op: suppress browser save dialog
    });

    editorRef.current = editor;
  }, [language, readOnly, wordWrap]); // code, fontSize, themeClass intentionally excluded

  // Create editor on mount and when structural config changes
  useEffect(() => {
    createEditor();
    return () => {
      editorRef.current?.dispose();
      editorRef.current = null;
    };
  }, [createEditor]);

  // Update theme in-place when app theme changes (no editor recreation)
  useEffect(() => {
    if (!editorRef.current) return;
    const { themeData } = buildMonacoTheme();
    monaco.editor.defineTheme("dromadaire", themeData);
    monaco.editor.setTheme("dromadaire");
  }, [themeClass]);

  // Update fontSize in-place (preserves cursor, scroll, undo history)
  useEffect(() => {
    editorRef.current?.updateOptions({ fontSize });
  }, [fontSize]);

  // Update content when code prop changes externally
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const currentValue = editor.getValue();
    if (currentValue !== code) {
      editor.setValue(code);
    }
  }, [code]);

  return (
    <div ref={containerRef} className="h-full w-full overflow-hidden" />
  );
}

import { createHighlighter } from "shiki";
import type { ThemeRegistration } from "shiki";
import { useState, useEffect } from "react";

const oneLightTheme: ThemeRegistration = {
  name: "one-light",
  type: "light",
  colors: {
    "editor.background": "#fafafa",
    "editor.foreground": "#383a42",
  },
  tokenColors: [
    {
      scope: ["comment", "punctuation.definition.comment"],
      settings: { foreground: "#a0a1a7" },
    },
    {
      scope: ["keyword", "storage.type", "storage.modifier"],
      settings: { foreground: "#a626a4" },
    },
    { scope: ["string", "string.quoted"], settings: { foreground: "#50a14f" } },
    {
      scope: ["function", "entity.name.function", "support.function"],
      settings: { foreground: "#4078f2" },
    },
    {
      scope: [
        "constant.numeric",
        "constant.language",
        "constant.character",
        "number",
      ],
      settings: { foreground: "#c18401" },
    },
    {
      scope: ["variable", "support.variable"],
      settings: { foreground: "#e45649" },
    },
    {
      scope: ["entity.name.tag", "entity.name.type", "entity.name.class"],
      settings: { foreground: "#e45649" },
    },
    {
      scope: ["entity.other.attribute-name"],
      settings: { foreground: "#c18401" },
    },
    {
      scope: ["keyword.operator", "operator"],
      settings: { foreground: "#a626a4" },
    },
    { scope: ["punctuation"], settings: { foreground: "#383a42" } },
    {
      scope: ["markup.heading"],
      settings: { foreground: "#e45649", fontStyle: "bold" },
    },
    {
      scope: ["markup.bold"],
      settings: { foreground: "#c18401", fontStyle: "bold" },
    },
    {
      scope: ["markup.italic"],
      settings: { foreground: "#a626a4", fontStyle: "italic" },
    },
  ],
};

const oneDarkTheme: ThemeRegistration = {
  name: "one-dark",
  type: "dark",
  colors: {
    "editor.background": "#282c34",
    "editor.foreground": "#abb2bf",
  },
  tokenColors: [
    {
      scope: ["comment", "punctuation.definition.comment"],
      settings: { foreground: "#5c6370" },
    },
    {
      scope: ["keyword", "storage.type", "storage.modifier"],
      settings: { foreground: "#c678dd" },
    },
    { scope: ["string", "string.quoted"], settings: { foreground: "#98c379" } },
    {
      scope: ["function", "entity.name.function", "support.function"],
      settings: { foreground: "#61afef" },
    },
    {
      scope: [
        "constant.numeric",
        "constant.language",
        "constant.character",
        "number",
      ],
      settings: { foreground: "#d19a66" },
    },
    {
      scope: ["variable", "support.variable"],
      settings: { foreground: "#e06c75" },
    },
    {
      scope: ["entity.name.tag", "entity.name.type", "entity.name.class"],
      settings: { foreground: "#e06c75" },
    },
    {
      scope: ["entity.other.attribute-name"],
      settings: { foreground: "#d19a66" },
    },
    {
      scope: ["keyword.operator", "operator"],
      settings: { foreground: "#c678dd" },
    },
    { scope: ["punctuation"], settings: { foreground: "#abb2bf" } },
    {
      scope: ["markup.heading"],
      settings: { foreground: "#e06c75", fontStyle: "bold" },
    },
    {
      scope: ["markup.bold"],
      settings: { foreground: "#d19a66", fontStyle: "bold" },
    },
    {
      scope: ["markup.italic"],
      settings: { foreground: "#c678dd", fontStyle: "italic" },
    },
  ],
};

export let highlighter: Awaited<ReturnType<typeof createHighlighter>> | null =
  null;

// Reactive listener set — notifies React hooks when highlighter is ready
const readyListeners = new Set<() => void>();

export const highlighterPromise = createHighlighter({
  themes: [oneLightTheme, oneDarkTheme],
  langs: [
    "javascript",
    "typescript",
    "python",
    "bash",
    "shell",
    "powershell",
    "json",
    "html",
    "css",
    "tsx",
    "jsx",
    "go",
    "rust",
    "java",
    "c",
    "cpp",
    "csharp",
    "sql",
    "swift",
    "yaml",
    "markdown",
    "dockerfile",
    "toml",
    "xml",
    "ruby",
    "php",
    "lua",
    "kotlin",
  ],
}).then((h) => {
  highlighter = h;
  readyListeners.forEach((fn) => fn());
  readyListeners.clear();
  return h;
}).catch((err) => {
  console.error("[Shiki] Failed to load highlighter:", err);
  return null;
});

/** React hook — returns null until Shiki is loaded, then triggers a re-render. */
export function useHighlighter() {
  const [hl, setHl] = useState(highlighter);
  useEffect(() => {
    if (highlighter) {
      setHl(highlighter);
      return;
    }
    const onReady = () => setHl(highlighter);
    readyListeners.add(onReady);
    return () => {
      readyListeners.delete(onReady);
    };
  }, []);
  return hl;
}

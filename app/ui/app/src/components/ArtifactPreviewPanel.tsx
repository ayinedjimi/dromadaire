import React, { useState, useRef, useEffect, useCallback, Suspense } from "react";
import { X, Code, Eye, DownloadSimple, ArrowCounterClockwise, Columns, Warning, ArrowsOut, ArrowsIn, MagnifyingGlassMinus, MagnifyingGlassPlus, ArrowSquareOut, Terminal } from "@phosphor-icons/react";
import DOMPurify from "dompurify";
import CopyButton from "./CopyButton";

// LOT Perf: Lazy-load Monaco (~4MB) — only fetched when Code/Split tab opens
const LazyMonacoCodeEditor = React.lazy(() =>
  import("./MonacoCodeEditor").then(m => ({ default: m.MonacoCodeEditor }))
);
import { parseCSVLine, markdownToHtml, buildHTMLBlobContent, buildJSBlobContent, getThemeClasses } from "@/lib/renderers";
import { hasLocalLibs, downloadAsZip } from "@/lib/zipExport";

// Languages that can be rendered live (iframe, SVG, Mermaid diagram, JS execution)
export const RENDERABLE_LANGUAGES = ["html", "svg", "mermaid", "csv", "json", "markdown", "md", "javascript", "js"] as const;
export type RenderableLanguage = (typeof RENDERABLE_LANGUAGES)[number];

export function isRenderable(lang: string): lang is RenderableLanguage {
  return RENDERABLE_LANGUAGES.includes(lang as RenderableLanguage);
}

export interface ArtifactPreviewData {
  code: string;
  language: string;
  title?: string;
  isStreaming?: boolean;
}

interface ArtifactPreviewPanelProps {
  artifact: ArtifactPreviewData;
  onClose: () => void;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
}

// Language display names
const LANG_LABELS: Record<string, string> = {
  html: "HTML", svg: "SVG", mermaid: "Mermaid",
  javascript: "JavaScript", js: "JavaScript", jsx: "JSX",
  typescript: "TypeScript", ts: "TypeScript", tsx: "TSX",
  python: "Python", py: "Python", rust: "Rust", go: "Go",
  java: "Java", cpp: "C++", c: "C", csharp: "C#", cs: "C#",
  php: "PHP", sql: "SQL", json: "JSON", markdown: "Markdown",
  md: "Markdown", xml: "XML", css: "CSS", bash: "Bash",
  shell: "Shell", yaml: "YAML", yml: "YAML",
  dockerfile: "Dockerfile", toml: "TOML", csv: "CSV",
};

// File extensions for download
const LANG_EXTENSIONS: Record<string, string> = {
  html: ".html", svg: ".svg", mermaid: ".mmd",
  javascript: ".js", js: ".js", jsx: ".jsx",
  typescript: ".ts", ts: ".ts", tsx: ".tsx",
  python: ".py", py: ".py", rust: ".rs", go: ".go",
  java: ".java", cpp: ".cpp", c: ".c", csharp: ".cs", cs: ".cs",
  php: ".php", sql: ".sql", json: ".json", markdown: ".md",
  md: ".md", xml: ".xml", css: ".css", bash: ".sh",
  shell: ".sh", yaml: ".yaml", yml: ".yml",
  dockerfile: "Dockerfile", toml: ".toml", csv: ".csv",
};

// Monotonic counter for unique Mermaid render IDs
let mermaidIdCounter = 0;

type TabView = "preview" | "code" | "split";

export function ArtifactPreviewPanel({
  artifact,
  onClose,
  isFullscreen = false,
  onToggleFullscreen,
}: ArtifactPreviewPanelProps) {
  const renderable = isRenderable(artifact.language);
  const [activeTab, setActiveTab] = useState<TabView>(renderable ? "preview" : "code");
  const [editedCode, setEditedCode] = useState(artifact.code);
  const [originalCode, setOriginalCode] = useState(artifact.code);
  const [error, setError] = useState<string | null>(null);
  const [userEdited, setUserEdited] = useState(false);
  const [fontSize, setFontSize] = useState(13);
  const [consoleMessages, setConsoleMessages] = useState<{ level: string; text: string; ts: number }[]>([]);
  const [showConsole, setShowConsole] = useState(false);
  const mermaidRef = useRef<HTMLDivElement>(null);
  const splitMermaidRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const splitIframeRef = useRef<HTMLIFrameElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const prevArtifactRef = useRef({ lang: artifact.language, code: artifact.code });
  const blobUrlRef = useRef<string | null>(null);
  const splitBlobUrlRef = useRef<string | null>(null);

  const isJSLang = artifact.language === "javascript" || artifact.language === "js";
  const isHTMLorJS = artifact.language === "html" || isJSLang;
  const label = artifact.title || LANG_LABELS[artifact.language] || artifact.language || "Code";
  const liveCode = userEdited ? editedCode : artifact.code;

  // ── LOT A4: Download handler (ZIP for HTML with local libs, PNG for Mermaid) ──
  const handleDownload = useCallback(async () => {
    // HTML with /libs/ references → export as ZIP with all dependencies
    if (artifact.language === "html" && hasLocalLibs(liveCode)) {
      await downloadAsZip(liveCode, artifact.title || "artifact");
      return;
    }
    // Mermaid → export rendered SVG as PNG (2x retina)
    if (artifact.language === "mermaid") {
      const targetRef = activeTab === "split" ? splitMermaidRef : mermaidRef;
      const svgEl = targetRef.current?.querySelector("svg");
      if (!svgEl) return;
      const svgData = new XMLSerializer().serializeToString(svgEl);
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const img = new Image();
      const svgBlob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(svgBlob);
      img.onload = () => {
        canvas.width = img.naturalWidth * 2;
        canvas.height = img.naturalHeight * 2;
        ctx.scale(2, 2);
        ctx.drawImage(img, 0, 0);
        canvas.toBlob((blob) => {
          if (!blob) return;
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = (artifact.title || "mermaid-diagram") + ".png";
          a.click();
          URL.revokeObjectURL(a.href);
        }, "image/png");
        URL.revokeObjectURL(url);
      };
      img.src = url;
      return;
    }
    // Default: single file download
    const ext = LANG_EXTENSIONS[artifact.language] || ".txt";
    const filename = (artifact.title || "artifact") + ext;
    const blob = new Blob([liveCode], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [liveCode, artifact.language, artifact.title, activeTab]);

  // ── LOT A5: Revert to original ──
  const handleRevert = useCallback(() => {
    setUserEdited(false);
    setEditedCode(originalCode);
  }, [originalCode]);

  // ── Open HTML/JS in new browser tab ──
  const handleOpenInTab = useCallback(() => {
    const { classes, isDark } = getThemeClasses();
    const fullDoc = isJSLang
      ? buildJSBlobContent(liveCode, { theme: classes, isDark })
      : buildHTMLBlobContent(liveCode, { theme: classes, isDark });
    const blob = new Blob([fullDoc], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }, [liveCode, isJSLang]);

  // ── Mermaid rendering ──
  const mermaidTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const renderMermaid = useCallback(async (code: string, targetRef: React.RefObject<HTMLDivElement | null>) => {
    if (!targetRef.current) return;
    try {
      const mermaid = (await import("mermaid")).default;
      const isDark = document.documentElement.classList.contains("dark");
      mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: isDark ? "dark" : "default" });
      const { svg } = await mermaid.render(`mermaid-panel-${++mermaidIdCounter}`, code);
      if (targetRef.current) {
        targetRef.current.innerHTML = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true } });
      }
      setError(null);
    } catch (e) {
      // LOT C2: Parse mermaid error for better display
      const msg = e instanceof Error ? e.message : String(e);
      const lineMatch = msg.match(/line (\d+)/i);
      setError(lineMatch
        ? `Erreur Mermaid ligne ${lineMatch[1]}: ${msg.split("\n")[0]}`
        : `Erreur Mermaid: ${msg.split("\n")[0]}`
      );
    }
  }, []);

  useEffect(() => {
    if ((activeTab === "preview" || activeTab === "split") && artifact.language === "mermaid") {
      clearTimeout(mermaidTimerRef.current);
      mermaidTimerRef.current = setTimeout(() => {
        renderMermaid(liveCode, activeTab === "split" ? splitMermaidRef : mermaidRef);
      }, 500);
      return () => clearTimeout(mermaidTimerRef.current);
    }
  }, [activeTab, artifact.language, liveCode, renderMermaid]);

  // ── iframe HTML rendering via blob URL ──
  const renderIframe = useCallback((
    iframe: HTMLIFrameElement | null,
    blobRef: React.MutableRefObject<string | null>,
    code: string,
    lang: string,
  ) => {
    if (!iframe) return;
    if (blobRef.current) {
      URL.revokeObjectURL(blobRef.current);
      blobRef.current = null;
    }
    const { classes, isDark } = getThemeClasses();
    const isJS = lang === "javascript" || lang === "js";
    const fullDoc = isJS
      ? buildJSBlobContent(code, { theme: classes, isDark })
      : buildHTMLBlobContent(code, { theme: classes, isDark });
    const blob = new Blob([fullDoc], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    blobRef.current = url;
    iframe.src = url;
  }, []);

  useEffect(() => {
    if ((activeTab === "preview" || activeTab === "split") && (artifact.language === "html" || isJSLang)) {
      if (activeTab === "split") {
        renderIframe(splitIframeRef.current, splitBlobUrlRef, liveCode, artifact.language);
      } else {
        renderIframe(iframeRef.current, blobUrlRef, liveCode, artifact.language);
      }
    }
  }, [activeTab, artifact.language, liveCode, renderIframe, isJSLang]);

  // Cleanup blob URLs on unmount
  useEffect(() => {
    return () => {
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
      if (splitBlobUrlRef.current) URL.revokeObjectURL(splitBlobUrlRef.current);
    };
  }, []);

  // Theme sync: re-render iframe when app theme changes
  useEffect(() => {
    if (!isHTMLorJS) return;
    const observer = new MutationObserver(() => {
      if (activeTab === "preview" || activeTab === "split") {
        if (activeTab === "split") {
          renderIframe(splitIframeRef.current, splitBlobUrlRef, liveCode, artifact.language);
        } else {
          renderIframe(iframeRef.current, blobUrlRef, liveCode, artifact.language);
        }
      }
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, [isHTMLorJS, artifact.language, activeTab, liveCode, renderIframe]);

  // Listen for iframe postMessages (height + console)
  const [iframeHeight, setIframeHeight] = useState(300);
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === "iframe-height" && typeof e.data.height === "number") {
        setIframeHeight(Math.max(200, Math.min(2000, e.data.height + 32)));
      }
      if (e.data?.type === "iframe-console" && typeof e.data.text === "string") {
        setConsoleMessages(prev => [
          ...prev.slice(-199),
          { level: e.data.level || "log", text: e.data.text, ts: Date.now() },
        ]);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  // ── Reset on artifact change ──
  useEffect(() => {
    const prev = prevArtifactRef.current;
    const langChanged = artifact.language !== prev.lang;
    const sameLanguageSwap = !langChanged && artifact.code !== prev.code && Math.abs(artifact.code.length - prev.code.length) > 50;

    if (langChanged || sameLanguageSwap) {
      setError(null);
      setUserEdited(false);
      setEditedCode(artifact.code);
      setOriginalCode(artifact.code);
      setConsoleMessages([]);
      setShowConsole(false);
      if (blobUrlRef.current) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = null; }
      if (splitBlobUrlRef.current) { URL.revokeObjectURL(splitBlobUrlRef.current); splitBlobUrlRef.current = null; }
      if (langChanged) {
        setActiveTab(isRenderable(artifact.language) ? "preview" : "code");
      }
    }
    prevArtifactRef.current = { lang: artifact.language, code: artifact.code };
  }, [artifact.language, artifact.code]);

  // Sync editedCode when user hasn't edited
  useEffect(() => {
    if (!userEdited) {
      setEditedCode(artifact.code);
      setOriginalCode(artifact.code);
    }
  }, [artifact.code, userEdited]);

  // D3: Focus trap — auto-focus panel on mount, Escape to close
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      // Don't interfere when focus is inside Monaco editor (Tab = indent, Escape = close autocomplete)
      if (target?.closest?.(".monaco-editor")) return;
      if (e.key === "Escape") onClose();
      // D3: Focus trap — Tab cycles within panel buttons (not Monaco)
      if (e.key === "Tab" && panelRef.current) {
        const focusable = panelRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleCodeChange = useCallback((newCode: string) => {
    setUserEdited(true);
    setEditedCode(newCode);
  }, []);

  // ── LOT C3 + F1: CSV parser with RFC 4180 support ──
  const renderCSV = (code: string) => {
    const trimmed = code.trim();
    if (!trimmed) return <div className="p-4 text-sm text-neutral-500">Fichier CSV vide</div>;
    const lines = trimmed.split("\n");
    const headers = parseCSVLine(lines[0]);
    const rows = lines.slice(1).filter(l => l.trim()).map(l => parseCSVLine(l));
    return (
      <div className="p-4 overflow-auto h-full">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-[hsl(var(--bg-100))]">
              {headers.map((h, i) => (
                <th key={i} className="px-3 py-2 text-left font-semibold border-b border-[hsl(var(--border-100))] text-[hsl(var(--text-100))]">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="hover:bg-[hsl(var(--bg-100))]">
                {row.map((cell, j) => (
                  <td key={j} className="px-3 py-1.5 border-b border-[hsl(var(--border-100)/50%)] text-[hsl(var(--text-200))]">{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  // ── LOT C3: JSON tree view ──
  const renderJSON = (code: string) => {
    try {
      const parsed = JSON.parse(code);
      // LOT C4: Auto-format JSON
      const formatted = JSON.stringify(parsed, null, 2);
      return (
        <pre className="p-4 overflow-auto h-full text-xs font-mono text-[hsl(var(--text-100))] whitespace-pre-wrap">
          {formatted}
        </pre>
      );
    } catch (e) {
      return (
        <div className="p-4">
          <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 text-xs mb-2">
            <Warning className="h-4 w-4" />
            JSON invalide: {e instanceof Error ? e.message : String(e)}
          </div>
          <pre className="text-xs font-mono text-neutral-500 whitespace-pre-wrap">{code}</pre>
        </div>
      );
    }
  };

  // ── LOT C3 + F2: Enhanced Markdown preview ──
  const renderMarkdown = (code: string) => {
    const html = markdownToHtml(code);
    const clean = DOMPurify.sanitize(html);
    return (
      <div className="p-4 overflow-auto h-full prose prose-sm dark:prose-invert max-w-full"
        dangerouslySetInnerHTML={{ __html: clean }}
      />
    );
  };

  // ── Preview content ──
  const renderPreview = (targetMermaidRef?: React.RefObject<HTMLDivElement | null>, targetIframeRef?: React.RefObject<HTMLIFrameElement | null>) => {
    // LOT C2: Better error display
    if (error) {
      return (
        <div className="p-4">
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950">
            <Warning className="h-4 w-4 text-red-500 dark:text-red-400 mt-0.5 flex-shrink-0" />
            <div className="text-xs text-red-600 dark:text-red-400 font-mono whitespace-pre-wrap">{error}</div>
          </div>
        </div>
      );
    }
    if (artifact.language === "svg") {
      return (
        <div className="p-4 flex items-center justify-center h-full bg-[hsl(var(--bg-100))]">
          <div className="[&_svg]:max-w-full [&_svg]:h-auto"
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(liveCode, { USE_PROFILES: { svg: true }, FORBID_TAGS: ["script", "iframe", "object", "embed"], FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "onfocus", "onblur"] }) }}
          />
        </div>
      );
    }
    if (artifact.language === "mermaid") {
      return (
        <div className="p-4 flex items-center justify-center h-full bg-[hsl(var(--bg-100))]">
          <div ref={targetMermaidRef || mermaidRef} className="[&_svg]:max-w-full" />
        </div>
      );
    }
    // LOT C3: CSV preview
    if (artifact.language === "csv") {
      return renderCSV(liveCode);
    }
    // LOT C3: JSON preview
    if (artifact.language === "json") {
      return renderJSON(liveCode);
    }
    // LOT C3: Markdown preview
    if (artifact.language === "markdown" || artifact.language === "md") {
      return renderMarkdown(liveCode);
    }
    // JavaScript + HTML with blob URL + auto-resize
    return (
      <iframe ref={targetIframeRef || iframeRef}
        sandbox={isJSLang ? "allow-scripts allow-forms" : "allow-scripts allow-same-origin allow-forms"}
        className="w-full border-0 bg-[hsl(var(--bg-000))] transition-[height] duration-200"
        style={{ height: iframeHeight }}
        title="Artifact Preview" />
    );
  };

  return (
    <div ref={panelRef} tabIndex={-1} className="flex flex-col h-full bg-[hsl(var(--bg-000))] border-l border-[hsl(var(--border-100))] outline-none">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-[hsl(var(--border-100))] flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[11px] font-semibold tracking-wide text-[hsl(var(--text-300))] bg-[hsl(var(--bg-100))] rounded px-1.5 py-0.5 font-mono uppercase flex-shrink-0">
            {artifact.language || "code"}
          </span>
          <span className="text-sm font-medium text-[hsl(var(--text-000))] truncate">
            {label}
          </span>
          {/* LOT B2: Streaming indicator */}
          {artifact.isStreaming && (
            <span className="flex items-center gap-1 text-[10px] text-blue-500 dark:text-blue-400">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
              streaming
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          {/* P1: Font size controls */}
          <button onClick={() => setFontSize(s => Math.max(10, s - 1))}
            title="Reduire la taille" aria-label="Réduire la taille du texte"
            className="rounded-md p-1.5 text-[hsl(var(--text-400))] hover:bg-[hsl(var(--bg-100))] hover:text-[hsl(var(--text-100))] transition-colors cursor-pointer">
            <MagnifyingGlassMinus className="h-4 w-4" />
          </button>
          <span className="text-[10px] text-[hsl(var(--text-400))] w-5 text-center tabular-nums">{fontSize}</span>
          <button onClick={() => setFontSize(s => Math.min(24, s + 1))}
            title="Augmenter la taille" aria-label="Augmenter la taille du texte"
            className="rounded-md p-1.5 text-[hsl(var(--text-400))] hover:bg-[hsl(var(--bg-100))] hover:text-[hsl(var(--text-100))] transition-colors cursor-pointer">
            <MagnifyingGlassPlus className="h-4 w-4" />
          </button>
          <div className="w-px h-4 bg-[hsl(var(--border-100))] mx-0.5" />
          {/* LOT A5: Revert button */}
          {userEdited && (
            <button onClick={handleRevert}
              title="Revenir a l'original" aria-label="Revenir à la version d'origine"
              className="rounded-md p-1.5 text-amber-500 hover:bg-amber-50 hover:text-amber-600 dark:hover:bg-amber-950 dark:hover:text-amber-400 transition-colors cursor-pointer">
              <ArrowCounterClockwise className="h-4 w-4" />
            </button>
          )}
          {/* LOT A4: Download button (PNG for Mermaid) */}
          <button onClick={handleDownload}
            title={artifact.language === "mermaid" ? "Telecharger PNG" : "Telecharger"} aria-label={artifact.language === "mermaid" ? "Télécharger le diagramme en PNG" : "Télécharger le fichier"}
            className="rounded-md p-1.5 text-[hsl(var(--text-400))] hover:bg-[hsl(var(--bg-100))] hover:text-[hsl(var(--text-100))] transition-colors cursor-pointer">
            <DownloadSimple className="h-4 w-4" />
          </button>
          {/* Open in new tab (HTML + JS) */}
          {isHTMLorJS && (
            <button onClick={handleOpenInTab}
              title="Ouvrir dans un nouvel onglet" aria-label="Ouvrir dans un nouvel onglet"
              className="rounded-md p-1.5 text-[hsl(var(--text-400))] hover:bg-[hsl(var(--bg-100))] hover:text-[hsl(var(--text-100))] transition-colors cursor-pointer">
              <ArrowSquareOut className="h-4 w-4" />
            </button>
          )}
          {/* Console toggle (HTML + JS) */}
          {isHTMLorJS && (
            <button onClick={() => setShowConsole(s => !s)}
              title="Console" aria-label="Basculer la console JavaScript"
              className={`relative rounded-md p-1.5 transition-colors cursor-pointer ${
                showConsole
                  ? "text-[hsl(var(--accent-000))] bg-[hsl(var(--bg-100))]"
                  : "text-[hsl(var(--text-400))] hover:bg-[hsl(var(--bg-100))] hover:text-[hsl(var(--text-100))]"
              }`}>
              <Terminal className="h-4 w-4" />
              {consoleMessages.length > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[16px] h-4 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center px-1">
                  {consoleMessages.length > 99 ? "99+" : consoleMessages.length}
                </span>
              )}
            </button>
          )}
          <CopyButton content={liveCode} className="text-[hsl(var(--text-400))] hover:text-[hsl(var(--text-100))]" />
          {/* P2: Fullscreen toggle */}
          {onToggleFullscreen && (
            <button onClick={onToggleFullscreen}
              title={isFullscreen ? "Quitter le plein ecran" : "Plein ecran"}
              aria-label={isFullscreen ? "Quitter le plein écran" : "Plein écran"}
              className="rounded-md p-1.5 text-[hsl(var(--text-400))] hover:bg-[hsl(var(--bg-100))] hover:text-[hsl(var(--text-100))] transition-colors cursor-pointer">
              {isFullscreen ? <ArrowsIn className="h-4 w-4" /> : <ArrowsOut className="h-4 w-4" />}
            </button>
          )}
          <button onClick={onClose} aria-label="Fermer le panneau"
            className="rounded-md p-1.5 text-[hsl(var(--text-400))] hover:bg-[hsl(var(--bg-100))] hover:text-[hsl(var(--text-100))] transition-colors cursor-pointer">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Tabs (renderable languages only) */}
      {renderable && (
        <div className="flex items-center gap-1 px-3 py-1.5 border-b border-[hsl(var(--border-100))] flex-shrink-0 bg-[hsl(var(--bg-100))]">
          <TabButton active={activeTab === "preview"} onClick={() => setActiveTab("preview")}
            icon={<Eye className="h-3.5 w-3.5" />} label="Apercu" />
          <TabButton active={activeTab === "code"} onClick={() => setActiveTab("code")}
            icon={<Code className="h-3.5 w-3.5" />} label="Code" />
          {/* LOT E2: Split view button */}
          <TabButton active={activeTab === "split"} onClick={() => setActiveTab("split")}
            icon={<Columns className="h-3.5 w-3.5" />} label="Split" />
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-hidden min-h-0">
        {activeTab === "code" ? (
          <Suspense fallback={<div className="flex items-center justify-center h-full text-[hsl(var(--text-300))]">Chargement de l'éditeur...</div>}>
            <LazyMonacoCodeEditor code={liveCode} language={artifact.language} onChange={handleCodeChange} fontSize={fontSize} />
          </Suspense>
        ) : activeTab === "split" ? (
          /* LOT E2: Split view — code left, preview right */
          <div className="flex h-full">
            <div className="w-1/2 border-r border-[hsl(var(--border-100))] min-w-0">
              <Suspense fallback={<div className="flex items-center justify-center h-full text-[hsl(var(--text-300))]">Chargement...</div>}>
                <LazyMonacoCodeEditor code={liveCode} language={artifact.language} onChange={handleCodeChange} fontSize={fontSize} />
              </Suspense>
            </div>
            <div className="w-1/2 overflow-auto min-w-0">
              {renderPreview(splitMermaidRef, splitIframeRef)}
            </div>
          </div>
        ) : (
          <div className="overflow-auto h-full">
            {renderPreview()}
          </div>
        )}
      </div>

      {/* Console panel (HTML only) */}
      {showConsole && isHTMLorJS && (
        <div className="flex-shrink-0 border-t border-[hsl(var(--border-100))]">
          <div className="flex items-center justify-between px-3 py-1 bg-[hsl(var(--bg-100))]">
            <span className="text-[11px] font-medium text-[hsl(var(--text-300))]">Console</span>
            <button onClick={() => setConsoleMessages([])}
              className="text-[10px] text-[hsl(var(--text-400))] hover:text-[hsl(var(--text-100))] cursor-pointer">
              Effacer
            </button>
          </div>
          <div className="max-h-[150px] overflow-auto bg-[hsl(var(--bg-000))] p-2 font-mono text-xs">
            {consoleMessages.length === 0 ? (
              <div className="text-[hsl(var(--text-400))] text-[11px]">Aucun message</div>
            ) : (
              consoleMessages.map((msg, i) => (
                <div key={i} className={`py-0.5 border-b border-[hsl(var(--border-100)/30%)] ${
                  msg.level === "error" ? "text-red-500" :
                  msg.level === "warn" ? "text-amber-500" :
                  "text-[hsl(var(--text-100))]"
                }`}>
                  <span className="text-[10px] text-[hsl(var(--text-400))] mr-2">
                    {msg.level === "error" ? "ERR" : msg.level === "warn" ? "WRN" : msg.level === "info" ? "INF" : "LOG"}
                  </span>
                  {msg.text}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
        active
          ? "bg-[hsl(var(--bg-200))] text-[hsl(var(--text-000))]"
          : "text-[hsl(var(--text-400))] hover:text-[hsl(var(--text-100))] hover:bg-[hsl(var(--bg-100))]"
      }`}>
      {icon}{label}
    </button>
  );
}

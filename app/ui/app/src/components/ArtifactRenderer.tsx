import { useState, useRef, useEffect, useCallback } from "react";
import DOMPurify from "dompurify";
import { DownloadSimple } from "@phosphor-icons/react";

import type { RenderableLanguage } from "./ArtifactPreviewPanel";
import { parseCSVLine, markdownToHtml, buildHTMLBlobContent, buildJSBlobContent, getThemeClasses } from "@/lib/renderers";

// Monotonic counter for unique Mermaid render IDs
let mermaidInlineIdCounter = 0;

interface ArtifactRendererProps {
  code: string;
  language: RenderableLanguage;
}

export function ArtifactRenderer({ code, language }: ArtifactRendererProps) {
  const [showPreview, setShowPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const blobUrlRef = useRef<string | null>(null);
  const isJS = language === "javascript" || language === "js";

  // Reset error + blob when code changes
  useEffect(() => {
    setError(null);
    if (blobUrlRef.current) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = null; }
  }, [code]);

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => { if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current); };
  }, []);

  // Render HTML/JS via blob URL when preview is shown
  useEffect(() => {
    if (!showPreview || (language !== "html" && !isJS) || !iframeRef.current) return;
    if (blobUrlRef.current) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = null; }
    const { classes, isDark } = getThemeClasses();
    const fullDoc = isJS
      ? buildJSBlobContent(code, { theme: classes, isDark })
      : buildHTMLBlobContent(code, { theme: classes, isDark });
    const blob = new Blob([fullDoc], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    blobUrlRef.current = url;
    iframeRef.current.src = url;
  }, [showPreview, language, code, isJS]);

  const renderMermaid = useCallback(async () => {
    if (!containerRef.current) return;
    try {
      const mermaid = (await import("mermaid")).default;
      const isDark = document.documentElement.classList.contains("dark");
      mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: isDark ? "dark" : "default" });
      const { svg } = await mermaid.render(`mermaid-inline-${++mermaidInlineIdCounter}`, code);
      if (containerRef.current) {
        containerRef.current.innerHTML = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true } });
      }
    } catch (e) {
      // LOT C2: Better error messages
      const msg = e instanceof Error ? e.message : String(e);
      const lineMatch = msg.match(/line (\d+)/i);
      setError(lineMatch
        ? `Erreur Mermaid ligne ${lineMatch[1]}: ${msg.split("\n")[0]}`
        : `Erreur Mermaid: ${msg.split("\n")[0]}`
      );
    }
  }, [code]);

  useEffect(() => {
    if (showPreview && language === "mermaid") {
      renderMermaid();
    }
  }, [showPreview, language, renderMermaid]);

  const labels: Record<string, string> = {
    html: "Apercu HTML",
    svg: "Apercu SVG",
    mermaid: "Apercu Mermaid",
    csv: "Apercu CSV",
    json: "Apercu JSON",
    markdown: "Apercu Markdown",
    md: "Apercu Markdown",
    javascript: "Executer JavaScript",
    js: "Executer JavaScript",
  };
  const label = labels[language] || `Apercu ${language}`;

  if (!showPreview) {
    return (
      <button
        type="button"
        onClick={() => setShowPreview(true)}
        className="mt-2 rounded-lg border border-[hsl(var(--border-100))] bg-[hsl(var(--bg-100))] px-3 py-1.5 text-xs font-medium text-[hsl(var(--text-100))] hover:bg-[hsl(var(--bg-200))] transition-colors"
      >
        {label}
      </button>
    );
  }

  if (error) {
    return (
      <div className="mt-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-600 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
        {error}
      </div>
    );
  }

  // SVG
  if (language === "svg") {
    const cleanSvg = DOMPurify.sanitize(code, { USE_PROFILES: { svg: true }, FORBID_TAGS: ["script"] });
    return (
      <div className="mt-2 overflow-auto rounded-lg border border-[hsl(var(--border-100))] bg-[hsl(var(--bg-100))] p-4">
        <div dangerouslySetInnerHTML={{ __html: cleanSvg }} />
      </div>
    );
  }

  // Mermaid
  if (language === "mermaid") {
    return (
      <div className="group/mermaid relative mt-2 overflow-auto rounded-lg border border-[hsl(var(--border-100))] bg-[hsl(var(--bg-100))] p-4">
        <button
          type="button"
          onClick={() => {
            const svgEl = containerRef.current?.querySelector("svg");
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
                a.download = "mermaid-diagram.png";
                a.click();
                URL.revokeObjectURL(a.href);
              }, "image/png");
              URL.revokeObjectURL(url);
            };
            img.src = url;
          }}
          title="Telecharger PNG"
          aria-label="Telecharger le diagramme en PNG"
          className="absolute top-2 right-2 z-10 rounded-md p-1.5 bg-[hsl(var(--bg-100)/80%)] text-[hsl(var(--text-400))] opacity-0 group-hover/mermaid:opacity-100 hover:bg-[hsl(var(--bg-200))] hover:text-[hsl(var(--text-100))] transition-all cursor-pointer"
        >
          <DownloadSimple className="h-4 w-4" />
        </button>
        <div ref={containerRef} />
      </div>
    );
  }

  // LOT C3 + F1: CSV inline preview with RFC 4180 support
  if (language === "csv") {
    const lines = code.trim().split("\n");
    const headers = lines[0] ? parseCSVLine(lines[0]) : [];
    const rows = lines.slice(1).filter(l => l.trim()).map(l => parseCSVLine(l));
    return (
      <div className="mt-2 overflow-auto rounded-lg border border-[hsl(var(--border-100))]">
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
  }

  // LOT C3: JSON inline preview
  if (language === "json") {
    try {
      const formatted = JSON.stringify(JSON.parse(code), null, 2);
      return (
        <div className="mt-2 overflow-auto rounded-lg border border-[hsl(var(--border-100))] bg-[hsl(var(--bg-100))] p-3">
          <pre className="text-xs font-mono text-[hsl(var(--text-100))] whitespace-pre-wrap">{formatted}</pre>
        </div>
      );
    } catch {
      return (
        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-400">
          JSON invalide
        </div>
      );
    }
  }

  // LOT C3 + F2: Enhanced Markdown inline preview
  if (language === "markdown" || language === "md") {
    const html = markdownToHtml(code);
    return (
      <div className="mt-2 overflow-auto rounded-lg border border-[hsl(var(--border-100))] bg-[hsl(var(--bg-000))] p-4 prose prose-sm dark:prose-invert max-w-full"
        dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }}
      />
    );
  }

  // HTML/JS: render in blob URL iframe
  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-[hsl(var(--border-100))]">
      <iframe
        ref={iframeRef}
        sandbox={isJS ? "allow-scripts allow-forms" : "allow-scripts allow-same-origin allow-forms"}
        className="w-full border-0 bg-[hsl(var(--bg-000))]"
        style={{ minHeight: isJS ? 450 : 200 }}
        title={isJS ? "JavaScript Execution" : "Artifact HTML"}
      />
    </div>
  );
}

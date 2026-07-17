import React from "react";
import { Streamdown, defaultRemarkPlugins } from "streamdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import remarkCitationParser from "@/utils/remarkCitationParser";
import remarkRAGCitationParser from "@/lib/remarkRAGCitationParser";
import CopyButton from "./CopyButton";
import type { BundledLanguage } from "shiki";
import { useHighlighter } from "@/lib/highlighter";
import type { RAGSource } from "@/gotypes";
import { ArtifactRenderer } from "./ArtifactRenderer";
import { type ArtifactPreviewData, isRenderable, type RenderableLanguage } from "./ArtifactPreviewPanel";
import { ArrowSquareOut } from "@phosphor-icons/react";

// LOT Perf 2.1: Context to skip Shiki tokenization during streaming
const StreamingCtx = React.createContext(false);

// LOT Perf 2.2: Reactive dark mode detection via MutationObserver on <html> class
function useIsDark(): boolean {
  const [isDark, setIsDark] = React.useState(() =>
    typeof document !== "undefined" && document.documentElement.classList.contains("dark")
  );
  React.useEffect(() => {
    const el = document.documentElement;
    setIsDark(el.classList.contains("dark"));
    const observer = new MutationObserver(() => setIsDark(el.classList.contains("dark")));
    observer.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return isDark;
}

// Auto-opens the artifact preview panel when a code block is detected.
// LOT B3: Robust language detection — validates against known languages.
// LOT B4: Supports ```lang title="filename" syntax.
// LOT B1: Faster auto-open — 100ms first delay, 500ms throttle.
const CODE_BLOCK_RE = /```([^\n]*)\n([\s\S]*?)(?:```|$)/g;

// LOT B3: Known languages for validation
const KNOWN_LANGUAGES = new Set([
  "html", "svg", "mermaid", "javascript", "js", "jsx", "typescript", "ts", "tsx",
  "python", "py", "rust", "go", "java", "cpp", "c", "csharp", "cs", "php", "sql",
  "json", "markdown", "md", "xml", "css", "bash", "shell", "sh", "yaml", "yml",
  "dockerfile", "toml", "csv", "ruby", "rb", "swift", "kotlin", "kt", "scala",
  "perl", "lua", "r", "matlab", "makefile", "cmake", "groovy", "powershell",
  "ps1", "bat", "cmd", "ini", "cfg", "conf", "nginx", "apache", "graphql", "gql",
  "protobuf", "proto", "terraform", "tf", "hcl", "zig", "nim", "elixir", "ex",
  "erlang", "haskell", "hs", "ocaml", "ml", "fsharp", "fs", "clojure", "clj",
  "lisp", "scheme", "racket", "dart", "vue", "svelte", "astro", "text", "txt",
  "diff", "patch", "log", "plaintext", "http", "rest", "wasm", "asm", "nasm",
  "objectivec", "objective-c", "objc", "c++",
]);

// LOT B4: Parse language and title from fence info string
// Supports: ```python, ```python title="foo.py", ```python:foo.py
function parseFenceInfo(raw: string): { lang: string; title?: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { lang: "" };

  // Extract title="..." or title='...'
  const titleMatch = trimmed.match(/title=["']([^"']+)["']/);
  const title = titleMatch ? titleMatch[1] : undefined;

  // Extract language (first word, cleaned)
  const langPart = trimmed.split(/\s+/)[0].replace(/title=.*/, "").trim();

  // LOT B3: Validate against known languages — colon separator for title
  const colonIdx = langPart.indexOf(":");
  const lang = colonIdx > 0 ? langPart.slice(0, colonIdx) : langPart;
  const colonTitle = colonIdx > 0 ? langPart.slice(colonIdx + 1) : undefined;

  const validLang = KNOWN_LANGUAGES.has(lang.toLowerCase()) ? lang.toLowerCase() : lang;

  return { lang: validLang, title: title || colonTitle };
}

function useAutoArtifactPreview(
  content: string,
  isStreaming: boolean,
  artifactsEnabled: boolean,
  onArtifactPreview?: (artifact: ArtifactPreviewData) => void,
) {
  const lastSentRef = React.useRef("");
  const lastLenRef = React.useRef(0);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  React.useEffect(() => {
    return () => {
      if (timerRef.current !== undefined) clearTimeout(timerRef.current);
    };
  }, []);

  const parseLastBlock = React.useCallback((text: string) => {
    let last: { lang: string; code: string; title?: string } | null = null;
    let m;
    CODE_BLOCK_RE.lastIndex = 0;
    while ((m = CODE_BLOCK_RE.exec(text)) !== null) {
      const { lang, title } = parseFenceInfo(m[1]);
      const code = m[2].trim();
      if (code.length > 20) last = { lang, code, title };
    }
    return last;
  }, []);

  React.useEffect(() => {
    if (!artifactsEnabled || !onArtifactPreview || !isStreaming) return;
    if (!content.includes("```")) return;

    // LOT B1: Reduced throttle — 50 chars instead of 80
    if (content.length - lastLenRef.current < 50) return;
    lastLenRef.current = content.length;

    clearTimeout(timerRef.current);
    // LOT B1: 100ms first delay (was 150), 500ms throttle (was 1000)
    const delay = lastSentRef.current === "" ? 100 : 500;
    timerRef.current = setTimeout(() => {
      const last = parseLastBlock(content);
      if (last && last.code !== lastSentRef.current) {
        lastSentRef.current = last.code;
        onArtifactPreview({ code: last.code, language: last.lang, title: last.title, isStreaming: true });
      }
    }, delay);
  }, [content, isStreaming, artifactsEnabled, onArtifactPreview, parseLastBlock]);

  React.useEffect(() => {
    if (!isStreaming) {
      if (lastSentRef.current && onArtifactPreview && content.includes("```")) {
        const last = parseLastBlock(content);
        // Always send isStreaming:false — even if code hasn't changed since last chunk
        if (last) {
          onArtifactPreview({ code: last.code, language: last.lang, title: last.title, isStreaming: false });
        }
      }
      lastSentRef.current = "";
      lastLenRef.current = 0;
    }
  }, [isStreaming, content, onArtifactPreview, parseLastBlock]);
}

interface StreamingMarkdownContentProps {
  content: string;
  isStreaming?: boolean;
  size?: "sm" | "md" | "lg";
  browserToolResult?: any; // TODO: proper type
  ragSources?: RAGSource[];
  onCitationClick?: (source: RAGSource) => void;
  artifactsEnabled?: boolean;
  onArtifactPreview?: (artifact: ArtifactPreviewData) => void;
}

// Helper to extract text from React nodes
const extractText = (node: React.ReactNode): string => {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (!node) return "";
  if (React.isValidElement(node)) {
    const props = node.props as any;
    if (props?.children) {
      return extractText(props.children as React.ReactNode);
    }
  }
  if (Array.isArray(node)) {
    return node.map(extractText).join("");
  }
  return "";
};

// LOT C5: Code block with line numbers + LOT B4: title support
const CodeBlock = React.memo(
  ({ children, onOpenInPanel, blockTitle }: React.HTMLAttributes<HTMLPreElement> & { onOpenInPanel?: () => void; blockTitle?: string }) => {
    const codeElement = children as React.ReactElement<{
      className?: string;
      children: React.ReactNode;
    }>;
    const langMatch = codeElement.props.className?.match(/language-(\S+)/);
    const language = langMatch ? langMatch[1] : "";
    const codeText = extractText(codeElement.props.children);
    const hl = useHighlighter();
    const isStreaming = React.useContext(StreamingCtx);
    const isDark = useIsDark();

    // LOT C5: Show line numbers for blocks > 3 lines
    const lineCount = codeText.split("\n").length;
    const showLineNumbers = lineCount > 3;
    const collapsible = lineCount > 30 && !isStreaming;
    const [collapsed, setCollapsed] = React.useState(collapsible);

    // LOT Perf 2.1: Skip tokenization during streaming (saves ~60% CPU)
    // LOT Perf 2.2: Single theme — only tokenize the active theme (halves work)
    const tokens = React.useMemo(() => {
      if (!hl || isStreaming) return null;
      if (!language) return null;
      try {
        const result = hl.codeToTokensBase(codeText, {
          lang: language as BundledLanguage,
          theme: (isDark ? "one-dark" : "one-light") as any,
        });
        return result;
      } catch (e) {
        console.warn("[Shiki] Tokenization failed for lang:", language, e);
        return null;
      }
    }, [codeText, language, hl, isStreaming, isDark]);

    const renderLines = (themeTokens: any[], lineCount: number) =>
      themeTokens.map((line: any, i: number) => (
        <React.Fragment key={i}>
          {showLineNumbers && (
            <span className="inline-block w-8 text-right mr-4 text-neutral-400 dark:text-neutral-600 select-none text-xs">
              {i + 1}
            </span>
          )}
          {line.map((token: any, j: number) => (
            <span key={j} style={{ color: token.color }}>{token.content}</span>
          ))}
          {i < lineCount - 1 && "\n"}
        </React.Fragment>
      ));

    return (
      <div className="relative bg-neutral-100 dark:bg-neutral-800 rounded-2xl overflow-hidden my-6">
        <div className="flex select-none items-center">
          <div className="flex items-center gap-2 px-4 py-2 min-w-0">
            {language && (
              <span className="text-[13px] text-neutral-500 dark:text-neutral-400 font-mono flex-shrink-0">
                {language}
              </span>
            )}
            {/* LOT B4: Title display */}
            {blockTitle && (
              <span className="text-[12px] text-neutral-400 dark:text-neutral-500 truncate">
                {blockTitle}
              </span>
            )}
          </div>
          <div className="flex items-center ml-auto">
            {onOpenInPanel && (
              <button
                onClick={onOpenInPanel}
                title="Ouvrir dans le panneau"
                className="flex items-center gap-1 px-2 py-1.5 text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors cursor-pointer"
              >
                <ArrowSquareOut size={14} />
              </button>
            )}
            <CopyButton
              content={codeText}
              showLabels={true}
              className="copy-button text-neutral-500 dark:text-neutral-400 bg-neutral-100 dark:bg-neutral-800"
            />
          </div>
        </div>
        <div className="relative">
          <pre
            className={`m-0 text-sm overflow-x-auto p-4 relative ${isDark ? "bg-neutral-800" : "bg-neutral-100"} ${!tokens && !isStreaming && !hl && language ? "code-shimmer" : ""}`}
            style={collapsed ? { maxHeight: "240px", overflow: "hidden" } : undefined}
          >
            <code className="font-mono text-sm">
              {tokens ? renderLines(tokens, tokens.length) : codeText}
            </code>
          </pre>
          {collapsed && (
            <div
              className="absolute bottom-0 left-0 right-0 h-16 pointer-events-none"
              style={{ background: `linear-gradient(transparent, ${isDark ? "#262626" : "#f5f5f5"})` }}
            />
          )}
        </div>
        {collapsible && (
          <button
            onClick={() => setCollapsed(c => !c)}
            className="w-full py-1.5 text-[12px] font-mono text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300 hover:bg-neutral-200/50 dark:hover:bg-neutral-700/50 transition-colors cursor-pointer select-none"
          >
            {collapsed ? `Afficher tout (${lineCount} lignes)` : "Réduire"}
          </button>
        )}
      </div>
    );
  },
);

const StreamingMarkdownContent: React.FC<StreamingMarkdownContentProps> =
  React.memo(({ content, isStreaming = false, size, browserToolResult, ragSources, onCitationClick, artifactsEnabled, onArtifactPreview }) => {
    // Auto-open preview panel during streaming by parsing raw markdown
    useAutoArtifactPreview(content, isStreaming, artifactsEnabled ?? false, onArtifactPreview);

    // Build the remark plugins array - keep default GFM and Math, add citations
    const remarkPlugins = React.useMemo(() => {
      const plugins: any[] = [
        defaultRemarkPlugins.gfm,
        remarkMath,
        remarkCitationParser,
      ];
      // Only add RAG citation parser if we have sources
      if (ragSources && ragSources.length > 0) {
        plugins.push(remarkRAGCitationParser);
      }
      return plugins;
    }, [ragSources]);

    // Rehype plugins for post-processing (KaTeX math rendering)
    const rehypePlugins = React.useMemo(() => [rehypeKatex], []);

    return (
      <div
        className={`
          max-w-full
          ${size === "sm" ? "prose-sm" : size === "lg" ? "prose-lg" : ""}
          prose
          prose-neutral
          prose-headings:font-semibold
          prose:text-neutral-800
          prose-strong:font-semibold
          prose-ul:marker:text-neutral-700
          prose-li:marker:text-neutral-700
          prose-headings:text-neutral-800
          prose-pre:bg-transparent
          prose-pre:rounded-xl
          prose-pre:text-neutral-800
          prose-pre:font-normal
          prose-pre:my-0
          prose-pre:max-w-full
          prose-pre:pt-1
          [&_table]:border-collapse
          [&_table]:w-full
          [&_table]:border
          [&_table]:border-neutral-200
          [&_table]:rounded-lg
          [&_table]:overflow-hidden
          [&_th]:px-3
          [&_th]:py-2
          [&_th]:text-left
          [&_th]:font-semibold
          [&_th]:border-b
          [&_th]:border-r
          [&_th]:border-neutral-200
          [&_th:last-child]:border-r-0
          [&_td]:px-3
          [&_td]:py-2
          [&_td]:border-r
          [&_td]:border-neutral-200
          [&_td:last-child]:border-r-0
          [&_tbody_tr:not(:last-child)_td]:border-b
          [&_code:not(pre_code)]:text-neutral-700
          [&_code:not(pre_code)]:bg-neutral-100
          [&_code:not(pre_code)]:font-normal
          [&_code:not(pre_code)]:px-1.5
          [&_code:not(pre_code)]:py-0.5
          [&_code:not(pre_code)]:rounded-md
          [&_code:not(pre_code)]:text-[90%]
          [&_code:not(pre_code)]:before:hidden
          [&_code:not(pre_code)]:after:hidden
          dark:prose-invert
          dark:prose:text-neutral-200
          dark:prose-pre:bg-none
          dark:prose-headings:text-neutral-200
          dark:prose-strong:text-neutral-200
          dark:prose-pre:text-neutral-200
          dark:prose:pre:text-neutral-200
          dark:[&_table]:border-neutral-700
          dark:[&_thead]:bg-neutral-800
          dark:[&_th]:border-neutral-700
          dark:[&_td]:border-neutral-700
          dark:[&_code:not(pre_code)]:text-neutral-200
          dark:[&_code:not(pre_code)]:bg-neutral-800
          dark:[&_code:not(pre_code)]:font-normal
          dark:prose-ul:marker:text-neutral-300
          dark:prose-li:marker:text-neutral-300
          break-words
        `}
      >
        <StreamingCtx.Provider value={isStreaming}>
        <StreamingMarkdownErrorBoundary
          content={content}
          isStreaming={isStreaming}
        >
          <Streamdown
            parseIncompleteMarkdown={isStreaming}
            isAnimating={isStreaming}
            remarkPlugins={remarkPlugins}
            rehypePlugins={rehypePlugins}
            controls={false}
            allowedTags={{
              "ol-citation": ["cursor", "start", "end"],
              "rag-citation": ["index"],
            }}
            components={{
              pre: artifactsEnabled
                ? ({ children }: React.HTMLAttributes<HTMLPreElement>) => {
                    const codeEl = children as React.ReactElement<{
                      className?: string;
                      children: React.ReactNode;
                    }>;
                    const langMatch2 = codeEl?.props?.className?.match(/language-(\S+)/);
                    const rawLang = langMatch2 ? langMatch2[1] : "";
                    const { lang, title } = parseFenceInfo(rawLang);
                    const codeText = extractText(codeEl?.props?.children);
                    const renderable = isRenderable(lang);

                    return (
                      <>
                        <CodeBlock
                          blockTitle={title}
                          onOpenInPanel={onArtifactPreview && codeText
                            ? () => onArtifactPreview({ code: codeText, language: lang, title })
                            : undefined}
                        >
                          {children}
                        </CodeBlock>

                        {renderable && codeText && (
                          <ArtifactRenderer code={codeText} language={lang as RenderableLanguage} />
                        )}
                      </>
                    );
                  }
                : CodeBlock,
              table: ({
                children,
                ...props
              }: React.HTMLAttributes<HTMLTableElement>) => (
                <div className="overflow-x-auto max-w-full">
                  <table
                    {...props}
                    className="border-collapse w-full border border-neutral-200 dark:border-neutral-700 rounded-lg overflow-hidden"
                  >
                    {children}
                  </table>
                </div>
              ),
              // @ts-expect-error: custom citation type
              "ol-citation": ({
                cursor,
              }: {
                cursor: number;
                start: number;
                end: number;
              }) => {
                const pageStack = browserToolResult?.page_stack;
                const hasValidPage = pageStack && cursor < pageStack.length;
                const pageUrl = hasValidPage ? pageStack[cursor] : null;

                const getPageTitle = (url: string) => {
                  if (url.startsWith("search_results_")) {
                    const searchTerm = url.substring("search_results_".length);
                    return `Search: ${searchTerm}`;
                  }
                  try {
                    const urlObj = new URL(url);
                    return urlObj.hostname;
                  } catch {
                    return url;
                  }
                };

                const citationElement = (
                  <span className="text-xs text-neutral-500 dark:text-neutral-400 bg-neutral-100 dark:bg-neutral-800 rounded-full px-2 py-1 ml-1">
                    [{cursor}]
                  </span>
                );

                if (pageUrl && pageUrl.startsWith("http")) {
                  return (
                    <a
                      href={pageUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center hover:opacity-80 transition-opacity no-underline"
                      title={getPageTitle(pageUrl)}
                    >
                      {citationElement}
                    </a>
                  );
                }

                return citationElement;
              },
              // @ts-expect-error: custom RAG citation type
              "rag-citation": ({
                index: citationIndex,
              }: {
                index: number;
              }) => {
                const source = ragSources?.find(
                  (s) => s.index === citationIndex,
                );
                if (!source) {
                  return (
                    <span className="text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 rounded-full px-1.5 py-0.5 mx-0.5">
                      [{citationIndex}]
                    </span>
                  );
                }
                return (
                  <button
                    type="button"
                    onClick={() => onCitationClick?.(source)}
                    title={`${source.document_name} (score: ${(source.score * 100).toFixed(0)}%)`}
                    className="inline-flex items-center text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 rounded-full px-1.5 py-0.5 mx-0.5 hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors cursor-pointer"
                  >
                    [{citationIndex}]
                  </button>
                );
              },
            }}
          >
            {content}
          </Streamdown>
          {isStreaming && <span className="streaming-caret" aria-hidden="true" />}
        </StreamingMarkdownErrorBoundary>
        </StreamingCtx.Provider>
      </div>
    );
  });

interface StreamingMarkdownErrorBoundaryProps {
  content: string;
  children: React.ReactNode;
  isStreaming: boolean;
}

// Sometimes remark will throw errors, particularly when rendering math. We add
// this fallback to show the plain text content if there's an error, and then we
// retry rendering the content if the content changes OR if we change our
// streaming state (because we render things differently when in streaming mode
// v. not, so for some cases we'll automatically recover once streaming is over)
//
// This should not be relied on for anything known to be broken (any known
// errors should be fixed!), but it's necessary to not break the full UI because
// of some bad markdown
class StreamingMarkdownErrorBoundary extends React.Component<
  StreamingMarkdownErrorBoundaryProps,
  { hasError: boolean; errorMsg: string }
> {
  constructor(props: StreamingMarkdownErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, errorMsg: "" };
  }

  componentDidUpdate(prevProps: StreamingMarkdownErrorBoundaryProps) {
    if (
      prevProps.isStreaming !== this.props.isStreaming ||
      prevProps.content !== this.props.content
    ) {
      this.setState({ hasError: false, errorMsg: "" });
    }
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, errorMsg: error?.message || String(error) };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error(
      "StreamingMarkdownContent: caught rendering error",
      error,
      info,
    );
  }

  render() {
    if (this.state.hasError) {
      return (
        <div>
          <div className="text-xs text-red-500 bg-red-50 dark:bg-red-950 dark:text-red-400 rounded p-2 mb-2 font-mono">
            Markdown render error: {this.state.errorMsg}
          </div>
          <div className="whitespace-pre-wrap">{this.props.content}</div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default StreamingMarkdownContent;

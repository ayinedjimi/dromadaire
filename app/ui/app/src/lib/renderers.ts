// ── Shared rendering utilities for artifact previews ──

/**
 * RFC 4180 CSV line parser — handles quoted commas and escaped double-quotes.
 * Example: `"Smith, John",42,"He said ""hello"""` → ["Smith, John", "42", 'He said "hello"']
 */
export function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { fields.push(current.trim()); current = ""; }
      else current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

/**
 * Simple Markdown-to-HTML renderer for preview purposes.
 * Handles: headers (h1-h4), bold, italic, inline code, links, images,
 * blockquotes, ordered/unordered lists, horizontal rules, paragraphs.
 */
/** Allow only http/https URLs to prevent javascript: or data: XSS in artifact preview. */
function sanitizeUrl(url: string): string {
  const t = url.trim().toLowerCase();
  if (t.startsWith("http://") || t.startsWith("https://")) return url.trim();
  return "#";
}

export function markdownToHtml(code: string): string {
  let html = code
    // Horizontal rules (before headers to avoid conflict)
    .replace(/^(---|\*\*\*|___)\s*$/gm, "<hr>")
    // Headers
    .replace(/^#### (.+)$/gm, "<h4>$1</h4>")
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    // Images (before links to avoid conflict) — sanitize src
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, u) => `<img alt="${alt.replace(/"/g, "&quot;")}" src="${sanitizeUrl(u)}" style="max-width:100%">`)
    // Links — sanitize href
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, u) => `<a href="${sanitizeUrl(u)}" target="_blank" rel="noopener noreferrer" style="color:#3b82f6;text-decoration:underline">${text.replace(/</g, "&lt;")}</a>`)
    // Bold & italic
    .replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    // Inline code
    .replace(/`(.+?)`/g, '<code style="background:#f5f5f5;padding:2px 4px;border-radius:3px;font-size:90%">$1</code>')
    // Blockquotes
    .replace(/^> (.+)$/gm, "<blockquote style=\"border-left:3px solid #d1d5db;padding-left:12px;color:#6b7280;margin:8px 0\">$1</blockquote>")
    // Ordered lists
    .replace(/^\d+\. (.+)$/gm, "<li style=\"list-style:decimal;margin-left:20px\">$1</li>")
    // Unordered lists
    .replace(/^[-*] (.+)$/gm, "<li style=\"list-style:disc;margin-left:20px\">$1</li>")
    // Paragraphs
    .replace(/\n\n/g, "</p><p>")
    .replace(/\n/g, "<br>");
  return `<p>${html}</p>`;
}

// ── CSS framework detection for auto-CDN injection ──

const TAILWIND_PREFIXES = [
  "flex", "grid", "block", "inline", "hidden",
  "bg-", "text-", "p-", "px-", "py-", "pt-", "pb-", "pl-", "pr-",
  "m-", "mx-", "my-", "mt-", "mb-", "ml-", "mr-",
  "rounded", "shadow", "border",
  "w-", "h-", "min-w-", "min-h-", "max-w-", "max-h-",
  "gap-", "space-",
  "items-", "justify-", "self-",
  "font-", "leading-", "tracking-",
  "overflow-", "z-", "opacity-",
  "transition", "duration-", "ease-",
  "absolute", "relative", "fixed", "sticky",
  "top-", "right-", "bottom-", "left-", "inset-",
];

const BOOTSTRAP_CLASSES = [
  "container", "row", "col-", "col",
  "btn", "btn-", "card", "navbar", "nav",
  "modal", "form-", "table", "alert", "badge",
  "dropdown", "carousel", "accordion",
  "d-flex", "d-grid", "d-block", "d-none",
];

/**
 * Detect CSS framework usage in HTML by scanning class attributes.
 * Returns which frameworks appear to be used (Tailwind, Bootstrap).
 */
export function detectCSSFramework(html: string): { tailwind: boolean; bootstrap: boolean } {
  const classMatches = html.match(/class=["']([^"']+)["']/gi);
  if (!classMatches) return { tailwind: false, bootstrap: false };

  const allClasses = classMatches
    .map(m => m.replace(/class=["']/i, "").replace(/["']$/, ""))
    .join(" ")
    .split(/\s+/);

  // Tailwind: count how many distinct prefix categories match
  const twCategories = new Set<string>();
  for (const cls of allClasses) {
    for (const prefix of TAILWIND_PREFIXES) {
      if (cls === prefix || cls.startsWith(prefix)) {
        twCategories.add(prefix);
        break;
      }
    }
  }

  // Bootstrap: count distinct class matches
  const bsMatches = new Set<string>();
  for (const cls of allClasses) {
    for (const bc of BOOTSTRAP_CLASSES) {
      if (cls === bc || cls.startsWith(bc)) {
        bsMatches.add(bc);
        break;
      }
    }
  }

  return {
    tailwind: twCategories.size >= 3,
    bootstrap: bsMatches.size >= 2,
  };
}

// ── Theme helpers ──

const DARK_THEMES = ["dark", "oled", "blue-night", "nord"];
const ALL_THEMES = ["light", "dark", "oled", "sepia", "blue-night", "nord"];

/**
 * Read current theme classes from document.documentElement.
 * Returns the relevant CSS class string and whether it's a dark theme.
 */
export function getThemeClasses(): { classes: string; isDark: boolean } {
  if (typeof document === "undefined") return { classes: "", isDark: false };
  const root = document.documentElement;
  const active: string[] = [];
  for (const t of ALL_THEMES) {
    if (root.classList.contains(t)) active.push(t);
  }
  const isDark = DARK_THEMES.some(t => root.classList.contains(t));
  if (isDark && !active.includes("dark")) active.push("dark");
  return { classes: active.join(" "), isDark };
}

// ── HTML blob document builder ──

const THEME_STYLES = `
html{color-scheme:light}
html.dark{color-scheme:dark}
body{font-family:system-ui,-apple-system,sans-serif;margin:16px;line-height:1.6;color:#333;background:#fff}
html.dark body{color:#e5e5e5;background:#171717}
html.oled body{color:#fff;background:#000}
html.sepia body{color:#4a3728;background:#e8dcc8}
html.blue-night body{color:#d4dce8;background:#111720}
html.nord body{color:#eceff4;background:#2e3440}
*{box-sizing:border-box}
img{max-width:100%}
`;

// Security: block iframe access to parent storage/cookies even with allow-same-origin
const STORAGE_SANDBOX_SCRIPT = `(function(){
try{Object.defineProperty(window,'localStorage',{get:function(){throw new DOMException('Blocked','SecurityError')}})}catch(e){}
try{Object.defineProperty(window,'sessionStorage',{get:function(){throw new DOMException('Blocked','SecurityError')}})}catch(e){}
try{Object.defineProperty(document,'cookie',{get:function(){return''},set:function(){}})}catch(e){}
try{window.indexedDB&&Object.defineProperty(window,'indexedDB',{get:function(){throw new DOMException('Blocked','SecurityError')}})}catch(e){}
try{history.pushState=function(){};history.replaceState=function(){}}catch(e){}
})();`;

const CONSOLE_CAPTURE_SCRIPT = `(function(){
var _l=console.log,_e=console.error,_w=console.warn,_i=console.info;
function s(l,a){try{var t=Array.from(a).map(function(x){
if(typeof x==='object')try{return JSON.stringify(x)}catch(e){return String(x)}
return String(x)}).join(' ');
window.parent.postMessage({type:'iframe-console',level:l,text:t},'*')}catch(e){}}
console.log=function(){_l.apply(console,arguments);s('log',arguments)};
console.error=function(){_e.apply(console,arguments);s('error',arguments)};
console.warn=function(){_w.apply(console,arguments);s('warn',arguments)};
console.info=function(){_i.apply(console,arguments);s('info',arguments)};
window.onerror=function(m,u,l,c){s('error',[m+(u?' at '+u+':'+l+':'+c:'')])};
})();`;

const RESIZE_SCRIPT = `if(document.body){new ResizeObserver(function(){
window.parent.postMessage({type:'iframe-height',height:document.body.scrollHeight},'*')
}).observe(document.body)}
window.addEventListener('load',function(){
if(document.body){new ResizeObserver(function(){
window.parent.postMessage({type:'iframe-height',height:document.body.scrollHeight},'*')
}).observe(document.body)}});`;

/**
 * Build a complete HTML document for rendering in a blob: URL iframe.
 * No DOMPurify — the blob URL opaque origin provides isolation.
 * Auto-detects Tailwind/Bootstrap and injects local vendor files.
 * Files are served from /vendor/ (bundled in public/ for offline use).
 */
export function buildJSBlobContent(
  jsCode: string,
  options: { theme?: string; isDark?: boolean } = {},
): string {
  const htmlClass = options.theme || "";

  const canvasIds = [...new Set([...jsCode.matchAll(/getElementById\s*\(\s*['"]([^'"]+)['"]\s*\)\s*\.\s*getContext/g)].map(m => m[1]))];
  const canvasElements = canvasIds.length > 0
    ? canvasIds.map(id => `<canvas id="${id}" width="400" height="400" style="border:1px solid #ccc;border-radius:8px;display:block;margin:0 auto 12px;"></canvas>`).join("\n")
    : `<canvas id="canvas" width="400" height="400" style="border:1px solid #ccc;border-radius:8px;display:block;margin:0 auto 12px;"></canvas>`;

  return `<!DOCTYPE html>
<html class="${htmlClass}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>${THEME_STYLES}
canvas{max-width:100%;height:auto}
#output{font-family:monospace;font-size:13px;padding:8px 12px;margin-top:8px;white-space:pre-wrap;word-break:break-word;max-height:300px;overflow-y:auto}
#output:empty{display:none}
#js-error{color:#ef4444;background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:8px 12px;margin:8px 0;font-size:12px;font-family:monospace;display:none}
</style>
<script>${STORAGE_SANDBOX_SCRIPT}</script>
<script>${CONSOLE_CAPTURE_SCRIPT}</script>
<script>${RESIZE_SCRIPT}</script>
</head>
<body>
${canvasElements}
<div id="output"></div>
<div id="js-error"></div>
<script>
(function(){
  var _origLog = console.log;
  console.log = function(){
    _origLog.apply(console, arguments);
    var out = document.getElementById('output');
    if(out) out.textContent += Array.from(arguments).map(String).join(' ') + '\\n';
  };
  try {
${jsCode}
  } catch(e) {
    var el = document.getElementById('js-error');
    if(el) { el.style.display='block'; el.textContent = '\\u274c ' + e.message; }
    console.error(e.message);
  }
})();
</script>
</body>
</html>`;
}

export function buildHTMLBlobContent(
  code: string,
  options: { theme?: string; isDark?: boolean } = {},
): string {
  const { tailwind, bootstrap } = detectCSSFramework(code);

  // Use local vendor files (public/vendor/) — works offline
  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
  const frameworkTags: string[] = [];
  if (tailwind && !/tailwindcss/i.test(code)) {
    frameworkTags.push(`<script src="${baseUrl}/vendor/tailwind.js"></script>`);
  }
  if (bootstrap && !/bootstrap/i.test(code)) {
    frameworkTags.push(`<link rel="stylesheet" href="${baseUrl}/vendor/bootstrap.min.css">`);
  }

  const htmlClass = options.theme || "";

  return `<!DOCTYPE html>
<html class="${htmlClass}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
${frameworkTags.join("\n")}
<style>${THEME_STYLES}</style>
<script>${STORAGE_SANDBOX_SCRIPT}</script>
<script>${CONSOLE_CAPTURE_SCRIPT}</script>
<script>${RESIZE_SCRIPT}</script>
</head>
<body>
${code}
</body>
</html>`;
}

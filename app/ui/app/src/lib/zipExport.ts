import JSZip from "jszip";

// All known files in public/libs/
const LIB_FILES = [
  "libs/fonts.css",
  "libs/fonts/inter-latin.woff2",
  "libs/fonts/jetbrains-mono-latin.woff2",
  "libs/gsap.min.js",
  "libs/ScrollTrigger.min.js",
  "libs/typed.umd.js",
  "libs/vanilla-tilt.min.js",
  "libs/lucide.min.js",
];

/** Returns true if the HTML references local /libs/ files */
export function hasLocalLibs(html: string): boolean {
  return html.includes("/libs/");
}

/** Downloads HTML + referenced local libs as a ZIP */
export async function downloadAsZip(html: string, filename: string): Promise<void> {
  const zip = new JSZip();

  // 1. Determine which files are actually referenced
  const referencedFiles = LIB_FILES.filter(
    (f) => html.includes("/" + f) || html.includes('"/libs/' + f.replace("libs/", "")),
  );

  // fonts.css → always include font files transitively
  if (referencedFiles.some((f) => f === "libs/fonts.css")) {
    for (const f of LIB_FILES.filter((f) => f.startsWith("libs/fonts/"))) {
      if (!referencedFiles.includes(f)) referencedFiles.push(f);
    }
  }

  // 2. Fetch all referenced files in parallel
  const fetchPromises = referencedFiles.map(async (path) => {
    try {
      const resp = await fetch("/" + path);
      if (!resp.ok) return null;
      if (path.endsWith(".woff2")) {
        return { path, data: await resp.arrayBuffer() };
      }
      let text = await resp.text();
      // Rewrite absolute paths in fonts.css → relative
      if (path === "libs/fonts.css") {
        text = text.replace(/url\(\/libs\/fonts\//g, "url(fonts/");
      }
      return { path, data: text };
    } catch {
      return null;
    }
  });

  const files = (await Promise.all(fetchPromises)).filter(Boolean);

  // 3. Rewrite /libs/ → libs/ in HTML (relative paths for ZIP)
  const rewrittenHtml = html.replace(/(['"])\/(libs\/)/g, "$1$2");

  // 4. Add to ZIP
  zip.file("index.html", rewrittenHtml);
  for (const file of files) {
    if (!file) continue;
    zip.file(file.path, file.data);
  }

  // 5. Generate and trigger download
  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.replace(/\.html$/, "") + ".zip";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

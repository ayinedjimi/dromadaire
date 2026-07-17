// Monaco Editor web worker configuration for Vite.
// Workers are loaded via Vite's ?worker import syntax so they get bundled
// and served from go:embed HTTP (no CDN needed — fully offline).
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-ignore - Vite resolves ?worker at build time
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
// @ts-ignore
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
// @ts-ignore
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
// @ts-ignore
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
// @ts-ignore
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";

self.MonacoEnvironment = {
  getWorker(_moduleId: string, label: string) {
    switch (label) {
      case "json":
        return new jsonWorker();
      case "css":
      case "scss":
      case "less":
        return new cssWorker();
      case "html":
      case "handlebars":
      case "razor":
        return new htmlWorker();
      case "typescript":
      case "javascript":
        return new tsWorker();
      default:
        return new editorWorker();
    }
  },
};

/// <reference types="vite/client" />

declare global {
  interface ImportMetaEnv {
    readonly DEV: boolean;
    readonly MODE: string;
    readonly PROD: boolean;
    readonly SSR: boolean;
    readonly VITE_OLLAMA_DOT_COM_URL?: string;
  }
  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
}

// Vite ?worker import (Monaco workers)
declare module "monaco-editor/esm/vs/editor/editor.worker?worker" {
  const W: new () => Worker;
  export default W;
}
declare module "monaco-editor/esm/vs/language/json/json.worker?worker" {
  const W: new () => Worker;
  export default W;
}
declare module "monaco-editor/esm/vs/language/css/css.worker?worker" {
  const W: new () => Worker;
  export default W;
}
declare module "monaco-editor/esm/vs/language/html/html.worker?worker" {
  const W: new () => Worker;
  export default W;
}
declare module "monaco-editor/esm/vs/language/typescript/ts.worker?worker" {
  const W: new () => Worker;
  export default W;
}

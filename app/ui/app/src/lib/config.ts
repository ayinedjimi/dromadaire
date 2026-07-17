// API configuration
const DEV_API_URL = "http://127.0.0.1:3001";

// Vite injects import.meta.env at build time
const env = (import.meta as unknown as { env: { DEV?: boolean; VITE_OLLAMA_DOT_COM_URL?: string } }).env;

// Base URL for fetch API calls (can be relative in production)
export const API_BASE = env.DEV ? DEV_API_URL : "";

// Full host URL for Ollama client (needs full origin in production)
export const OLLAMA_HOST = env.DEV ? DEV_API_URL : window.location.origin;

export const OLLAMA_DOT_COM = env.VITE_OLLAMA_DOT_COM_URL || "https://ollama.com";

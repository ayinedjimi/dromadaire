import { Ollama } from "ollama/browser";
import { OLLAMA_HOST as DROMADAIRE_HOST } from "./config";

let _client: Ollama | null = null;

export const dromadaireClient = new Proxy({} as Ollama, {
  get(_target, prop) {
    if (!_client) {
      _client = new Ollama({
        host: DROMADAIRE_HOST,
      });
    }
    const value = _client[prop as keyof Ollama];
    return typeof value === "function" ? value.bind(_client) : value;
  },
});

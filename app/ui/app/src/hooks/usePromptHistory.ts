import { useState, useRef, useCallback } from "react";

const STORAGE_KEY = "dromadaire-prompt-history";
const MAX_ENTRIES = 20;

function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveHistory(history: string[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(0, MAX_ENTRIES)));
}

export function usePromptHistory() {
  const indexRef = useRef(-1);
  const [savedInput, setSavedInput] = useState("");

  const addToHistory = useCallback((prompt: string) => {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    const history = loadHistory();
    // Avoid duplicates at the top
    if (history[0] === trimmed) return;
    const filtered = history.filter((h) => h !== trimmed);
    filtered.unshift(trimmed);
    saveHistory(filtered);
    indexRef.current = -1;
  }, []);

  const navigateHistory = useCallback(
    (direction: "up" | "down", currentInput: string): string | null => {
      const history = loadHistory();
      if (history.length === 0) return null;

      if (direction === "up") {
        if (indexRef.current === -1) {
          setSavedInput(currentInput);
        }
        const nextIndex = Math.min(indexRef.current + 1, history.length - 1);
        if (nextIndex === indexRef.current && indexRef.current >= 0) return null;
        indexRef.current = nextIndex;
        return history[nextIndex];
      } else {
        if (indexRef.current <= 0) {
          indexRef.current = -1;
          return savedInput;
        }
        indexRef.current -= 1;
        return history[indexRef.current];
      }
    },
    [savedInput],
  );

  const resetNavigation = useCallback(() => {
    indexRef.current = -1;
  }, []);

  return { addToHistory, navigateHistory, resetNavigation };
}

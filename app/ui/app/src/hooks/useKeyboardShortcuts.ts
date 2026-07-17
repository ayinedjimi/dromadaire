import { useEffect, useCallback } from "react";

export interface ShortcutHandlers {
  search?: () => void;
  newChat?: () => void;
  toggleIncognito?: () => void;
  openSettings?: () => void;
  toggleSidebar?: () => void;
  closeModal?: () => void;
  toggleDiscretion?: () => void;
}

interface ShortcutDef {
  key: string;
  ctrl: boolean;
  shift: boolean;
  action: keyof ShortcutHandlers;
}

const SHORTCUTS: ShortcutDef[] = [
  { key: "k", ctrl: true, shift: false, action: "search" },
  { key: "n", ctrl: true, shift: false, action: "newChat" },
  { key: "i", ctrl: true, shift: true, action: "toggleIncognito" },
  { key: ",", ctrl: true, shift: false, action: "openSettings" },
  { key: "b", ctrl: true, shift: false, action: "toggleSidebar" },
  { key: "h", ctrl: true, shift: true, action: "toggleDiscretion" },
  { key: "Escape", ctrl: false, shift: false, action: "closeModal" },
];

const isMac = typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.userAgent);

/**
 * Global keyboard shortcuts hook.
 * Handles Ctrl (Windows/Linux) or Cmd (Mac) modifier automatically.
 * Skips shortcuts when the user is typing in an input/textarea (except Escape).
 */
export function useKeyboardShortcuts(
  enabled: boolean,
  handlers: ShortcutHandlers,
) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!enabled) return;

      const target = e.target as HTMLElement;
      const isTyping =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;

      for (const shortcut of SHORTCUTS) {
        const modKey = isMac ? e.metaKey : e.ctrlKey;
        const modMatch = shortcut.ctrl ? modKey : !e.ctrlKey && !e.metaKey;
        const shiftMatch = shortcut.shift ? e.shiftKey : !e.shiftKey;

        if (
          e.key.toLowerCase() === shortcut.key.toLowerCase() &&
          modMatch &&
          shiftMatch
        ) {
          // Allow Escape even when typing, skip others
          if (isTyping && shortcut.key !== "Escape") continue;

          const handler = handlers[shortcut.action];
          if (handler) {
            e.preventDefault();
            e.stopPropagation();
            handler();
          }
          return;
        }
      }
    },
    [enabled, handlers],
  );

  useEffect(() => {
    if (!enabled) return;

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enabled, handleKeyDown]);
}

/** Returns the platform modifier label (Cmd on Mac, Ctrl on Windows/Linux) */
export const modLabel = isMac ? "⌘" : "Ctrl";

/** Shortcut descriptions for the Settings UI */
export const SHORTCUT_DESCRIPTIONS = [
  { keys: `${modLabel}+K`, description: "Rechercher dans les conversations" },
  { keys: `${modLabel}+N`, description: "Nouvelle conversation" },
  { keys: `${modLabel}+Shift+I`, description: "Mode incognito" },
  { keys: `${modLabel}+,`, description: "Ouvrir les paramètres" },
  { keys: `${modLabel}+B`, description: "Afficher/masquer la barre latérale" },
  { keys: `${modLabel}+Shift+H`, description: "Mode discrétion (boss key)" },
  { keys: "Escape", description: "Fermer la fenêtre modale" },
];

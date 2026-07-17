// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import {
  useKeyboardShortcuts,
  type ShortcutHandlers,
  modLabel,
  SHORTCUT_DESCRIPTIONS,
} from "./useKeyboardShortcuts";

function fireKeydown(opts: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  target?: HTMLElement;
}) {
  const event = new KeyboardEvent("keydown", {
    key: opts.key,
    ctrlKey: opts.ctrlKey ?? false,
    metaKey: opts.metaKey ?? false,
    shiftKey: opts.shiftKey ?? false,
    bubbles: true,
  });

  // Override the read-only target if provided
  if (opts.target) {
    Object.defineProperty(event, "target", {
      value: opts.target,
      writable: false,
    });
  }

  window.dispatchEvent(event);
}

describe("useKeyboardShortcuts", () => {
  let handlers: ShortcutHandlers;

  beforeEach(() => {
    handlers = {
      search: vi.fn(),
      newChat: vi.fn(),
      toggleIncognito: vi.fn(),
      openSettings: vi.fn(),
      closeModal: vi.fn(),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("triggers search on Ctrl+K", () => {
    renderHook(() => useKeyboardShortcuts(true, handlers));
    fireKeydown({ key: "k", ctrlKey: true });
    expect(handlers.search).toHaveBeenCalledOnce();
  });

  it("triggers toggleIncognito on Ctrl+Shift+I", () => {
    renderHook(() => useKeyboardShortcuts(true, handlers));
    fireKeydown({ key: "i", ctrlKey: true, shiftKey: true });
    expect(handlers.toggleIncognito).toHaveBeenCalledOnce();
  });

  it("allows Escape even when target is an input", () => {
    renderHook(() => useKeyboardShortcuts(true, handlers));

    const input = document.createElement("input");
    document.body.appendChild(input);

    fireKeydown({ key: "Escape", target: input });
    expect(handlers.closeModal).toHaveBeenCalledOnce();

    document.body.removeChild(input);
  });

  it("blocks Ctrl+K when target is a textarea", () => {
    renderHook(() => useKeyboardShortcuts(true, handlers));

    const textarea = document.createElement("textarea");
    document.body.appendChild(textarea);

    fireKeydown({ key: "k", ctrlKey: true, target: textarea });
    expect(handlers.search).not.toHaveBeenCalled();

    document.body.removeChild(textarea);
  });

  it("ignores all shortcuts when disabled", () => {
    renderHook(() => useKeyboardShortcuts(false, handlers));

    fireKeydown({ key: "k", ctrlKey: true });
    fireKeydown({ key: "n", ctrlKey: true });
    fireKeydown({ key: "Escape" });

    expect(handlers.search).not.toHaveBeenCalled();
    expect(handlers.newChat).not.toHaveBeenCalled();
    expect(handlers.closeModal).not.toHaveBeenCalled();
  });

  it("exports modLabel and SHORTCUT_DESCRIPTIONS", () => {
    expect(typeof modLabel).toBe("string");
    expect(modLabel.length).toBeGreaterThan(0);
    expect(Array.isArray(SHORTCUT_DESCRIPTIONS)).toBe(true);
    expect(SHORTCUT_DESCRIPTIONS.length).toBe(7);
    expect(SHORTCUT_DESCRIPTIONS[0]).toHaveProperty("keys");
    expect(SHORTCUT_DESCRIPTIONS[0]).toHaveProperty("description");
  });
});

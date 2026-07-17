// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePromptHistory } from "./usePromptHistory";

const STORAGE_KEY = "dromadaire-prompt-history";

describe("usePromptHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("addToHistory stores entry in localStorage", () => {
    const { result } = renderHook(() => usePromptHistory());

    act(() => {
      result.current.addToHistory("hello");
    });

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored).toEqual(["hello"]);
  });

  it("addToHistory with empty string does nothing", () => {
    const { result } = renderHook(() => usePromptHistory());

    act(() => {
      result.current.addToHistory("");
    });

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("addToHistory with whitespace-only string does nothing", () => {
    const { result } = renderHook(() => usePromptHistory());

    act(() => {
      result.current.addToHistory("   ");
    });

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("addToHistory same string twice in a row does not duplicate", () => {
    const { result } = renderHook(() => usePromptHistory());

    act(() => {
      result.current.addToHistory("hello");
    });
    act(() => {
      result.current.addToHistory("hello");
    });

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored).toEqual(["hello"]);
  });

  it("addToHistory moves existing entry to position 0", () => {
    const { result } = renderHook(() => usePromptHistory());

    act(() => {
      result.current.addToHistory("first");
    });
    act(() => {
      result.current.addToHistory("second");
    });
    act(() => {
      result.current.addToHistory("third");
    });

    // Now re-add "first" — it should move to the top
    act(() => {
      result.current.addToHistory("first");
    });

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored).toEqual(["first", "third", "second"]);
  });

  it("enforces max 20 entries", () => {
    const { result } = renderHook(() => usePromptHistory());

    for (let i = 0; i < 25; i++) {
      act(() => {
        result.current.addToHistory(`entry-${i}`);
      });
    }

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored).toHaveLength(20);
    // Most recent should be first
    expect(stored[0]).toBe("entry-24");
    // Oldest kept should be entry-5 (entries 0-4 were pushed out)
    expect(stored[19]).toBe("entry-5");
  });

  it("navigateHistory up returns most recent and saves currentInput", () => {
    const { result } = renderHook(() => usePromptHistory());

    act(() => {
      result.current.addToHistory("alpha");
      result.current.addToHistory("beta");
    });

    let entry: string | null = null;
    act(() => {
      entry = result.current.navigateHistory("up", "current typing");
    });

    // Should return the most recent entry
    expect(entry).toBe("beta");
  });

  it("navigateHistory up twice returns entries at index 0 then 1", () => {
    const { result } = renderHook(() => usePromptHistory());

    act(() => {
      result.current.addToHistory("first");
      result.current.addToHistory("second");
      result.current.addToHistory("third");
    });

    let entry1: string | null = null;
    let entry2: string | null = null;

    act(() => {
      entry1 = result.current.navigateHistory("up", "");
    });
    act(() => {
      entry2 = result.current.navigateHistory("up", "");
    });

    expect(entry1).toBe("third");
    expect(entry2).toBe("second");
  });

  it("navigateHistory up then down returns savedInput", () => {
    const { result } = renderHook(() => usePromptHistory());

    act(() => {
      result.current.addToHistory("alpha");
      result.current.addToHistory("beta");
    });

    act(() => {
      result.current.navigateHistory("up", "my current text");
    });

    let restored: string | null = null;
    act(() => {
      restored = result.current.navigateHistory("down", "");
    });

    expect(restored).toBe("my current text");
  });

  it("navigateHistory down when index is -1 returns savedInput", () => {
    const { result } = renderHook(() => usePromptHistory());

    act(() => {
      result.current.addToHistory("something");
    });

    // Navigate up to set savedInput, then back down twice
    act(() => {
      result.current.navigateHistory("up", "saved text");
    });
    act(() => {
      result.current.navigateHistory("down", "");
    });

    // Now index is -1, going down again should still return savedInput
    let entry: string | null = null;
    act(() => {
      entry = result.current.navigateHistory("down", "");
    });

    expect(entry).toBe("saved text");
  });

  it("resetNavigation resets the navigation index", () => {
    const { result } = renderHook(() => usePromptHistory());

    act(() => {
      result.current.addToHistory("aaa");
      result.current.addToHistory("bbb");
      result.current.addToHistory("ccc");
    });

    // Navigate up twice
    act(() => {
      result.current.navigateHistory("up", "");
    });
    act(() => {
      result.current.navigateHistory("up", "");
    });

    // Reset
    act(() => {
      result.current.resetNavigation();
    });

    // Next up should start from the beginning again (index 0)
    let entry: string | null = null;
    act(() => {
      entry = result.current.navigateHistory("up", "fresh input");
    });

    expect(entry).toBe("ccc");
  });

  it("navigateHistory returns null when history is empty", () => {
    const { result } = renderHook(() => usePromptHistory());

    let entry: string | null = null;
    act(() => {
      entry = result.current.navigateHistory("up", "text");
    });

    expect(entry).toBeNull();
  });
});

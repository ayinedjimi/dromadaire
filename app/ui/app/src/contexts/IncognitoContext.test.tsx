// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { createElement } from "react";
import { IncognitoProvider, useIncognito } from "./IncognitoContext";

function createWrapper() {
  return ({ children }: { children: React.ReactNode }) =>
    createElement(IncognitoProvider, null, children);
}

describe("IncognitoContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("defaults to incognito false", () => {
    const { result } = renderHook(() => useIncognito(), {
      wrapper: createWrapper(),
    });

    expect(result.current.incognito).toBe(false);
  });

  it("toggleIncognito sets incognito to true", () => {
    const { result } = renderHook(() => useIncognito(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.toggleIncognito();
    });

    expect(result.current.incognito).toBe(true);
  });

  it("toggleIncognito twice sets incognito back to false", () => {
    const { result } = renderHook(() => useIncognito(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.toggleIncognito();
    });
    act(() => {
      result.current.toggleIncognito();
    });

    expect(result.current.incognito).toBe(false);
  });

  it("outside provider returns default values without error", () => {
    const { result } = renderHook(() => useIncognito());

    // Default context value: incognito=false, toggleIncognito=noop
    expect(result.current.incognito).toBe(false);
    expect(typeof result.current.toggleIncognito).toBe("function");

    // Calling the noop toggle should not throw
    act(() => {
      result.current.toggleIncognito();
    });

    // Should remain false since the noop does nothing
    expect(result.current.incognito).toBe(false);
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { createElement } from "react";
import { StreamingProvider, useStreamingContext } from "./StreamingContext";

function createWrapper() {
  return ({ children }: { children: React.ReactNode }) =>
    createElement(StreamingProvider, null, children);
}

describe("StreamingContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("defaults to empty sets and maps", () => {
    const { result } = renderHook(() => useStreamingContext(), {
      wrapper: createWrapper(),
    });

    expect(result.current.streamingChatIds.size).toBe(0);
    expect(result.current.loadingChats.size).toBe(0);
    expect(result.current.abortControllers.size).toBe(0);
    expect(result.current.downloadProgress.size).toBe(0);
  });

  it("setStreamingChatIds updates the set", () => {
    const { result } = renderHook(() => useStreamingContext(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.setStreamingChatIds(new Set(["chat-1", "chat-2"]));
    });

    expect(result.current.streamingChatIds.size).toBe(2);
    expect(result.current.streamingChatIds.has("chat-1")).toBe(true);
    expect(result.current.streamingChatIds.has("chat-2")).toBe(true);
  });

  it("setLoadingChats updates the set", () => {
    const { result } = renderHook(() => useStreamingContext(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.setLoadingChats(new Set(["loading-1"]));
    });

    expect(result.current.loadingChats.size).toBe(1);
    expect(result.current.loadingChats.has("loading-1")).toBe(true);
  });

  it("setAbortControllers updates the map", () => {
    const { result } = renderHook(() => useStreamingContext(), {
      wrapper: createWrapper(),
    });

    const controller = new AbortController();

    act(() => {
      result.current.setAbortControllers(new Map([["chat-1", controller]]));
    });

    expect(result.current.abortControllers.size).toBe(1);
    expect(result.current.abortControllers.get("chat-1")).toBe(controller);
  });

  it("setDownloadProgress updates the map", () => {
    const { result } = renderHook(() => useStreamingContext(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.setDownloadProgress(
        new Map([
          [
            "model-1",
            {
              model: "gemma3:4b",
              total: 1000,
              completed: 500,
              status: "downloading",
            } as any,
          ],
        ]),
      );
    });

    expect(result.current.downloadProgress.size).toBe(1);
    expect(result.current.downloadProgress.get("model-1")).toBeDefined();
  });

  it("functional update pattern works with setStreamingChatIds", () => {
    const { result } = renderHook(() => useStreamingContext(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.setStreamingChatIds((prev) => new Set([...prev, "a"]));
    });
    act(() => {
      result.current.setStreamingChatIds((prev) => new Set([...prev, "b"]));
    });

    expect(result.current.streamingChatIds.size).toBe(2);
    expect(result.current.streamingChatIds.has("a")).toBe(true);
    expect(result.current.streamingChatIds.has("b")).toBe(true);
  });

  it("throws when used outside StreamingProvider", () => {
    // Suppress console.error from React for the expected error
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => {
      renderHook(() => useStreamingContext());
    }).toThrow("useStreamingContext must be used within a StreamingProvider");

    spy.mockRestore();
  });
});

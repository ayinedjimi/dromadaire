// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { useSearch } from "./useSearch";

vi.mock("@/api", () => ({
  searchChats: vi.fn(),
}));

import { searchChats } from "@/api";

const mockSearchChats = vi.mocked(searchChats);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

describe("useSearch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should not fetch when query is empty", async () => {
    renderHook(() => useSearch(""), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(mockSearchChats).not.toHaveBeenCalled();
  });

  it("should not fetch when query is only whitespace", async () => {
    renderHook(() => useSearch("   "), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(mockSearchChats).not.toHaveBeenCalled();
  });

  it("should fetch after debounce when query is non-empty", async () => {
    const mockResults = [
      {
        chat_id: "1",
        chat_title: "Test Chat",
        role: "assistant",
        excerpt: "Hello world",
        created_at: "2025-01-01",
      },
    ];
    mockSearchChats.mockResolvedValue(mockResults);

    // useDebounce initializes useState with the value, so "hello" is
    // immediately the debounced value on first render. React Query will
    // fire the queryFn right away since enabled is true.
    const { result } = renderHook(() => useSearch("hello"), {
      wrapper: createWrapper(),
    });

    // Let React Query execute
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(mockSearchChats).toHaveBeenCalledWith("hello");
    expect(result.current.data).toEqual(mockResults);
  });

  it("should debounce query changes - new query fires only after 300ms", async () => {
    mockSearchChats.mockResolvedValue([]);

    // Start with an initial query
    const { rerender } = renderHook(
      ({ query }: { query: string }) => useSearch(query),
      {
        wrapper: createWrapper(),
        initialProps: { query: "hello" },
      },
    );

    // Let initial query fire
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    mockSearchChats.mockClear();

    // Change query - debounce should delay the new search
    rerender({ query: "world" });

    // Before debounce (100ms) - should not have fired for "world"
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    expect(mockSearchChats).not.toHaveBeenCalledWith("world");

    // After 300ms debounce, the new query should fire
    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(mockSearchChats).toHaveBeenCalledWith("world");
  });

  it("should return correct results from the API", async () => {
    const mockResults = [
      {
        chat_id: "abc",
        chat_title: "My Chat",
        role: "user",
        excerpt: "test query match",
        created_at: "2025-06-01",
      },
      {
        chat_id: "def",
        chat_title: "Another Chat",
        role: "assistant",
        excerpt: "another match",
        created_at: "2025-06-02",
      },
    ];
    mockSearchChats.mockResolvedValue(mockResults);

    const { result } = renderHook(() => useSearch("test"), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.data).toHaveLength(2);
    expect(result.current.data?.[0].chat_id).toBe("abc");
    expect(result.current.data?.[1].chat_id).toBe("def");
  });
});

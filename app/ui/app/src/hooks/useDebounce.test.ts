// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDebounce } from "./useDebounce";

describe("useDebounce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the initial value immediately", () => {
    const { result } = renderHook(() => useDebounce("hello", 300));
    expect(result.current).toBe("hello");
  });

  it("updates after the specified delay", () => {
    const { result, rerender } = renderHook(
      ({ value, delay }: { value: string; delay: number }) =>
        useDebounce(value, delay),
      { initialProps: { value: "initial", delay: 300 } },
    );

    expect(result.current).toBe("initial");

    rerender({ value: "updated", delay: 300 });
    // Not yet updated
    expect(result.current).toBe("initial");

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(result.current).toBe("updated");
  });

  it("cancels the previous timer when value changes", () => {
    const { result, rerender } = renderHook(
      ({ value, delay }: { value: string; delay: number }) =>
        useDebounce(value, delay),
      { initialProps: { value: "v1", delay: 500 } },
    );

    rerender({ value: "v2", delay: 500 });
    act(() => {
      vi.advanceTimersByTime(300); // not enough
    });

    // Change again before the timer fires
    rerender({ value: "v3", delay: 500 });
    act(() => {
      vi.advanceTimersByTime(500);
    });

    // Only the last value should appear
    expect(result.current).toBe("v3");
  });

  it("only emits the last value after rapid changes", () => {
    const { result, rerender } = renderHook(
      ({ value, delay }: { value: number; delay: number }) =>
        useDebounce(value, delay),
      { initialProps: { value: 1, delay: 200 } },
    );

    for (let i = 2; i <= 10; i++) {
      rerender({ value: i, delay: 200 });
      act(() => {
        vi.advanceTimersByTime(50); // too fast, each cancels previous
      });
    }

    // Still shows initial because no timer completed
    expect(result.current).toBe(1);

    // Let the final timer complete
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(result.current).toBe(10);
  });

  it("updates immediately with delay 0", () => {
    const { result, rerender } = renderHook(
      ({ value, delay }: { value: string; delay: number }) =>
        useDebounce(value, delay),
      { initialProps: { value: "first", delay: 0 } },
    );

    rerender({ value: "second", delay: 0 });

    act(() => {
      vi.advanceTimersByTime(0);
    });

    expect(result.current).toBe("second");
  });
});

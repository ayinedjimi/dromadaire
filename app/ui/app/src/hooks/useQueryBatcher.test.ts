import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { createQueryBatcher } from "./useQueryBatcher";

describe("createQueryBatcher", () => {
  let queryClient: QueryClient;
  const queryKey = ["test-key"] as const;

  beforeEach(() => {
    vi.useFakeTimers();
    queryClient = new QueryClient();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should batch updates and flush after batchInterval", () => {
    const batcher = createQueryBatcher<string>(queryClient, queryKey, {
      batchInterval: 32,
    });

    batcher.scheduleBatch(() => "value1");
    // Not flushed yet
    expect(queryClient.getQueryData(queryKey)).toBeUndefined();

    batcher.scheduleBatch(() => "value2");
    // Still not flushed
    expect(queryClient.getQueryData(queryKey)).toBeUndefined();

    // Advance past batchInterval
    vi.advanceTimersByTime(32);
    expect(queryClient.getQueryData(queryKey)).toBe("value2");
  });

  it("should apply first update immediately when immediateFirst is true", () => {
    const batcher = createQueryBatcher<string>(queryClient, queryKey, {
      batchInterval: 32,
      immediateFirst: true,
    });

    // First update should be immediate
    batcher.scheduleBatch(() => "first");
    expect(queryClient.getQueryData(queryKey)).toBe("first");

    // Second update should be batched
    batcher.scheduleBatch(() => "second");
    expect(queryClient.getQueryData(queryKey)).toBe("first");

    vi.advanceTimersByTime(32);
    expect(queryClient.getQueryData(queryKey)).toBe("second");
  });

  it("should flush manually with flushBatch()", () => {
    const batcher = createQueryBatcher<string>(queryClient, queryKey, {
      batchInterval: 100,
    });

    batcher.scheduleBatch(() => "manual-flush");
    expect(queryClient.getQueryData(queryKey)).toBeUndefined();

    batcher.flushBatch();
    expect(queryClient.getQueryData(queryKey)).toBe("manual-flush");
  });

  it("should cancel pending timer and reset state on cleanup()", () => {
    const batcher = createQueryBatcher<string>(queryClient, queryKey, {
      batchInterval: 100,
    });

    batcher.scheduleBatch(() => "will-be-cancelled");
    batcher.cleanup();

    // Advance timers — nothing should flush since cleanup was called
    vi.advanceTimersByTime(200);
    expect(queryClient.getQueryData(queryKey)).toBeUndefined();
  });

  it("should throttle multiple rapid calls into a single flush", () => {
    const setQueryDataSpy = vi.spyOn(queryClient, "setQueryData");

    const batcher = createQueryBatcher<number>(queryClient, queryKey, {
      batchInterval: 50,
    });

    // Multiple rapid updates
    batcher.scheduleBatch(() => 1);
    batcher.scheduleBatch((old) => (old ?? 0) + 1);
    batcher.scheduleBatch((old) => (old ?? 0) + 1);
    batcher.scheduleBatch((old) => (old ?? 0) + 1);

    // No flush yet
    expect(setQueryDataSpy).not.toHaveBeenCalled();

    // Single flush after interval
    vi.advanceTimersByTime(50);
    expect(setQueryDataSpy).toHaveBeenCalledTimes(1);
    // The updater chains: 1 -> 2 -> 3 -> 4
    expect(queryClient.getQueryData(queryKey)).toBe(4);
  });

  it("should use default batchInterval of 32ms when not specified", () => {
    const batcher = createQueryBatcher<string>(queryClient, queryKey);

    batcher.scheduleBatch(() => "default-interval");

    vi.advanceTimersByTime(31);
    expect(queryClient.getQueryData(queryKey)).toBeUndefined();

    vi.advanceTimersByTime(1);
    expect(queryClient.getQueryData(queryKey)).toBe("default-interval");
  });

  it("should reset isFirstUpdate after cleanup", () => {
    const batcher = createQueryBatcher<string>(queryClient, queryKey, {
      immediateFirst: true,
    });

    batcher.scheduleBatch(() => "first");
    expect(queryClient.getQueryData(queryKey)).toBe("first");

    // Second update batched
    batcher.scheduleBatch(() => "second");
    expect(queryClient.getQueryData(queryKey)).toBe("first");

    // Cleanup resets isFirstUpdate
    batcher.cleanup();

    // Now the next call should be immediate again
    batcher.scheduleBatch(() => "after-cleanup");
    expect(queryClient.getQueryData(queryKey)).toBe("after-cleanup");
  });
});

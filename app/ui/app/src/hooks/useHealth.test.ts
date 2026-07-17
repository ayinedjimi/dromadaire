// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { useHealth } from "./useHealth";

vi.mock("@/api", () => ({
  fetchHealth: vi.fn(),
}));

import { fetchHealth } from "@/api";

const mockFetchHealth = vi.mocked(fetchHealth);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

describe("useHealth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return isHealthy: true when fetch succeeds", async () => {
    mockFetchHealth.mockResolvedValue(true);

    const { result } = renderHook(() => useHealth(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isHealthy).toBe(true);
    });

    expect(result.current.isChecking).toBe(false);
  });

  it("should return isHealthy: false when fetch fails", async () => {
    mockFetchHealth.mockRejectedValue(new Error("Server unavailable"));

    const { result } = renderHook(() => useHealth(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isChecking).toBe(false);
    });

    expect(result.current.isHealthy).toBe(false);
  });

  it("should return isHealthy: false when fetch returns false", async () => {
    mockFetchHealth.mockResolvedValue(false);

    const { result } = renderHook(() => useHealth(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isChecking).toBe(false);
    });

    expect(result.current.isHealthy).toBe(false);
  });

  it("should start with isChecking: true while loading", () => {
    mockFetchHealth.mockReturnValue(new Promise(() => {})); // Never resolves

    const { result } = renderHook(() => useHealth(), {
      wrapper: createWrapper(),
    });

    expect(result.current.isChecking).toBe(true);
    expect(result.current.isHealthy).toBe(false);
  });
});

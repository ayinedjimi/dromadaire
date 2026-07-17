// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { useTheme, THEMES, type Theme } from "./useTheme";

vi.mock("@/api", () => ({
  getSettings: vi.fn(),
}));

import { getSettings } from "@/api";

const mockGetSettings = vi.mocked(getSettings);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

describe("useTheme", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clean up html classes
    const root = document.documentElement;
    root.className = "";
  });

  it("should apply the theme class on <html>", async () => {
    mockGetSettings.mockResolvedValue({
      settings: { Theme: "dark" } as any,
    });

    renderHook(() => useTheme(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(document.documentElement.classList.contains("dark")).toBe(true);
    });
  });

  it.each([
    ["dark", true],
    ["oled", true],
    ["blue-night", true],
    ["nord", true],
  ] as [Theme, boolean][])(
    "dark theme '%s' should add the 'dark' class",
    async (theme, _) => {
      mockGetSettings.mockResolvedValue({
        settings: { Theme: theme } as any,
      });

      renderHook(() => useTheme(), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(document.documentElement.classList.contains(theme)).toBe(true);
        expect(document.documentElement.classList.contains("dark")).toBe(true);
      });
    },
  );

  it.each([
    ["light", false],
    ["sepia", false],
  ] as [Theme, boolean][])(
    "light theme '%s' should NOT add the 'dark' class",
    async (theme, _) => {
      mockGetSettings.mockResolvedValue({
        settings: { Theme: theme } as any,
      });

      renderHook(() => useTheme(), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(document.documentElement.classList.contains(theme)).toBe(true);
      });
      expect(document.documentElement.classList.contains("dark")).toBe(false);
    },
  );

  it("should remove old theme class when theme changes", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children);

    // Start with dark theme
    mockGetSettings.mockResolvedValue({
      settings: { Theme: "dark" } as any,
    });

    const { unmount } = renderHook(() => useTheme(), { wrapper });

    await waitFor(() => {
      expect(document.documentElement.classList.contains("dark")).toBe(true);
    });

    unmount();

    // Switch to sepia
    mockGetSettings.mockResolvedValue({
      settings: { Theme: "sepia" } as any,
    });

    // Invalidate settings query so it refetches
    queryClient.clear();

    renderHook(() => useTheme(), { wrapper });

    await waitFor(() => {
      expect(document.documentElement.classList.contains("sepia")).toBe(true);
    });

    // Old theme class should be removed
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("should default to 'light' when no theme is set", async () => {
    mockGetSettings.mockResolvedValue({
      settings: { Theme: "" } as any,
    });

    const { result } = renderHook(() => useTheme(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current).toBe("light");
    });

    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("should apply each theme class correctly", async () => {
    for (const theme of THEMES) {
      document.documentElement.className = "";

      mockGetSettings.mockResolvedValue({
        settings: { Theme: theme } as any,
      });

      const { result, unmount } = renderHook(() => useTheme(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current).toBe(theme);
      });

      expect(document.documentElement.classList.contains(theme)).toBe(true);
      unmount();
    }
  });
});

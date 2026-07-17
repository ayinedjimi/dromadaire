// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { useSettings } from "./useSettings";
import { Settings } from "@/gotypes";

vi.mock("@/api", () => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
}));

import { getSettings, updateSettings } from "@/api";

const mockGetSettings = vi.mocked(getSettings);
const mockUpdateSettings = vi.mocked(updateSettings);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

describe("useSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should fetch settings and return mapped values", async () => {
    const mockSettings = new Settings({
      TurboEnabled: true,
      WebSearchEnabled: false,
      ThinkEnabled: true,
      ThinkLevel: "high",
      SelectedModel: "gemma3:4b",
      SidebarOpen: true,
      AirplaneMode: false,
      EncryptionEnabled: true,
      RAGEnabled: false,
      EmbeddingModel: "snowflake-arctic-embed:33m",
      LockTimeoutMinutes: 5,
      AutoDeleteDays: 30,
      ClipboardClearSeconds: 10,
    });

    mockGetSettings.mockResolvedValue({ settings: mockSettings });

    const { result } = renderHook(() => useSettings(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.settings.turboEnabled).toBe(true);
    });

    expect(result.current.settings.webSearchEnabled).toBe(false);
    expect(result.current.settings.thinkEnabled).toBe(true);
    expect(result.current.settings.thinkLevel).toBe("high");
    expect(result.current.settings.selectedModel).toBe("gemma3:4b");
    expect(result.current.settings.sidebarOpen).toBe(true);
    expect(result.current.settings.airplaneMode).toBe(false);
    expect(result.current.settings.encryptionEnabled).toBe(true);
    expect(result.current.settings.ragEnabled).toBe(false);
    expect(result.current.settings.embeddingModel).toBe(
      "snowflake-arctic-embed:33m",
    );
    expect(result.current.settings.lockTimeoutMinutes).toBe(5);
    expect(result.current.settings.autoDeleteDays).toBe(30);
    expect(result.current.settings.clipboardClearSeconds).toBe(10);
  });

  it("should return default values when settings data is undefined", async () => {
    mockGetSettings.mockResolvedValue({ settings: new Settings({}) });

    const { result } = renderHook(() => useSettings(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.settingsData).toBeDefined();
    });

    expect(result.current.settings.turboEnabled).toBe(false);
    expect(result.current.settings.selectedModel).toBe("");
    expect(result.current.settings.thinkLevel).toBe("none");
    expect(result.current.settings.lockTimeoutMinutes).toBe(0);
  });

  it("should merge partial updates when calling setSettings", async () => {
    const originalSettings = new Settings({
      TurboEnabled: false,
      SelectedModel: "gemma3:4b",
      SidebarOpen: true,
    });

    mockGetSettings.mockResolvedValue({ settings: originalSettings });
    mockUpdateSettings.mockResolvedValue({
      settings: new Settings({
        ...originalSettings,
        TurboEnabled: true,
      }),
    });

    const { result } = renderHook(() => useSettings(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.settingsData).toBeDefined();
    });

    await result.current.setSettings({ TurboEnabled: true });

    expect(mockUpdateSettings).toHaveBeenCalledTimes(1);
    const calledWith = mockUpdateSettings.mock.calls[0][0];
    expect(calledWith.TurboEnabled).toBe(true);
    // Original values should be preserved in the merged settings
    expect(calledWith.SelectedModel).toBe("gemma3:4b");
    expect(calledWith.SidebarOpen).toBe(true);
  });
});

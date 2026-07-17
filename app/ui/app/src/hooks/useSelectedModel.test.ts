// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { recommendDefaultModel, useSelectedModel } from "./useSelectedModel";
import { Model } from "@/gotypes";

// Mock all dependencies
vi.mock("@/api", () => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  getModels: vi.fn(),
  getInferenceCompute: vi.fn(),
}));

vi.mock("@/utils/mergeModels", () => ({
  mergeModels: vi.fn((models: any[]) => models),
}));

// Mock useChat to avoid StreamingProvider dependency
vi.mock("./useChats", () => ({
  useChat: vi.fn(() => ({
    data: undefined,
    isLoading: false,
  })),
  useChats: vi.fn(() => ({
    data: undefined,
    isLoading: false,
  })),
}));

import {
  getSettings,
  updateSettings,
  getModels,
  getInferenceCompute,
} from "@/api";
import { Settings } from "@/gotypes";

const mockGetSettings = vi.mocked(getSettings);
const mockUpdateSettings = vi.mocked(updateSettings);
const mockGetModels = vi.mocked(getModels);
const mockGetInferenceCompute = vi.mocked(getInferenceCompute);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

describe("recommendDefaultModel", () => {
  it("should return qwen2.5:1.5b for VRAM < 6GB", () => {
    expect(recommendDefaultModel(0)).toBe("qwen2.5:1.5b");
    expect(recommendDefaultModel(2)).toBe("qwen2.5:1.5b");
    expect(recommendDefaultModel(4)).toBe("qwen2.5:1.5b");
    expect(recommendDefaultModel(5.9)).toBe("qwen2.5:1.5b");
  });

  it("should return gemma3:4b for 6GB <= VRAM < 16GB", () => {
    expect(recommendDefaultModel(6)).toBe("gemma3:4b");
    expect(recommendDefaultModel(8)).toBe("gemma3:4b");
    expect(recommendDefaultModel(12)).toBe("gemma3:4b");
    expect(recommendDefaultModel(15.9)).toBe("gemma3:4b");
  });

  it("should return gpt-oss:20b for VRAM >= 16GB", () => {
    expect(recommendDefaultModel(16)).toBe("gpt-oss:20b");
    expect(recommendDefaultModel(24)).toBe("gpt-oss:20b");
    expect(recommendDefaultModel(48)).toBe("gpt-oss:20b");
  });

  it("should handle negative VRAM (clamp to 0)", () => {
    expect(recommendDefaultModel(-5)).toBe("qwen2.5:1.5b");
  });

  it("should handle NaN VRAM (fallback to 0)", () => {
    expect(recommendDefaultModel(NaN)).toBe("qwen2.5:1.5b");
  });
});

describe("useSelectedModel", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockGetModels.mockResolvedValue([
      new Model({ model: "gemma3:4b" }),
      new Model({ model: "qwen2.5:1.5b" }),
    ]);

    mockGetInferenceCompute.mockResolvedValue([
      { vram: "8589934592" } as any, // ~8GB
    ]);
  });

  it("should auto-select recommended model when no model is selected", async () => {
    const settingsObj = new Settings({
      SelectedModel: "",
      AirplaneMode: false,
    });

    mockGetSettings.mockResolvedValue({ settings: settingsObj });
    mockUpdateSettings.mockResolvedValue({
      settings: new Settings({ ...settingsObj, SelectedModel: "gemma3:4b" }),
    });

    const { result } = renderHook(() => useSelectedModel(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Should have called setSettings to auto-select a model
    await waitFor(() => {
      expect(mockUpdateSettings).toHaveBeenCalled();
    });
  });

  it("should return the selected model from settings", async () => {
    const settingsObj = new Settings({
      SelectedModel: "gemma3:4b",
      AirplaneMode: false,
    });

    mockGetSettings.mockResolvedValue({ settings: settingsObj });

    const { result } = renderHook(() => useSelectedModel(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.selectedModel).not.toBeNull();
    });

    expect(result.current.selectedModel?.model).toBe("gemma3:4b");
  });

  it("should return null selectedModel when no model is set and models list is empty", async () => {
    mockGetModels.mockResolvedValue([]);
    mockGetSettings.mockResolvedValue({
      settings: new Settings({ SelectedModel: "", AirplaneMode: false }),
    });

    const { result } = renderHook(() => useSelectedModel(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.selectedModel).toBeNull();
  });
});

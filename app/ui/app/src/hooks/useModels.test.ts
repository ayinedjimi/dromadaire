// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { useModels } from "./useModels";
import { Model } from "@/gotypes";

vi.mock("@/api", () => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  getModels: vi.fn(),
}));

vi.mock("@/utils/mergeModels", () => ({
  mergeModels: vi.fn((models: any[]) => models),
}));

import { getSettings, getModels } from "@/api";
import { mergeModels } from "@/utils/mergeModels";
import { Settings } from "@/gotypes";

const mockGetSettings = vi.mocked(getSettings);
const mockGetModels = vi.mocked(getModels);
const mockMergeModels = vi.mocked(mergeModels);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

describe("useModels", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockGetSettings.mockResolvedValue({
      settings: new Settings({ AirplaneMode: false }),
    });
  });

  it("should return the list of models", async () => {
    const models = [
      new Model({ model: "gemma3:4b" }),
      new Model({ model: "llama3:latest" }),
      new Model({ model: "mistral:latest" }),
    ];

    mockGetModels.mockResolvedValue(models);
    mockMergeModels.mockReturnValue(models);

    const { result } = renderHook(() => useModels(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toHaveLength(3);
    expect(result.current.data[0].model).toBe("gemma3:4b");
    expect(result.current.data[1].model).toBe("llama3:latest");
    expect(result.current.data[2].model).toBe("mistral:latest");
  });

  it("should filter models by search query", async () => {
    const models = [
      new Model({ model: "gemma3:4b" }),
      new Model({ model: "llama3:latest" }),
      new Model({ model: "gemma3:12b" }),
    ];

    mockGetModels.mockResolvedValue(models);
    mockMergeModels.mockReturnValue(models);

    const { result } = renderHook(() => useModels("gemma"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toHaveLength(2);
    expect(result.current.data.every((m) => m.model.includes("gemma"))).toBe(
      true,
    );
  });

  it("should deduplicate models with same name", async () => {
    const models = [
      new Model({ model: "gemma3:4b" }),
      new Model({ model: "gemma3:4b" }),
      new Model({ model: "Gemma3:4b" }),
    ];

    mockGetModels.mockResolvedValue(models);
    mockMergeModels.mockReturnValue(models);

    const { result } = renderHook(() => useModels("gemma"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Should deduplicate case-insensitively
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data[0].model).toBe("gemma3:4b");
  });

  it("should return all models when search query is empty", async () => {
    const models = [
      new Model({ model: "gemma3:4b" }),
      new Model({ model: "llama3:latest" }),
    ];

    mockGetModels.mockResolvedValue(models);
    mockMergeModels.mockReturnValue(models);

    const { result } = renderHook(() => useModels(""), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // No filtering when searchQuery is empty
    expect(result.current.data).toHaveLength(2);
  });

  it("should pass models through mergeModels", async () => {
    const rawModels = [new Model({ model: "test:latest" })];
    const mergedModels = [
      new Model({ model: "featured:1b" }),
      new Model({ model: "test:latest" }),
    ];

    mockGetModels.mockResolvedValue(rawModels);
    mockMergeModels.mockReturnValue(mergedModels);

    const { result } = renderHook(() => useModels(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(mockMergeModels).toHaveBeenCalled();
    expect(result.current.data).toHaveLength(2);
  });

  it("should return empty array when no models available", async () => {
    mockGetModels.mockResolvedValue([]);
    mockMergeModels.mockReturnValue([]);

    const { result } = renderHook(() => useModels(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toEqual([]);
  });
});

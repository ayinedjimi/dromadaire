// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { useToolApproval } from "./useChats";

// Mock all imports that useChats.ts pulls in at module load time.
// Only useToolApproval is exercised here, so the mocks can be minimal stubs.
vi.mock("@/api", () => ({
  getChats: vi.fn(),
  getChat: vi.fn(),
  sendMessage: vi.fn(),
  getModelCapabilities: vi.fn(),
}));

vi.mock("./useSelectedModel", () => ({
  useSelectedModel: vi.fn(() => ({ selectedModel: null })),
}));

vi.mock("./useModels", () => ({
  useRefetchModels: vi.fn(() => vi.fn()),
}));

vi.mock("./useSettings", () => ({
  useSettings: vi.fn(() => ({
    settings: { airplaneMode: false },
  })),
}));

vi.mock("@/contexts/StreamingContext", () => ({
  useStreamingContext: vi.fn(() => ({
    streamingChatIds: new Set<string>(),
    loadingChats: new Set<string>(),
    downloadProgress: new Map<string, unknown>(),
    abortControllers: new Map<string, AbortController>(),
    setStreamingChatIds: vi.fn(),
    setLoadingChats: vi.fn(),
    setAbortControllers: vi.fn(),
    setDownloadProgress: vi.fn(),
  })),
}));

vi.mock("@/contexts/IncognitoContext", () => ({
  useIncognito: vi.fn(() => ({ incognito: false })),
}));

vi.mock("./useQueryBatcher", () => ({
  createQueryBatcher: vi.fn(() => ({
    scheduleBatch: vi.fn(),
    flushBatch: vi.fn(),
    cleanup: vi.fn(),
  })),
}));

// ---------------------------------------------------------------------------
// Helper: create a fresh QueryClient + wrapper for each test.
// ---------------------------------------------------------------------------

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  return { queryClient, wrapper };
}

// ---------------------------------------------------------------------------
// Tests for useToolApproval
// ---------------------------------------------------------------------------

describe("useToolApproval", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null pendingApproval when nothing is stored in the query cache", () => {
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useToolApproval("chat-123"), {
      wrapper,
    });

    expect(result.current.pendingApproval).toBeNull();
  });

  it("returns the approval data when it has been set in the query cache", () => {
    const { queryClient, wrapper } = createWrapper();

    const approvalData = {
      command: "ls /tmp",
      toolName: "bash",
      chatId: "chat-456",
    };

    // Pre-seed the cache before rendering the hook.
    queryClient.setQueryData(["toolApproval", "chat-456"], approvalData);

    const { result } = renderHook(() => useToolApproval("chat-456"), {
      wrapper,
    });

    expect(result.current.pendingApproval).toEqual(approvalData);
    expect(result.current.pendingApproval?.command).toBe("ls /tmp");
    expect(result.current.pendingApproval?.toolName).toBe("bash");
    expect(result.current.pendingApproval?.chatId).toBe("chat-456");
  });

  it("clearApproval sets the cache entry to null", () => {
    const { queryClient, wrapper } = createWrapper();

    const approvalData = {
      command: "cat /etc/passwd",
      toolName: "bash",
      chatId: "chat-789",
    };

    queryClient.setQueryData(["toolApproval", "chat-789"], approvalData);

    const { result } = renderHook(() => useToolApproval("chat-789"), {
      wrapper,
    });

    // Sanity-check that the data is visible before clearing.
    expect(result.current.pendingApproval).toEqual(approvalData);

    act(() => {
      result.current.clearApproval();
    });

    // After clearing, the cache value should be null.
    const cached = queryClient.getQueryData(["toolApproval", "chat-789"]);
    expect(cached).toBeNull();
  });

  it("pendingApproval is null after clearApproval is called", () => {
    const { queryClient, wrapper } = createWrapper();

    const approvalData = {
      command: "rm -rf /tmp/old",
      toolName: "bash",
      chatId: "chat-abc",
    };

    queryClient.setQueryData(["toolApproval", "chat-abc"], approvalData);

    const { result, rerender } = renderHook(
      () => useToolApproval("chat-abc"),
      { wrapper },
    );

    act(() => {
      result.current.clearApproval();
    });

    // Re-render so the hook picks up the updated cache.
    rerender();

    expect(result.current.pendingApproval).toBeNull();
  });

  it("isolates approval data per chatId (different chat has no data)", () => {
    const { queryClient, wrapper } = createWrapper();

    queryClient.setQueryData(["toolApproval", "chat-A"], {
      command: "echo hello",
      toolName: "bash",
      chatId: "chat-A",
    });

    // Hook rendered for a completely different chatId.
    const { result } = renderHook(() => useToolApproval("chat-B"), {
      wrapper,
    });

    expect(result.current.pendingApproval).toBeNull();
  });

  it("clearApproval on one chatId does not affect another", () => {
    const { queryClient, wrapper } = createWrapper();

    const dataA = { command: "pwd", toolName: "bash", chatId: "chat-A" };
    const dataB = { command: "whoami", toolName: "bash", chatId: "chat-B" };

    queryClient.setQueryData(["toolApproval", "chat-A"], dataA);
    queryClient.setQueryData(["toolApproval", "chat-B"], dataB);

    const { result: resultA } = renderHook(() => useToolApproval("chat-A"), {
      wrapper,
    });

    act(() => {
      resultA.current.clearApproval();
    });

    // chat-A cache should now be null.
    expect(queryClient.getQueryData(["toolApproval", "chat-A"])).toBeNull();

    // chat-B cache must remain untouched.
    expect(queryClient.getQueryData(["toolApproval", "chat-B"])).toEqual(dataB);
  });

  it("returns an object with pendingApproval and clearApproval properties", () => {
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useToolApproval("chat-shape"), {
      wrapper,
    });

    expect(result.current).toHaveProperty("pendingApproval");
    expect(result.current).toHaveProperty("clearApproval");
    expect(typeof result.current.clearApproval).toBe("function");
  });
});

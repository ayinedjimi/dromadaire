import {
  createContext,
  useContext,
  useState,
  useMemo,
  type ReactNode,
  type Dispatch,
  type SetStateAction,
} from "react";
import { DownloadEvent } from "@/gotypes";

interface StreamingContextType {
  streamingChatIds: Set<string>;
  setStreamingChatIds: Dispatch<SetStateAction<Set<string>>>;
  loadingChats: Set<string>;
  setLoadingChats: Dispatch<SetStateAction<Set<string>>>;
  abortControllers: Map<string, AbortController>;
  setAbortControllers: Dispatch<SetStateAction<Map<string, AbortController>>>;
  downloadProgress: Map<string, DownloadEvent>;
  setDownloadProgress: Dispatch<SetStateAction<Map<string, DownloadEvent>>>;
}

const StreamingContext = createContext<StreamingContextType | undefined>(
  undefined,
);

// Perf note: splitting this into multiple contexts was evaluated but provides
// negligible benefit. All heavy consumers (useChat, useSendMessage, useCancelMessage,
// useDownloadProgress, useIsWaitingForLoad) live in Chat.tsx which needs all state.
// The only external consumers (ChatForm, DisplayStale) use useIsStreaming which only
// reads streamingChatIds — abortControllers changes at the same time so no wasted
// renders, and downloadProgress only changes during rare model downloads.
export function StreamingProvider({ children }: { children: ReactNode }) {
  const [streamingChatIds, setStreamingChatIds] = useState<Set<string>>(
    new Set(),
  );
  const [loadingChats, setLoadingChats] = useState<Set<string>>(new Set());
  const [abortControllers, setAbortControllers] = useState<
    Map<string, AbortController>
  >(new Map());
  const [downloadProgress, setDownloadProgress] = useState<
    Map<string, DownloadEvent>
  >(new Map());

  const contextValue = useMemo(
    () => ({
      streamingChatIds,
      setStreamingChatIds,
      loadingChats,
      setLoadingChats,
      abortControllers,
      setAbortControllers,
      downloadProgress,
      setDownloadProgress,
    }),
    [streamingChatIds, loadingChats, abortControllers, downloadProgress],
  );

  return (
    <StreamingContext.Provider value={contextValue}>
      {children}
    </StreamingContext.Provider>
  );
}

export function useStreamingContext() {
  const context = useContext(StreamingContext);
  if (context === undefined) {
    throw new Error(
      "useStreamingContext must be used within a StreamingProvider",
    );
  }
  return context;
}

export function useAnyStreaming(): boolean {
  const { streamingChatIds } = useStreamingContext();
  return streamingChatIds.size > 0;
}

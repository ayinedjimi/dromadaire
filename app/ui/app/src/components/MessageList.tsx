import { Message as MessageType, DownloadEvent, ErrorEvent, RAGSource } from "@/gotypes";
import type { ArtifactPreviewData } from "./ArtifactPreviewPanel";
import React from "react";
import { useVirtualizer } from '@tanstack/react-virtual';
import Message from "./Message";
import Downloading from "./Downloading";
import ModelLoading, { storeLoadDuration } from "./ModelLoading";
import { ErrorMessage } from "./ErrorMessage";
import { ToolApprovalBlock } from "./ToolApprovalBlock";
import { useToolApproval } from "@/hooks/useChats";
import { ChatStats } from "./ChatStats";
import { useSettings } from "@/hooks/useSettings";

export default function MessageList({
  chatId,
  messages,
  spacerHeight,
  isWaitingForLoad,
  isStreaming,
  downloadProgress,
  onEditMessage,
  editingMessageIndex,
  error,
  onErrorDismiss,
  browserToolResult,
  onCitationClick,
  artifactsEnabled,
  onArtifactPreview,
  scrollContainerRef,
  modelName,
  onRegenerate,
  onContinue,
  onDeleteMessage,
  onFollowUp,
  altOverrides,
  onSwitchAlternative,
}: {
  chatId: string;
  messages: MessageType[];
  spacerHeight: number;
  isWaitingForLoad?: boolean;
  isStreaming: boolean;
  downloadProgress?: DownloadEvent;
  onEditMessage?: (content: string, index: number) => void | Promise<void>;
  editingMessageIndex?: number;
  error?: ErrorEvent | null;
  onErrorDismiss?: () => void;
  browserToolResult?: any;
  onCitationClick?: (source: RAGSource) => void;
  artifactsEnabled?: boolean;
  onArtifactPreview?: (artifact: ArtifactPreviewData) => void;
  scrollContainerRef?: React.RefObject<HTMLElement | null>;
  modelName?: string;
  onRegenerate?: (messageIndex: number) => void;
  onContinue?: () => void;
  onDeleteMessage?: (messageIndex: number) => void;
  onFollowUp?: (prompt: string) => void;
  altOverrides?: Map<number, { content: string; thinking: string }>;
  onSwitchAlternative?: (messageIndex: number, alt: { content: string; thinking: string; isCurrent?: boolean }) => void;
}) {
  const { pendingApproval, clearApproval } = useToolApproval(chatId);
  const { settings } = useSettings();
  const [showDots, setShowDots] = React.useState(false);
  const [showModelLoading, setShowModelLoading] = React.useState(false);
  const isDownloadingModel = downloadProgress && !downloadProgress.done;
  const shouldShowDownload = messages.length > 0;

  // LOT 25: find last assistant message index for "Continue" button
  const lastAssistantIdx = React.useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") return i;
    }
    return -1;
  }, [messages]);

  // Dromadaire: track model loading duration for calibrated progress bar
  const loadStartRef = React.useRef<number | null>(null);

  // Dromadaire: show model loading bar when waiting for model to load into memory
  React.useEffect(() => {
    let timer: number;
    if (isWaitingForLoad && !isDownloadingModel) {
      if (loadStartRef.current === null) loadStartRef.current = Date.now();
      timer = window.setTimeout(() => {
        setShowModelLoading(true);
      }, 300);
    } else {
      // Loading just ended — store measured duration for this model
      if (loadStartRef.current !== null && modelName && isStreaming) {
        storeLoadDuration(modelName, Date.now() - loadStartRef.current);
      }
      loadStartRef.current = null;
      setShowModelLoading(false);
    }
    return () => window.clearTimeout(timer);
  }, [isWaitingForLoad, isDownloadingModel, modelName, isStreaming]);

  React.useEffect(() => {
    let timer: number;
    if (
      isStreaming &&
      !isWaitingForLoad &&
      !isDownloadingModel &&
      messages.length > 0 &&
      messages[messages.length - 1]?.role === "user"
    ) {
      timer = window.setTimeout(() => {
        setShowDots(true);
      }, 750); // Wait 750ms before showing dots
    } else {
      setShowDots(false);
    }

    return () => window.clearTimeout(timer);
  }, [isStreaming, isWaitingForLoad, isDownloadingModel, messages]);

  // Dromadaire: token rate counter during streaming
  const streamStartRef = React.useRef<number | null>(null);
  const prevContentLenRef = React.useRef<number>(0);
  const [tokenRate, setTokenRate] = React.useState<number | null>(null);
  const [totalTime, setTotalTime] = React.useState<number | null>(null);

  React.useEffect(() => {
    const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;
    const isAssistantStreaming =
      isStreaming && lastMsg?.role === "assistant" && lastMsg.content;

    if (isAssistantStreaming) {
      const contentLen = lastMsg.content.length;
      if (streamStartRef.current === null && contentLen > 0) {
        streamStartRef.current = Date.now();
        prevContentLenRef.current = 0;
        setTotalTime(null);
      }
      if (streamStartRef.current !== null && contentLen > prevContentLenRef.current) {
        prevContentLenRef.current = contentLen;
        const elapsed = (Date.now() - streamStartRef.current) / 1000;
        // Rough token estimate: ~4 chars per token for French/English
        const estimatedTokens = Math.round(contentLen / 4);
        if (elapsed > 0.5) {
          setTokenRate(Math.round((estimatedTokens / elapsed) * 10) / 10);
        }
      }
    } else if (streamStartRef.current !== null) {
      // Streaming just ended - show final stats briefly
      const elapsed = (Date.now() - streamStartRef.current) / 1000;
      setTotalTime(Math.round(elapsed * 10) / 10);
      streamStartRef.current = null;
      // Clear after 5 seconds
      const timer = window.setTimeout(() => {
        setTokenRate(null);
        setTotalTime(null);
      }, 5000);
      return () => window.clearTimeout(timer);
    }
  }, [isStreaming, messages]);

  const lastIdx = messages.length - 1;

  // Memoize the last tool query (web_search query or web_fetch url) at each message index
  const lastToolQueries = React.useMemo(() => {
    const queries: (string | undefined)[] = [];
    let lastQuery: string | undefined = undefined;
    for (let i = 0; i < messages.length; i++) {
      const m: any = messages[i] as any;
      const toolCalls: any[] | undefined = Array.isArray(m?.tool_calls)
        ? (m.tool_calls as any[])
        : m?.tool_call
          ? [m.tool_call]
          : undefined;
      if (toolCalls && toolCalls.length > 0) {
        for (const tc of toolCalls) {
          const name = tc?.function?.name;
          if (name === "web_search" || name === "web_fetch") {
            try {
              const args = JSON.parse(tc.function.arguments || "{}");
              const candidate =
                typeof args.query === "string" && args.query.trim()
                  ? String(args.query).trim()
                  : typeof args.url === "string" && args.url.trim()
                    ? String(args.url).trim()
                    : "";
              if (candidate) lastQuery = candidate;
            } catch {
              // intentionally empty - parsing failure is acceptable
            }
          }
        }
      }
      queries.push(lastQuery);
    }
    return queries;
  }, [messages]);

  const shouldVirtualize = messages.length > 50;

  const estimateMessageSize = React.useCallback((index: number) => {
    const msg = messages[index];
    if (!msg) return 120;
    const len = (msg.content?.length ?? 0) + (msg.thinking?.length ?? 0);
    if (len < 100) return 80;
    if (len < 500) return 150;
    if (len < 2000) return 300;
    return 500;
  }, [messages]);

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollContainerRef?.current ?? null,
    estimateSize: estimateMessageSize,
    overscan: 15,
  });

  return (
    <div
      className={`mx-auto flex flex-1 flex-col px-6 pb-12 select-text ${settings.chatFullWidth ? "max-w-full" : "max-w-[768px]"}`}
      data-role="message-list"
    >
      {/* LOT 29: Chat stats */}
      {messages.length > 0 && (
        <div className="flex justify-end mb-1">
          <ChatStats messages={messages} />
        </div>
      )}

      {/* Messages — virtualized when >50 messages, simple flow layout otherwise */}
      {shouldVirtualize ? (
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const idx = virtualRow.index;
            const message = messages[idx];
            const lastToolQuery = lastToolQueries[idx];
            return (
              <div
                key={`${message.role}-${message.created_at}-${idx}`}
                data-index={idx}
                data-message-index={idx}
                ref={virtualizer.measureElement}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <Message
                  message={(altOverrides?.has(idx)
                    ? { ...message, content: altOverrides.get(idx)!.content, thinking: altOverrides.get(idx)!.thinking }
                    : message) as MessageType}
                  onEditMessage={onEditMessage}
                  messageIndex={idx}
                  isStreaming={isStreaming && idx === lastIdx}
                  isFaded={editingMessageIndex !== undefined && idx >= editingMessageIndex}
                  browserToolResult={browserToolResult}
                  lastToolQuery={lastToolQuery}
                  ragSources={(message as any).ragSources}
                  onCitationClick={onCitationClick}
                  artifactsEnabled={artifactsEnabled}
                  onArtifactPreview={onArtifactPreview}
                  onRegenerate={message.role === "assistant" ? onRegenerate : undefined}
                  onContinue={onContinue}
                  onDeleteMessage={onDeleteMessage}
                  isLastAssistantMessage={idx === lastAssistantIdx}
                  chatId={chatId}
                  onFollowUp={idx === lastAssistantIdx ? onFollowUp : undefined}
                  onSwitchAlternative={onSwitchAlternative}
                />
              </div>
            );
          })}
        </div>
      ) : (
        messages.map((message, idx) => {
          const lastToolQuery = lastToolQueries[idx];
          return (
            <div
              key={`${message.role}-${message.created_at}-${idx}`}
              data-index={idx}
              data-message-index={idx}
            >
              <Message
                message={(altOverrides?.has(idx)
                  ? { ...message, content: altOverrides.get(idx)!.content, thinking: altOverrides.get(idx)!.thinking }
                  : message) as MessageType}
                onEditMessage={onEditMessage}
                messageIndex={idx}
                isStreaming={isStreaming && idx === lastIdx}
                isFaded={editingMessageIndex !== undefined && idx >= editingMessageIndex}
                browserToolResult={browserToolResult}
                lastToolQuery={lastToolQuery}
                ragSources={(message as any).ragSources}
                onCitationClick={onCitationClick}
                artifactsEnabled={artifactsEnabled}
                onArtifactPreview={onArtifactPreview}
                onRegenerate={message.role === "assistant" ? onRegenerate : undefined}
                onContinue={onContinue}
                onDeleteMessage={onDeleteMessage}
                isLastAssistantMessage={idx === lastAssistantIdx}
                chatId={chatId}
                onFollowUp={idx === lastAssistantIdx ? onFollowUp : undefined}
                onSwitchAlternative={onSwitchAlternative}
              />
            </div>
          );
        })
      )}

      {/* Agent loop: tool approval prompt */}
      {pendingApproval && (
        <ToolApprovalBlock
          approval={pendingApproval}
          onResolved={clearApproval}
        />
      )}

      {/* Inline error message */}
      {error &&
        error.code !== "usage_limit_upgrade" &&
        error.code !== "cloud_unauthorized" && <ErrorMessage error={error} onDismiss={onErrorDismiss} />}

      {/* Dromadaire: model loading into memory progress bar */}
      {showModelLoading && (
        <section className="transition-all ease-out duration-300 opacity-100 translate-y-0">
          <ModelLoading modelName={modelName} />
        </section>
      )}

      {/* Indeterminate loading indicator (token generation) */}
      {showDots && !showModelLoading && (
        <div className="flex items-center space-x-1.5 py-3 mt-2 self-start rounded-full px-4 min-w-0 bg-[hsl(var(--bg-100))] border-[hsl(var(--border-100))]">
          <div
            className="w-1.5 h-1.5 bg-[hsl(var(--text-400))] rounded-full opacity-0"
            style={{
              animation: "typing 1.4s infinite",
              animationDelay: "0s",
            }}
          />
          <div
            className="w-1.5 h-1.5 bg-[hsl(var(--text-400))] rounded-full opacity-0"
            style={{
              animation: "typing 1.4s infinite",
              animationDelay: "0.15s",
            }}
          />
          <div
            className="w-1.5 h-1.5 bg-[hsl(var(--text-400))] rounded-full opacity-0"
            style={{
              animation: "typing 1.4s infinite",
              animationDelay: "0.3s",
            }}
          />
        </div>
      )}

      {/* Dromadaire: token rate indicator */}
      {tokenRate !== null && (
        <div className="text-xs text-neutral-400 dark:text-neutral-500 mt-1 ml-1 font-mono">
          {totalTime !== null
            ? `${tokenRate} tok/s · ${totalTime}s`
            : `${tokenRate} tok/s`}
        </div>
      )}

      {/* Downloading model */}
      {/* Only show for models larger than 1KiB */}
      {downloadProgress?.total && downloadProgress.total > 1024 && (
        <section
          className={`
          transition-all ease-out
          ${shouldShowDownload ? "duration-300" : "duration-0"}
          ${
            downloadProgress
              ? downloadProgress.done
                ? "opacity-0 -translate-y-8"
                : "opacity-100 translate-y-0"
              : "opacity-0 translate-y-4 pointer-events-none"
          }
        `}
        >
          <Downloading
            completed={downloadProgress?.completed || 0}
            total={downloadProgress?.total || 0}
          />
        </section>
      )}

      {/* Dynamic spacer */}
      <div style={{ height: `${spacerHeight}px` }} aria-hidden="true" />
    </div>
  );
}

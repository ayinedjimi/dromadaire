import MessageList from "./MessageList";
import ChatForm from "./ChatForm";
import { FileUpload } from "./FileUpload";
import { DisplayUpgrade } from "./DisplayUpgrade";
import { DisplayStale } from "./DisplayStale";
import { DisplayLogin } from "./DisplayLogin";
import {
  useChat,
  useSendMessage,
  useIsStreaming,
  useIsWaitingForLoad,
  useDownloadProgress,
  useChatError,
  useShouldShowStaleDisplay,
  useDismissStaleModel,
} from "@/hooks/useChats";
import { useHealth } from "@/hooks/useHealth";
import { useMessageAutoscroll } from "@/hooks/useMessageAutoscroll";
import {
  useState,
  useEffect,
  useRef,
  useCallback,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useSelectedModel } from "@/hooks/useSelectedModel";
import { useUser } from "@/hooks/useUser";
import { useHasVisionCapability } from "@/hooks/useModelCapabilities";
import { Message, Chat as ChatType, RAGSource } from "@/gotypes";
import { truncateMessages } from "@/api";
import { DocumentPreview } from "./DocumentPreview";
import { ArtifactPreviewPanel, type ArtifactPreviewData } from "./ArtifactPreviewPanel";
import { useSettings } from "@/hooks/useSettings";
import { useStreamingContext } from "@/contexts/StreamingContext";
import { ContextPanel, useModelParams } from "./ContextPanel";

export default function Chat({ chatId }: { chatId: string }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const chatQuery = useChat(chatId === "new" ? "" : chatId);
  const chatErrorQuery = useChatError(chatId === "new" ? "" : chatId);
  const { selectedModel } = useSelectedModel(chatId);
  const { user } = useUser();
  const hasVisionCapability = useHasVisionCapability(selectedModel?.model);
  const { settings, settingsData, setSettings } = useSettings();

  // LOT 17: Document preview panel state
  const [previewDocument, setPreviewDocument] = useState<{
    id: string;
    name: string;
    chunkIndex?: number;
  } | null>(null);

  // LOT E1: Multi-artifact support — store array + active index
  const [artifacts, setArtifacts] = useState<ArtifactPreviewData[]>([]);
  const [activeArtifactIdx, setActiveArtifactIdx] = useState(0);
  const artifactPreview = artifacts.length > 0 ? artifacts[activeArtifactIdx] : null;

  // Resizable preview pane state — LOT A3: persist width in localStorage
  const [previewWidth, setPreviewWidth] = useState(() => {
    try {
      const saved = localStorage.getItem("dromadaire-preview-width");
      return saved ? Math.max(280, Math.min(800, parseInt(saved, 10))) : 420;
    } catch { return 420; }
  });
  const previewWidthRef = useRef(previewWidth);
  const isDraggingRef = useRef(false);
  const dragStartXRef = useRef(0);
  const dragStartWidthRef = useRef(previewWidth);
  // LOT A1: Panel visibility for animation
  const [panelVisible, setPanelVisible] = useState(false);

  // Keep ref in sync with state + LOT A3: persist width
  useEffect(() => {
    previewWidthRef.current = previewWidth;
    try { localStorage.setItem("dromadaire-preview-width", String(previewWidth)); } catch {}
  }, [previewWidth]);

  // LOT A1: Animate panel in/out
  useEffect(() => {
    if (artifactPreview) {
      // Delay to allow CSS transition from width:0
      requestAnimationFrame(() => setPanelVisible(true));
    } else {
      setPanelVisible(false);
    }
  }, [artifactPreview]);

  // Clear preview panels when switching chats
  useEffect(() => {
    setArtifacts([]);
    setActiveArtifactIdx(0);
    setPreviewDocument(null);
    setArtifactFullscreen(false);
  }, [chatId]);

  // LOT E1: Add or update artifact in the list
  const handleArtifactPreview = useCallback((artifact: ArtifactPreviewData) => {
    setArtifacts(prev => {
      // If streaming update for same language, update last artifact of that language
      const existingIdx = prev.findIndex(a => a.language === artifact.language && a.isStreaming);
      if (existingIdx >= 0) {
        const updated = [...prev];
        updated[existingIdx] = artifact;
        return updated;
      }
      // Check if same code already exists
      const sameCode = prev.findIndex(a => a.code === artifact.code);
      if (sameCode >= 0) return prev;
      // Add new artifact (max 8)
      const next = [...prev, artifact].slice(-8);
      // Auto-select the new one
      setTimeout(() => setActiveArtifactIdx(next.length - 1), 0);
      return next;
    });
  }, []);

  const handleArtifactClose = useCallback(() => {
    setArtifacts([]);
    setActiveArtifactIdx(0);
    setArtifactFullscreen(false);
  }, []);

  // Resizable preview pane — global mouse listeners (always active)
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      e.preventDefault();
      const delta = dragStartXRef.current - e.clientX;
      const newWidth = Math.max(280, Math.min(800, dragStartWidthRef.current + delta));
      setPreviewWidth(newWidth);
    };

    const handleMouseUp = () => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    isDraggingRef.current = true;
    dragStartXRef.current = e.clientX;
    dragStartWidthRef.current = previewWidthRef.current;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  // LOT 32: Context panel state
  const [contextPanelOpen, setContextPanelOpen] = useState(false);
  const { params: modelParams } = useModelParams(selectedModel?.model);

  // LOT 45: Resizable context panel
  const ctxPanelW = settings.contextPanelWidth || 320;
  const [ctxDragWidth, setCtxDragWidth] = useState<number | null>(null);
  const ctxDraggingRef = useRef(false);
  const handleCtxDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    ctxDraggingRef.current = true;
    const startX = e.clientX;
    const startW = ctxPanelW;
    const onMove = (ev: MouseEvent) => {
      const w = Math.max(240, Math.min(600, startW - (ev.clientX - startX)));
      setCtxDragWidth(w);
    };
    const onUp = (ev: MouseEvent) => {
      ctxDraggingRef.current = false;
      const finalW = Math.max(240, Math.min(600, startW - (ev.clientX - startX)));
      setCtxDragWidth(null);
      setSettings({ ContextPanelWidth: finalW });
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [ctxPanelW, setSettings]);
  const currentCtxWidth = ctxDragWidth ?? ctxPanelW;

  useEffect(() => {
    const toggle = () => setContextPanelOpen(prev => !prev);
    const handleKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === "X") {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("toggle-context-panel", toggle);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("toggle-context-panel", toggle);
      window.removeEventListener("keydown", handleKey);
    };
  }, []);

  // LOT D1: Mobile bottom sheet state
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);

  // P2: Fullscreen artifact panel
  const [artifactFullscreen, setArtifactFullscreen] = useState(false);
  const handleToggleFullscreen = useCallback(() => {
    setArtifactFullscreen(prev => !prev);
  }, []);

  // Open mobile sheet when artifact changes on mobile
  useEffect(() => {
    if (artifactPreview && window.innerWidth < 1024) {
      setMobileSheetOpen(true);
    }
  }, [artifactPreview]);

  // LOT D2: Global keyboard shortcut — Ctrl+Shift+P to toggle panel
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === "P") {
        e.preventDefault();
        if (artifactPreview) {
          handleArtifactClose();
          setMobileSheetOpen(false);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [artifactPreview, handleArtifactClose]);

  const handleCitationClick = useCallback((source: RAGSource) => {
    if (settingsData?.RAGPreviewEnabled === false) return;
    setPreviewDocument({
      id: source.document_id,
      name: source.document_name,
      chunkIndex: source.chunk_index,
    });
  }, [settingsData?.RAGPreviewEnabled]);
  const shouldShowStaleDisplay = useShouldShowStaleDisplay(selectedModel);
  const dismissStaleModel = useDismissStaleModel();
  const { isHealthy } = useHealth();

  const [editingMessage, setEditingMessage] = useState<{
    content: string;
    index: number;
    originalMessage: Message;
  } | null>(null);

  // LOT K+: Alternative content overrides — map messageIndex → displayed content
  const [altOverrides, setAltOverrides] = useState<Map<number, { content: string; thinking: string }>>(new Map());

  const handleSwitchAlternative = useCallback((messageIndex: number, alt: { content: string; thinking: string; isCurrent?: boolean }) => {
    setAltOverrides(prev => {
      const next = new Map(prev);
      if (alt.isCurrent) {
        next.delete(messageIndex);
      } else {
        next.set(messageIndex, { content: alt.content, thinking: alt.thinking });
      }
      return next;
    });
  }, []);

  const chatFormCallbackRef = useRef<
    | ((
        files: Array<{ filename: string; data: Uint8Array; type?: string }>,
        errors: Array<{ filename: string; error: string }>,
      ) => void)
    | null
  >(null);

  const handleFilesReceived = useCallback(
    (
      callback: (
        files: Array<{
          filename: string;
          data: Uint8Array;
          type?: string;
        }>,
        errors: Array<{ filename: string; error: string }>,
      ) => void,
    ) => {
      chatFormCallbackRef.current = callback;
    },
    [],
  );

  const handleFilesProcessed = useCallback(
    (
      files: Array<{ filename: string; data: Uint8Array; type?: string }>,
      errors: Array<{ filename: string; error: string }> = [],
    ) => {
      chatFormCallbackRef.current?.(files, errors);
    },
    [],
  );

  const allMessages = chatQuery?.data?.chat?.messages ?? [];
  // TODO(parthsareen): will need to consolidate when used with more tools with state
  const browserToolResult = chatQuery?.data?.chat?.browser_state;
  const chatError = chatErrorQuery.data;

  const messages = allMessages;
  const isStreaming = useIsStreaming(chatId);
  const isWaitingForLoad = useIsWaitingForLoad(chatId);
  const downloadProgress = useDownloadProgress(chatId);
  const isDownloadingModel = downloadProgress && !downloadProgress.done;
  const isDisabled = !isHealthy;

  // Clear editing state when navigating to a different chat
  useEffect(() => {
    setEditingMessage(null);
  }, [chatId]);

  const sendMessageMutation = useSendMessage(chatId);
  const { abortControllers } = useStreamingContext();
  const abortControllersRef = useRef(abortControllers);
  abortControllersRef.current = abortControllers;
  // Abort stream when leaving this chat so we don't update state after unmount
  useEffect(() => {
    return () => {
      const c = abortControllersRef.current.get(chatId);
      if (c) c.abort();
    };
  }, [chatId]);

  const { containerRef, innerRef, handleNewUserMessage, spacerHeight, showScrollBtn, scrollToBottom } =
    useMessageAutoscroll({
      messages,
      isStreaming,
      chatId,
    });

  // Note: scroll-to-bottom on chat switch is now handled by useMessageAutoscroll

  // Simplified submit handler - ChatForm handles all the attachment logic
  const handleChatFormSubmit = (
    message: string,
    options: {
      attachments?: Array<{ filename: string; data: Uint8Array }>;
      index?: number;
      webSearch?: boolean;
      fileTools?: boolean;
      think?: boolean | string;
    },
  ) => {
    // Clear any existing errors when sending a new message
    sendMessageMutation.reset();
    if (chatError) {
      clearChatError();
    }

    // Prepare attachments for backend
    const allAttachments = (options.attachments || []).map((att) => ({
      filename: att.filename,
      data: att.data.length === 0 ? new Uint8Array(0) : att.data,
    }));

    sendMessageMutation.mutate({
      message,
      attachments: allAttachments,
      index: editingMessage ? editingMessage.index : options.index,
      webSearch: options.webSearch,
      fileTools: options.fileTools,
      think: options.think,
      modelParams,
      onChatEvent: (event) => {
        if (event.eventName === "chat_created" && event.chatId) {
          navigate({
            to: "/c/$chatId",
            params: {
              chatId: event.chatId,
            },
          });
        }
      },
    });

    // Clear edit mode after submission
    setEditingMessage(null);
    handleNewUserMessage();
  };

  // P2 perf: ref to always hold the latest handleChatFormSubmit — avoids stale closures in useCallbacks
  const chatFormSubmitRef = useRef(handleChatFormSubmit);
  chatFormSubmitRef.current = handleChatFormSubmit;

  const handleEditMessage = useCallback((content: string, index: number) => {
    setEditingMessage({
      content,
      index,
      originalMessage: messages[index],
    });
  }, [messages]);

  const handleCancelEdit = useCallback(() => {
    setEditingMessage(null);
    if (chatError) {
      clearChatError();
    }
  }, [chatError]);

  const clearChatError = () => {
    queryClient.setQueryData(
      ["chatError", chatId === "new" ? "" : chatId],
      null,
    );
  };

  // LOT 25+30: Regenerate a response — save current as alternative, then resend
  const handleRegenerate = useCallback((assistantMsgIndex: number) => {
    // Save current response as alternative before regenerating (LOT 30)
    const currentMsg = messages[assistantMsgIndex];
    if (currentMsg && chatId && chatId !== "new") {
      import("@/lib/alternatives").then(({ addAlternative }) => {
        addAlternative(chatId, assistantMsgIndex, {
          content: currentMsg.content || "",
          thinking: currentMsg.thinking || "",
          model: currentMsg.model || "",
          created_at: currentMsg.created_at ? String(currentMsg.created_at) : "",
        });
      });
    }

    // Find the user message that precedes this assistant message
    let userMsgIdx = assistantMsgIndex - 1;
    while (userMsgIdx >= 0 && messages[userMsgIdx]?.role !== "user") {
      userMsgIdx--;
    }
    if (userMsgIdx >= 0) {
      const userMsg = messages[userMsgIdx];
      chatFormSubmitRef.current(userMsg.content, { index: userMsgIdx });
    }
  }, [messages, chatId]);

  // LOT 25: Continue the last response
  const handleContinue = useCallback(() => {
    chatFormSubmitRef.current("Continue ta reponse precedente.", {});
  }, []);

  // Follow-up suggestion — send as a new user message
  const handleFollowUp = useCallback((prompt: string) => {
    chatFormSubmitRef.current(prompt, {});
  }, []);

  const handleDeleteMessage = useCallback(async (messageIndex: number) => {
    if (chatId === "new" || !chatId) return;
    try {
      await truncateMessages(chatId, messageIndex);
      queryClient.setQueryData(["chat", chatId], (old: any) => {
        if (!old) return old;
        const msgs = old.chat.messages || [];
        return {
          ...old,
          chat: new ChatType({ ...old.chat, messages: msgs.slice(0, messageIndex) }),
        };
      });
    } catch (e) {
      console.error("Failed to delete message:", e);
    }
  }, [chatId, queryClient]);

  const isWindows = navigator.platform.toLowerCase().includes("win");

  return chatId === "new" || chatQuery ? (
    <FileUpload
      onFilesAdded={handleFilesProcessed}
      selectedModel={selectedModel}
      hasVisionCapability={hasVisionCapability}
    >
      {chatId === "new" ? (
        <div className="flex h-full w-full relative">
          <div className="flex flex-col flex-1 min-w-0 justify-center">
            <div className="px-6">
              <ChatForm
                hasMessages={false}
                onSubmit={handleChatFormSubmit}
                chatId={chatId}
                autoFocus={true}
                editingMessage={editingMessage}
                onCancelEdit={handleCancelEdit}
                isDownloadingModel={isDownloadingModel}
                isDisabled={isDisabled}
                onFilesReceived={handleFilesReceived}
              />
            </div>
          </div>
          {contextPanelOpen && !artifactFullscreen && (
            <>
              <div
                className="w-1 flex-shrink-0 cursor-col-resize hover:bg-blue-400/30 active:bg-blue-400/50 transition-colors"
                onMouseDown={handleCtxDragStart}
              />
              <div className="flex-shrink-0 flex overflow-hidden" style={{ width: currentCtxWidth, transition: ctxDraggingRef.current ? "none" : "width 200ms ease-out" }}>
                <ContextPanel chatId={chatId} selectedModel={selectedModel?.model} onClose={() => setContextPanelOpen(false)} />
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="flex h-full w-full relative allow-context-menu select-none">
          {/* Left column: chat — hidden when artifact panel is fullscreen */}
          <main className={`flex flex-1 min-w-0 min-h-0 flex-col relative ${artifactFullscreen ? "hidden" : ""}`}>
            <section
              key={chatId}
              ref={containerRef}
              className={`flex-1 overflow-y-auto overscroll-contain relative min-h-0 select-none ${isWindows ? "xl:pt-4" : "xl:pt-8"}`}
            >
              <div ref={innerRef}>
                <MessageList
                  chatId={chatId}
                  messages={messages}
                  spacerHeight={spacerHeight}
                  isWaitingForLoad={isWaitingForLoad}
                  isStreaming={isStreaming}
                  downloadProgress={downloadProgress}
                  onEditMessage={handleEditMessage}
                  editingMessageIndex={editingMessage?.index}
                  error={chatError}
                  onErrorDismiss={clearChatError}
                  browserToolResult={browserToolResult}
                  onCitationClick={handleCitationClick}
                  artifactsEnabled={settingsData?.ArtifactsEnabled ?? true}
                  onArtifactPreview={handleArtifactPreview}
                  scrollContainerRef={containerRef}
                  modelName={selectedModel?.model}
                  onRegenerate={handleRegenerate}
                  onContinue={handleContinue}
                  onDeleteMessage={handleDeleteMessage}
                  onFollowUp={handleFollowUp}
                  altOverrides={altOverrides}
                  onSwitchAlternative={handleSwitchAlternative}
                />
              </div>
            </section>

            {/* Micro-anim: scroll-to-bottom floating button */}
            {showScrollBtn && (
              <button
                onClick={() => { scrollToBottom(); }}
                className="animate-scroll-btn absolute z-30 left-1/2 -translate-x-1/2 bottom-[140px] w-8 h-8 rounded-full bg-[hsl(var(--bg-200))] border border-[hsl(var(--border-100))] shadow-md flex items-center justify-center text-[hsl(var(--text-300))] hover:text-[hsl(var(--text-000))] hover:bg-[hsl(var(--bg-300))] transition-colors cursor-pointer"
                title="Défiler vers le bas"
                aria-label="Défiler vers le bas"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 3v10M4 9l4 4 4-4" />
                </svg>
              </button>
            )}

            <div className="flex-shrink-0 sticky bottom-0 z-20">
              {selectedModel && shouldShowStaleDisplay && (
                <div className="pb-2">
                  <DisplayStale
                    model={selectedModel}
                    onDismiss={() =>
                      dismissStaleModel(selectedModel?.model || "")
                    }
                    chatId={chatId}
                    onScrollToBottom={() => {
                      if (containerRef.current) {
                        containerRef.current.scrollTo({
                          top: containerRef.current.scrollHeight,
                          behavior: "smooth",
                        });
                      }
                    }}
                  />
                </div>
              )}
              {chatError && chatError.code === "usage_limit_upgrade" && (
                <div className="pb-2">
                  <DisplayUpgrade
                    error={chatError}
                    onDismiss={clearChatError}
                    href={
                      user?.plan === "pro"
                        ? "https://ollama.com/settings/billing"
                        : "https://ollama.com/upgrade"
                    }
                  />
                </div>
              )}
              {chatError && chatError.code === "cloud_unauthorized" && (
                <div className="pb-2">
                  <DisplayLogin error={chatError} />
                </div>
              )}
              <ChatForm
                hasMessages={messages.length > 0}
                onSubmit={handleChatFormSubmit}
                chatId={chatId}
                autoFocus={true}
                editingMessage={editingMessage}
                onCancelEdit={handleCancelEdit}
                isDisabled={isDisabled}
                isDownloadingModel={isDownloadingModel}
                onFilesReceived={handleFilesReceived}
              />
            </div>

            {/* LOT 17 + F3: Document preview — offset when artifact panel is open */}
            {previewDocument && (
              <DocumentPreview
                documentId={previewDocument.id}
                documentName={previewDocument.name}
                highlightChunkIndex={previewDocument.chunkIndex}
                onClose={() => setPreviewDocument(null)}
                rightOffset={artifactPreview && panelVisible ? previewWidth + 16 : 0}
              />
            )}
          </main>

          {/* Right column: artifact preview panel with drag separator — LOT A1/A2 (desktop) */}
          {artifactPreview && (
            <div
              className={`flex-shrink-0 hidden lg:flex overflow-hidden transition-[width] duration-300 ease-out ${artifactFullscreen ? "!flex flex-1" : ""}`}
              style={{ width: artifactFullscreen ? undefined : (panelVisible ? previewWidth + 16 : 0) }}
            >
              {/* LOT A2: Wide grab zone (16px) — hidden in fullscreen */}
              <div
                className={`w-4 flex-shrink-0 cursor-col-resize flex items-center justify-center group relative ${artifactFullscreen ? "hidden" : ""}`}
                onMouseDown={handleDragStart}
              >
                <div className="w-0.5 h-full bg-[hsl(var(--border-100))] group-hover:w-1 group-hover:bg-[hsl(var(--accent-000))] group-active:bg-[hsl(var(--accent-100))] transition-all duration-150" />
              </div>
              <div className="flex-1 min-w-0 flex flex-col">
                {/* LOT E1: Multi-artifact tabs */}
                {artifacts.length > 1 && (
                  <div className="flex items-center gap-0.5 px-2 py-1 border-b border-[hsl(var(--border-100))] bg-[hsl(var(--bg-100))] overflow-x-auto flex-shrink-0">
                    {artifacts.map((a, i) => (
                      <button
                        key={`${a.language}-${(a.title || "").slice(0, 20)}-${i}`}
                        onClick={() => setActiveArtifactIdx(i)}
                        className={`px-2.5 py-1 text-[11px] font-medium rounded-md whitespace-nowrap transition-colors cursor-pointer ${
                          i === activeArtifactIdx
                            ? "bg-[hsl(var(--bg-200))] text-[hsl(var(--text-000))]"
                            : "text-[hsl(var(--text-400))] hover:text-[hsl(var(--text-100))] hover:bg-[hsl(var(--bg-100))]"
                        }`}
                      >
                        {a.title || a.language || `#${i + 1}`}
                      </button>
                    ))}
                  </div>
                )}
                <div className="flex-1 min-h-0">
                  <ArtifactPreviewPanel
                    artifact={artifactPreview}
                    onClose={handleArtifactClose}
                    isFullscreen={artifactFullscreen}
                    onToggleFullscreen={handleToggleFullscreen}
                  />
                </div>
              </div>
            </div>
          )}

          {/* LOT 32: Context panel — right side */}
          {contextPanelOpen && !artifactFullscreen && (
            <>
              <div
                className="w-1 flex-shrink-0 cursor-col-resize hover:bg-blue-400/30 active:bg-blue-400/50 transition-colors"
                onMouseDown={handleCtxDragStart}
              />
              <div className="flex-shrink-0 flex overflow-hidden" style={{ width: currentCtxWidth, transition: ctxDraggingRef.current ? "none" : "width 200ms ease-out" }}>
                <ContextPanel chatId={chatId} selectedModel={selectedModel?.model} onClose={() => setContextPanelOpen(false)} />
              </div>
            </>
          )}

          {/* LOT D1: Mobile bottom sheet for artifact preview */}
          {artifactPreview && mobileSheetOpen && (
            <div className="lg:hidden fixed inset-0 z-50">
              {/* Backdrop */}
              <div
                className="absolute inset-0 bg-black/40 transition-opacity"
                onClick={() => setMobileSheetOpen(false)}
              />
              {/* Sheet */}
              <div className="absolute bottom-0 left-0 right-0 h-[75vh] bg-[hsl(var(--bg-000))] rounded-t-2xl shadow-2xl animate-slide-up overflow-hidden">
                {/* Handle bar */}
                <div className="flex justify-center py-2">
                  <div className="w-10 h-1 rounded-full bg-[hsl(var(--border-200))]" />
                </div>
                <ArtifactPreviewPanel
                  artifact={artifactPreview}
                  onClose={() => setMobileSheetOpen(false)}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </FileUpload>
  ) : (
    <div>Chargement...</div>
  );
}

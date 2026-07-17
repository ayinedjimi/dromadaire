import { useChats } from "@/hooks/useChats";
import { useRenameChat } from "@/hooks/useRenameChat";
import { useDeleteChat } from "@/hooks/useDeleteChat";
import { useQueryClient } from "@tanstack/react-query";
import { getChat, pinChat, setChatFolder } from "@/api";
import { Link } from "@/components/ui/link";
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { ChatsResponse } from "@/gotypes";
import { GearSix, Trash, Check, X, Info, BookOpen, Lock, EyeSlash, Star, FolderSimple, MagnifyingGlass, DotsThree, Package } from "@phosphor-icons/react";
import { useSettings } from "@/hooks/useSettings";
import { useFolder } from "@/contexts/FolderContext";
import { exportConversation } from "@/lib/export";

// there's a hidden debug feature to copy a chat's data to the clipboard by
// holding shift and clicking this many times within this many seconds
const DEBUG_SHIFT_CLICKS_REQUIRED = 5;
const DEBUG_SHIFT_CLICK_WINDOW_MS = 7000; // 7 seconds

interface ChatSidebarProps {
  currentChatId?: string;
}

export function ChatSidebar({ currentChatId }: ChatSidebarProps) {
  const { data, isLoading, error } = useChats();
  const queryClient = useQueryClient();
  const { settings } = useSettings();
  const renameMutation = useRenameChat();
  const deleteMutation = useDeleteChat();
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const [shiftClicks, setShiftClicks] = useState<Record<string, number[]>>({});
  const [copiedChatId, setCopiedChatId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Dromadaire: multi-selection state
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);

  const handleMouseEnter = useCallback(
    (chatId: string) => {
      if (selectMode) return; // Don't prefetch in select mode
      queryClient.prefetchQuery({
        queryKey: ["chat", chatId],
        queryFn: () => getChat(chatId),
        staleTime: 1500,
      });
    },
    [queryClient, selectMode],
  );

  const startEditing = useCallback((chatId: string, currentTitle: string) => {
    setEditingChatId(chatId);
    setEditValue(currentTitle);
  }, []);

  const saveRename = useCallback(async () => {
    if (!editingChatId || !editValue.trim()) {
      setEditingChatId(null);
      return;
    }

    const newTitle = editValue.trim();
    const chatId = editingChatId;

    // Exit edit mode immediately to prevent flash
    setEditingChatId(null);
    setEditValue("");

    // Optimistically update the cache
    queryClient.setQueryData(
      ["chats"],
      (oldData: ChatsResponse | undefined) => {
        if (!oldData?.chatInfos) return oldData;
        return {
          ...oldData,
          chatInfos: oldData.chatInfos.map((chat) =>
            chat.id === chatId ? { ...chat, title: newTitle } : chat,
          ),
        };
      },
    );

    try {
      await renameMutation.mutateAsync({
        chatId: chatId,
        title: newTitle,
      });
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (error: unknown) {
      // Revert optimistic update on error
      queryClient.invalidateQueries({ queryKey: ["chats"] });
    }
  }, [editingChatId, editValue, renameMutation, queryClient]);

  useEffect(() => {
    if (editingChatId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingChatId]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        inputRef.current &&
        !inputRef.current.contains(event.target as Node)
      ) {
        saveRename();
      }
    };

    if (editingChatId) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
      };
    }
  }, [editingChatId, editValue, saveRename]);

  const sortedChats = useMemo(() => {
    if (!data?.chatInfos) return [];
    return [...data.chatInfos].sort((a, b) => {
      const comparison = b.updatedAt.getTime() - a.updatedAt.getTime();
      if (comparison === 0) {
        return b.id.localeCompare(a.id);
      }
      return comparison;
    });
  }, [data?.chatInfos]);

  const isToday = (date: Date) => {
    const today = new Date();
    return (
      date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear()
    );
  };

  const isThisWeek = (date: Date) => {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return date > weekAgo && !isToday(date);
  };

  // LOT O: Get unique folder names from chats
  const allFolders = useMemo(() => {
    const folders = new Set<string>();
    sortedChats.forEach((chat) => {
      if (chat.folder) folders.add(chat.folder);
    });
    return Array.from(folders).sort();
  }, [sortedChats]);

  const { activeFolder: folderFilter, setActiveFolder: setFolderFilter } = useFolder();

  // LOT O: Filter chats by folder and search query
  const filteredChats = useMemo(() => {
    let chats = sortedChats;
    if (folderFilter) {
      chats = chats.filter((chat) => chat.folder === folderFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      chats = chats.filter((chat) => {
        const title = (chat.title || chat.userExcerpt || "").toLowerCase();
        return title.includes(q);
      });
    }
    return chats;
  }, [sortedChats, folderFilter, searchQuery]);

  // Group chats by time period, with pinned chats separated
  const groupedChats = useMemo(() => {
    const groups = {
      pinned: [] as typeof filteredChats,
      today: [] as typeof filteredChats,
      thisWeek: [] as typeof filteredChats,
      older: [] as typeof filteredChats,
    };

    filteredChats.forEach((chat) => {
      if (chat.pinned) {
        groups.pinned.push(chat);
      } else if (isToday(chat.updatedAt)) {
        groups.today.push(chat);
      } else if (isThisWeek(chat.updatedAt)) {
        groups.thisWeek.push(chat);
      } else {
        groups.older.push(chat);
      }
    });

    return groups;
  }, [filteredChats]);

  const chatGroups = useMemo(() => {
    return [
      { name: "Favoris", chats: groupedChats.pinned, icon: "star" as const },
      { name: "Aujourd'hui", chats: groupedChats.today, icon: null },
      { name: "Cette semaine", chats: groupedChats.thisWeek, icon: null },
      { name: "Plus ancien", chats: groupedChats.older, icon: null },
    ].filter((group) => group.chats.length > 0);
  }, [groupedChats]);

  const handleDeleteChat = useCallback(
    async (chatId: string) => {
      const confirmed = window.confirm(
        `Voulez-vous vraiment supprimer cette conversation ?`,
      );

      if (!confirmed) return;

      try {
        await deleteMutation.mutateAsync(chatId);
      } catch (error) {
        console.error("Failed to delete chat:", error);
      }
    },
    [deleteMutation],
  );

  // LOT O: Toggle pin on a chat
  const handleTogglePin = useCallback(
    async (chatId: string, currentlyPinned: boolean) => {
      // Optimistic update
      queryClient.setQueryData(
        ["chats"],
        (oldData: ChatsResponse | undefined) => {
          if (!oldData?.chatInfos) return oldData;
          return {
            ...oldData,
            chatInfos: oldData.chatInfos.map((chat) =>
              chat.id === chatId ? { ...chat, pinned: !currentlyPinned } : chat,
            ),
          };
        },
      );
      try {
        await pinChat(chatId, !currentlyPinned);
      } catch {
        queryClient.invalidateQueries({ queryKey: ["chats"] });
      }
    },
    [queryClient],
  );

  // LOT O: Move chat to folder
  const handleSetFolder = useCallback(
    async (chatId: string, folder: string) => {
      queryClient.setQueryData(
        ["chats"],
        (oldData: ChatsResponse | undefined) => {
          if (!oldData?.chatInfos) return oldData;
          return {
            ...oldData,
            chatInfos: oldData.chatInfos.map((chat) =>
              chat.id === chatId ? { ...chat, folder } : chat,
            ),
          };
        },
      );
      try {
        await setChatFolder(chatId, folder);
      } catch {
        queryClient.invalidateQueries({ queryKey: ["chats"] });
      }
    },
    [queryClient],
  );

  // LOT 27 + LOT 38: Export chat in multiple formats
  const handleExportChat = useCallback(async (chatId: string, format: "markdown" | "json" | "text" | "html" = "markdown") => {
    try {
      const chatData = await getChat(chatId);
      if (chatData?.chat) {
        exportConversation(
          {
            title: chatData.chat.title || "Conversation",
            created_at: chatData.chat.created_at,
            messages: chatData.chat.messages || [],
          },
          format,
        );
      }
    } catch (error) {
      console.error("Failed to export chat:", error);
    }
  }, []);

  // Dromadaire: multi-selection handlers
  const toggleSelect = useCallback((chatId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(chatId)) {
        next.delete(chatId);
      } else {
        next.add(chatId);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(sortedChats.map((c) => c.id)));
  }, [sortedChats]);

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedIds(new Set());
  }, []);

  // Dromadaire: auto-exit select mode when selection becomes empty
  useEffect(() => {
    if (selectMode && selectedIds.size === 0) {
      setSelectMode(false);
    }
  }, [selectMode, selectedIds.size]);

  const handleDeleteSelected = useCallback(async () => {
    if (selectedIds.size === 0) return;

    const count = selectedIds.size;
    const confirmed = window.confirm(
      `Supprimer ${count} conversation${count > 1 ? "s" : ""} ?`,
    );
    if (!confirmed) return;

    setIsDeleting(true);
    const failedIds = new Set<string>();
    try {
      for (const chatId of selectedIds) {
        try {
          await deleteMutation.mutateAsync(chatId);
        } catch {
          failedIds.add(chatId);
        }
      }
      if (failedIds.size > 0) {
        queryClient.invalidateQueries({ queryKey: ["chats"] });
        setSelectedIds(failedIds);
        setSelectMode(true);
      } else {
        setSelectedIds(new Set());
        setSelectMode(false);
      }
    } catch (error) {
      console.error("Failed to delete some chats:", error);
      queryClient.invalidateQueries({ queryKey: ["chats"] });
      setSelectedIds(new Set());
      setSelectMode(false);
    } finally {
      setIsDeleting(false);
    }
  }, [selectedIds, deleteMutation, queryClient]);

  // implementation of the hidden debug feature to copy a chat's data to the clipboard
  const handleShiftClick = useCallback(
    async (e: React.MouseEvent, chatId: string) => {
      if (!e.shiftKey) return false;

      e.preventDefault();
      const now = Date.now();

      const clicks = shiftClicks[chatId] || [];
      const recentClicks = clicks.filter(
        (timestamp) => now - timestamp < DEBUG_SHIFT_CLICK_WINDOW_MS,
      );
      recentClicks.push(now);

      setShiftClicks((prev) => ({
        ...prev,
        [chatId]: recentClicks,
      }));

      if (recentClicks.length >= DEBUG_SHIFT_CLICKS_REQUIRED) {
        try {
          const chatData = await getChat(chatId);
          const jsonString = JSON.stringify(chatData, null, 2);
          await navigator.clipboard.writeText(jsonString);

          // visual feedback
          setCopiedChatId(chatId);
          setTimeout(() => setCopiedChatId(null), 2000);

          setShiftClicks((prev) => ({
            ...prev,
            [chatId]: [],
          }));
        } catch (error) {
          console.error("Failed to copy chat data:", error);
        }
      }

      return true;
    },
    [shiftClicks],
  );

  const handleContextMenu = useCallback(
    async (_: React.MouseEvent, chatId: string, chatTitle: string) => {
      if (selectMode) return; // Disable context menu in select mode
      const chatInfo = sortedChats.find((c) => c.id === chatId);
      const isPinned = chatInfo?.pinned ?? false;
      const chatFolder = chatInfo?.folder ?? "";

      const menuItems: { label: string; enabled: boolean }[] = [
        { label: isPinned ? "Retirer des favoris" : "Ajouter aux favoris", enabled: true },
        { label: "Renommer", enabled: true },
        { label: "Exporter (.md)", enabled: true },
        { label: "Exporter (.html)", enabled: true },
      ];

      // Folder submenu items
      if (allFolders.length > 0 || chatFolder) {
        menuItems.push({ label: "---", enabled: false }); // separator
        if (chatFolder) {
          menuItems.push({ label: `Retirer du dossier « ${chatFolder} »`, enabled: true });
        }
        for (const f of allFolders) {
          if (f !== chatFolder) {
            menuItems.push({ label: `Déplacer vers « ${f} »`, enabled: true });
          }
        }
      }
      menuItems.push({ label: "Nouveau dossier...", enabled: true });
      menuItems.push({ label: "---", enabled: false }); // separator
      menuItems.push({ label: "Supprimer", enabled: true });

      const selectedAction = await window.menu(menuItems);

      if (selectedAction === "Ajouter aux favoris" || selectedAction === "Retirer des favoris") {
        handleTogglePin(chatId, isPinned);
      } else if (selectedAction === "Renommer") {
        startEditing(chatId, chatTitle);
      } else if (selectedAction === "Exporter (.md)") {
        handleExportChat(chatId, "markdown");
      } else if (selectedAction === "Exporter (.html)") {
        handleExportChat(chatId, "html");
      } else if (selectedAction === "Supprimer") {
        handleDeleteChat(chatId);
      } else if (selectedAction?.startsWith("Retirer du dossier")) {
        handleSetFolder(chatId, "");
      } else if (selectedAction?.startsWith("Déplacer vers")) {
        const folder = selectedAction.match(/« (.+) »/)?.[1];
        if (folder) handleSetFolder(chatId, folder);
      } else if (selectedAction === "Nouveau dossier...") {
        const name = window.prompt("Nom du dossier :");
        if (name?.trim()) handleSetFolder(chatId, name.trim());
      }
    },
    [startEditing, handleDeleteChat, handleTogglePin, handleSetFolder, selectMode, sortedChats, allFolders],
  );

  if (isLoading) {
    return (
      <nav className="flex min-h-0 flex-col">
        <div className="flex flex-1 flex-col p-4">
          <div className="p-4">Chargement...</div>
        </div>
      </nav>
    );
  }

  if (error) {
    return (
      <nav className="flex min-h-0 flex-col">
        <div className="flex flex-1 flex-col p-4">
          <div className="p-4 text-red-500">Erreur de chargement</div>
        </div>
      </nav>
    );
  }

  const isWindows = navigator.platform.toLowerCase().includes("win");

  return (
    <nav className="flex flex-1 flex-col min-h-0 select-none" data-testid="chat-sidebar">
      <header className="flex flex-col gap-1 px-3 pb-2">
        {!selectMode ? (
          <>
            {/* LM Studio-style header: title + action icons */}
            <div className="flex items-center justify-between px-1 pt-0.5">
              <span className="text-xs font-semibold tracking-wide text-neutral-500 dark:text-neutral-400 uppercase">Chats</span>
              <div className="flex items-center gap-0.5">
                {sortedChats.length > 0 && (
                  <button
                    onClick={() => setSelectMode(true)}
                    className="sidebar-icon-btn"
                    title="Sélectionner" aria-label="Mode sélection multiple"
                  >
                    <Check size={14} />
                  </button>
                )}
                <Link
                  href="/c/new"
                  mask={{ to: "/" }}
                  data-testid="new-chat-button"
                  className="sidebar-icon-btn"
                  draggable={false}
                  title="Nouveau chat"
                >
                  <svg className="h-3.5 w-3.5 fill-current" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path d="M17.0859 3.39949L15.2135 5.27196H7.27028C5.78649 5.27196 4.94684 6.11336 4.94684 7.59716V16.664C4.94684 18.1558 5.78649 18.9892 7.27028 18.9892H16.3406C17.8324 18.9892 18.6623 18.1558 18.6623 16.664V8.79514L20.5428 6.9115C20.567 7.11532 20.5773 7.33066 20.5773 7.55419V16.7149C20.5773 19.4069 19.0818 20.9024 16.3898 20.9024H7.22107C4.53708 20.9024 3.03357 19.4069 3.03357 16.7149V7.55419C3.03357 4.8622 4.53708 3.35869 7.22107 3.35869H16.3898C16.6329 3.35869 16.8662 3.37094 17.0859 3.39949Z" />
                    <path d="M9.92714 14.381L11.914 13.5403L20.8312 4.63114L19.3404 3.1581L10.433 12.0655L9.55234 13.9964C9.45664 14.2169 9.70293 14.4714 9.92714 14.381ZM21.5767 3.89364L22.2588 3.19384C22.6347 2.80184 22.6435 2.2663 22.2711 1.90536L22.0148 1.64287C21.6822 1.31377 21.1334 1.36513 20.7689 1.72158L20.0859 2.39833L21.5767 3.89364Z" />
                  </svg>
                </Link>
              </div>
            </div>
            {/* Search bar */}
            <div className="sidebar-search">
              <MagnifyingGlass size={13} className="sidebar-search-icon" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Rechercher..."
                className="sidebar-search-input"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery("")} className="sidebar-search-clear">
                  <X size={12} />
                </button>
              )}
            </div>
            {/* Navigation links */}
            <div className="flex flex-col gap-0.5 mt-0.5">
              {isWindows && (
                <Link
                  href="/knowledge"
                  activeOptions={{ exact: true }}
                  activeProps={{ className: "sidebar-nav-active" }}
                  className="sidebar-nav-link"
                  draggable={false}
                >
                  <BookOpen size={16} />
                  <span className="truncate">Connaissances</span>
                </Link>
              )}
              {isWindows && (
                <Link
                  href="/models"
                  activeOptions={{ exact: true }}
                  activeProps={{ className: "sidebar-nav-active" }}
                  className="sidebar-nav-link"
                  draggable={false}
                >
                  <Package size={16} />
                  <span className="truncate">Modèles</span>
                </Link>
              )}
              {isWindows && (
                <Link
                  href="/settings"
                  activeOptions={{ exact: true }}
                  activeProps={{ className: "sidebar-nav-active" }}
                  className="sidebar-nav-link"
                  draggable={false}
                >
                  <GearSix size={16} />
                  <span className="truncate">Paramètres</span>
                </Link>
              )}
            </div>
          </>
        ) : (
          /* Selection mode toolbar */
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between py-1 px-1">
              <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
                {selectedIds.size} sélectionné{selectedIds.size > 1 ? "s" : ""}
              </span>
              <button
                onClick={exitSelectMode}
                className="sidebar-icon-btn"
                title="Annuler" aria-label="Annuler la sélection"
              >
                <X size={14} />
              </button>
            </div>
            <div className="flex gap-1">
              <button
                onClick={selectAll}
                className="flex-1 flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-neutral-600 dark:text-neutral-300 bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700"
              >
                Tout
              </button>
              <button
                onClick={handleDeleteSelected}
                disabled={selectedIds.size === 0 || isDeleting}
                className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium ${
                  selectedIds.size > 0 && !isDeleting
                    ? "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950 hover:bg-red-100 dark:hover:bg-red-900"
                    : "text-neutral-400 dark:text-neutral-600 bg-neutral-100 dark:bg-neutral-800 cursor-not-allowed"
                }`}
              >
                <Trash size={14} />
                {isDeleting ? "..." : "Supprimer"}
              </button>
            </div>
          </div>
        )}
      </header>
      <div className="flex flex-1 flex-col px-3 py-1 overflow-y-auto overscroll-auto scrollbar-gutter">
        {/* LOT O: Folder filter */}
        {allFolders.length > 0 && (
          <div className="flex items-center gap-1 pt-2 pb-1">
            <button
              onClick={() => setFolderFilter("")}
              className={`text-[11px] rounded-full px-2 py-0.5 transition-colors ${
                !folderFilter
                  ? "bg-neutral-200 dark:bg-neutral-700 text-black dark:text-white font-medium"
                  : "text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              }`}
            >
              Tous
            </button>
            {allFolders.map((f) => (
              <button
                key={f}
                onClick={() => setFolderFilter(folderFilter === f ? "" : f)}
                className={`text-[11px] rounded-full px-2 py-0.5 transition-colors flex items-center gap-1 ${
                  folderFilter === f
                    ? "bg-neutral-200 dark:bg-neutral-700 text-black dark:text-white font-medium"
                    : "text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                }`}
              >
                <FolderSimple size={11} />
                {f}
              </button>
            ))}
          </div>
        )}
        <div className="flex flex-col gap-3 pt-4">
          {chatGroups.map((group) => (
            <div key={group.name} className="flex flex-col gap-0.5">
              <h3 className="text-xs font-medium text-neutral-400 dark:text-neutral-500 px-2 py-1 select-none flex items-center gap-1">
                {group.icon === "star" && <Star size={12} weight="fill" className="text-amber-400" />}
                {group.name}
              </h3>
              {group.chats.map((chat) => (
                <div
                  key={chat.id}
                  className={`allow-context-menu flex items-center relative text-[13px] text-neutral-600 dark:text-neutral-400 rounded-xl hover:bg-[hsl(var(--bg-200)/50%)] hover:text-black dark:hover:text-neutral-200 transition-colors ${
                    !selectMode && chat.id === currentChatId
                      ? "text-black dark:text-white font-medium bg-[hsl(var(--bg-200))]"
                      : ""
                  } ${
                    selectMode && selectedIds.has(chat.id)
                      ? "bg-blue-50 dark:bg-blue-950/30"
                      : ""
                  }`}
                  onMouseEnter={() => handleMouseEnter(chat.id)}
                  onContextMenu={(e) =>
                    handleContextMenu(
                      e,
                      chat.id,
                      chat.title ||
                        chat.userExcerpt ||
                        chat.createdAt.toLocaleString(),
                    )
                  }
                >
                  {selectMode ? (
                    /* Dromadaire: selection mode - checkbox + label (click or Ctrl+Click) */
                    <button
                      className="flex-1 flex items-center gap-2 min-w-0 px-2 py-2 select-none cursor-pointer"
                      onClick={(e) => {
                        e.preventDefault();
                        toggleSelect(chat.id);
                      }}
                    >
                      <div
                        className={`flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                          selectedIds.has(chat.id)
                            ? "bg-blue-500 border-blue-500"
                            : "border-neutral-300 dark:border-neutral-600"
                        }`}
                      >
                        {selectedIds.has(chat.id) && (
                          <Check size={12} className="text-white" weight="bold" />
                        )}
                      </div>
                      <span className="truncate font-sans text-sm">
                        {chat.title ||
                          chat.userExcerpt ||
                          chat.createdAt.toLocaleString()}
                      </span>
                      {settings.encryptionEnabled && (
                        <Lock size={14} weight="fill" className="ml-1.5 flex-shrink-0 text-emerald-500" />
                      )}
                    </button>
                  ) : editingChatId === chat.id ? (
                    <div className="flex-1 flex items-center min-w-0 px-2 py-2 bg-neutral-100 text-black dark:bg-neutral-800 rounded-lg">
                      <span className="truncate font-sans text-sm w-full">
                        <input
                          ref={inputRef}
                          type="text"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              saveRename();
                            } else if (e.key === "Escape") {
                              setEditingChatId(null);
                              setEditValue("");
                            }
                          }}
                          className="bg-transparent border-0 focus:outline-none w-full dark:text-white"
                          style={{
                            font: "inherit",
                            lineHeight: "inherit",
                            padding: 0,
                            margin: 0,
                          }}
                        />
                      </span>
                    </div>
                  ) : (
                    <>
                      <Link
                        to="/c/$chatId"
                        params={{ chatId: chat.id }}
                        className="flex-1 flex items-center min-w-0 px-2 py-1.5 select-none group/chat"
                        onClick={(e) => {
                          if (e.ctrlKey || e.metaKey) {
                            e.preventDefault();
                            e.stopPropagation();
                            if (!selectMode) setSelectMode(true);
                            toggleSelect(chat.id);
                            return;
                          }
                          handleShiftClick(e, chat.id);
                        }}
                        draggable={false}
                      >
                        {chat.pinned && (
                          <Star size={12} weight="fill" className="mr-1 flex-shrink-0 text-amber-400" />
                        )}
                        <span className="truncate font-sans text-[13px]">
                          {chat.title ||
                            chat.userExcerpt ||
                            chat.createdAt.toLocaleString()}
                        </span>
                        {settings.showTokenCount && chat.tokenEstimate > 0 && (
                          <span className="ml-1 flex-shrink-0 text-[9px] font-mono text-neutral-400 dark:text-neutral-500 bg-neutral-100 dark:bg-neutral-800 rounded px-1 py-0.5">
                            {chat.tokenEstimate > 999 ? `${(chat.tokenEstimate / 1000).toFixed(1)}k` : chat.tokenEstimate}
                          </span>
                        )}
                        {chat.folder && !folderFilter && (
                          <span className="ml-1.5 flex-shrink-0 text-[10px] text-neutral-400 dark:text-neutral-500 bg-neutral-100 dark:bg-neutral-800 rounded px-1 py-0.5 flex items-center gap-0.5">
                            <FolderSimple size={10} />
                            {chat.folder}
                          </span>
                        )}
                        {settings.encryptionEnabled && (
                          <Lock size={14} weight="fill" className="ml-1.5 flex-shrink-0 text-emerald-500" />
                        )}
                        {copiedChatId === chat.id && (
                          <span className="ml-2 text-xs text-green-600 dark:text-green-400">
                            Copié !
                          </span>
                        )}
                      </Link>
                      {/* LM Studio-style "..." button on hover */}
                      <button
                        className="sidebar-dots-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleContextMenu(
                            e as unknown as React.MouseEvent,
                            chat.id,
                            chat.title || chat.userExcerpt || chat.createdAt.toLocaleString(),
                          );
                        }}
                        title="Actions"
                      >
                        <DotsThree size={16} weight="bold" />
                      </button>
                    </>
                  )}
                  {/* Micro-anim: accent bar on active chat */}
                  {!selectMode && chat.id === currentChatId && (
                    <div className="sidebar-active-indicator" />
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
      {/* Dromadaire: À propos + Discrétion en bas de la sidebar */}
      {isWindows && (
        <footer className="flex-none px-3 pb-3 pt-1 border-t border-[hsl(var(--border-100))]">
          <Link
            href="/about"
            activeOptions={{ exact: true }}
            activeProps={{ className: "sidebar-nav-active" }}
            className="sidebar-nav-link"
            draggable={false}
          >
            <Info size={16} />
            <span className="truncate">À propos</span>
          </Link>
          <button
            onClick={() => window.dispatchEvent(new Event("discretion"))}
            className="sidebar-nav-link w-full"
            title="Mode discrétion (Ctrl+Shift+H)"
          >
            <EyeSlash size={16} />
            <span className="truncate">Discrétion</span>
          </button>
        </footer>
      )}
    </nav>
  );
}

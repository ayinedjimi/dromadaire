import { Link } from "@tanstack/react-router";
import { useSettings } from "@/hooks/useSettings";
import { useIncognito } from "@/contexts/IncognitoContext";
import { useFolder } from "@/contexts/FolderContext";
import { ModelBar } from "@/components/ModelBar";
import { ProjectTabs } from "@/components/ProjectTabs";
import { useState, useRef, useCallback, useEffect } from "react";
import { activateTamagotchi } from "@/components/TamagotchiCompanion";

// hidden easter egg: click the "Dromadaire" version badge this many times
// within this many seconds to wake up the companion
const EASTER_EGG_CLICKS_REQUIRED = 5;
const EASTER_EGG_CLICK_WINDOW_MS = 3000;

export function SidebarLayout({
  sidebar,
  children,
}: React.PropsWithChildren<{
  sidebar: React.ReactNode;
  collapsible?: boolean;
  chatId?: string;
}>) {
  const { settings, setSettings } = useSettings();
  const { incognito } = useIncognito();
  const { activeFolder, setActiveFolder } = useFolder();
  const isWindows = navigator.platform.toLowerCase().includes("win");

  const sidebarW = settings.sidebarWidth || 280;
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const dragging = useRef(false);
  const logoClickTimes = useRef<number[]>([]);

  const handleLogoClick = useCallback(() => {
    const now = Date.now();
    logoClickTimes.current = [...logoClickTimes.current, now].filter(
      (t) => now - t < EASTER_EGG_CLICK_WINDOW_MS,
    );
    if (logoClickTimes.current.length >= EASTER_EGG_CLICKS_REQUIRED) {
      logoClickTimes.current = [];
      activateTamagotchi();
    }
  }, []);

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    const startX = e.clientX;
    const startW = sidebarW;
    const onMove = (ev: MouseEvent) => {
      const w = Math.max(200, Math.min(480, startW + ev.clientX - startX));
      setDragWidth(w);
    };
    const onUp = (ev: MouseEvent) => {
      dragging.current = false;
      const finalW = Math.max(200, Math.min(480, startW + ev.clientX - startX));
      setDragWidth(null);
      setSettings({ SidebarWidth: finalW });
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [sidebarW, setSettings]);

  const currentSidebarWidth = dragWidth ?? sidebarW;

  return (
    <div className={`flex h-screen overflow-hidden bg-white dark:bg-neutral-900 app-frame`}>
      <div
        className="absolute flex mx-2 py-2 z-20 items-center transition-[left] duration-375 text-neutral-500 dark:text-neutral-400"
        style={{ left: settings.sidebarOpen ? (isWindows ? 8 : currentSidebarWidth - 44) : (isWindows ? 8 : 80) }}
      >
        <button
          onClick={() => setSettings({ SidebarOpen: !settings.sidebarOpen })}
          onMouseDown={(e) => {
            e.stopPropagation();
          }}
          className="h-9 w-9 flex items-center justify-center rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-700/75 cursor-pointer"
          aria-label={settings.sidebarOpen ? "Masquer le panneau" : "Afficher le panneau"}
          title={settings.sidebarOpen ? "Masquer le panneau" : "Afficher le panneau"}
        >
          <svg
            className="h-5 w-5 fill-current"
            viewBox="0 0 24 19"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path d="M7.76132 16.6344H9.58103V1.59842H7.76132V16.6344ZM4.20898 18.2316H19.124C21.6518 18.2316 23.1293 16.6963 23.1293 14.0209V4.2205C23.1293 1.54512 21.6518 0.00351715 19.124 0.00351715H4.20898C1.54336 0.00351715 0 1.54512 0 4.2205V14.0209C0 16.6963 1.54336 18.2316 4.20898 18.2316ZM4.31191 16.3184C2.79628 16.3184 1.91327 15.4434 1.91327 13.926V4.31542C1.91327 2.79979 2.79628 1.91678 4.31191 1.91678H18.8174C20.333 1.91678 21.216 2.79979 21.216 4.31542V13.926C21.216 15.4434 20.333 16.3184 18.8174 16.3184H4.31191ZM5.85116 5.50038C6.1951 5.50038 6.49217 5.20507 6.49217 4.87968C6.49217 4.54628 6.1951 4.25722 5.85116 4.25722H3.8412C3.49725 4.25722 3.20819 4.54628 3.20819 4.87968C3.20819 5.20507 3.49725 5.50038 3.8412 5.50038H5.85116ZM5.85116 8.1158C6.1951 8.1158 6.49217 7.82049 6.49217 7.4871C6.49217 7.1537 6.1951 6.8744 5.85116 6.8744H3.8412C3.49725 6.8744 3.20819 7.1537 3.20819 7.4871C3.20819 7.82049 3.49725 8.1158 3.8412 8.1158H5.85116ZM5.85116 10.725C6.1951 10.725 6.49217 10.4439 6.49217 10.1105C6.49217 9.77713 6.1951 9.48983 5.85116 9.48983H3.8412C3.49725 9.48983 3.20819 9.77713 3.20819 10.1105C3.20819 10.4439 3.49725 10.725 3.8412 10.725H5.85116Z" />
          </svg>
        </button>
        <Link
          to="/c/$chatId"
          params={{ chatId: "new" }}
          title="Nouveau chat"
          className={`flex ml-1 items-center justify-center rounded-full transition-opacity duration-375 h-9 w-9 hover:bg-neutral-100 dark:hover:bg-neutral-700 ${
            settings.sidebarOpen
              ? "opacity-0 pointer-events-none"
              : "opacity-100"
          }`}
        >
          <svg
            className="h-5 w-5 fill-current"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path d="M17.0859 3.39949L15.2135 5.27196H7.27028C5.78649 5.27196 4.94684 6.11336 4.94684 7.59716V16.664C4.94684 18.1558 5.78649 18.9892 7.27028 18.9892H16.3406C17.8324 18.9892 18.6623 18.1558 18.6623 16.664V8.79514L20.5428 6.9115C20.567 7.11532 20.5773 7.33066 20.5773 7.55419V16.7149C20.5773 19.4069 19.0818 20.9024 16.3898 20.9024H7.22107C4.53708 20.9024 3.03357 19.4069 3.03357 16.7149V7.55419C3.03357 4.8622 4.53708 3.35869 7.22107 3.35869H16.3898C16.6329 3.35869 16.8662 3.37094 17.0859 3.39949Z" />
            <path d="M9.92714 14.381L11.914 13.5403L20.8312 4.63114L19.3404 3.1581L10.433 12.0655L9.55234 13.9964C9.45664 14.2169 9.70293 14.4714 9.92714 14.381ZM21.5767 3.89364L22.2588 3.19384C22.6347 2.80184 22.6435 2.2663 22.2711 1.90536L22.0148 1.64287C21.6822 1.31377 21.1334 1.36513 20.7689 1.72158L20.0859 2.39833L21.5767 3.89364Z" />
          </svg>
        </Link>
      </div>
      <div
        className={`flex flex-col max-h-screen bg-neutral-50 dark:bg-neutral-950 flex-shrink-0 ${settings.sidebarOpen ? "border-r border-neutral-200 dark:border-neutral-800" : ""}`}
        style={{ width: settings.sidebarOpen ? currentSidebarWidth : 0, transition: dragging.current ? "none" : "width 300ms" }}
      >
        <div
          onDoubleClick={() => window.doubleClick && window.doubleClick()}
          onMouseDown={() => window.drag && window.drag()}
          className="flex-none h-13 w-full"
        ></div>
        {settings.sidebarOpen && sidebar}
      </div>
      {settings.sidebarOpen && (
        <div
          className="w-1 flex-shrink-0 cursor-col-resize hover:bg-blue-400/30 active:bg-blue-400/50 transition-colors z-10"
          onMouseDown={onResizeStart}
          style={{ marginLeft: -2 }}
        />
      )}
      <main
        className={`flex flex-1 flex-col min-w-0 min-h-0 transition-all duration-300`}
      >
        <div
          className={`h-13 flex-none w-full z-10 flex items-center justify-between bg-white dark:bg-neutral-900 ${isWindows ? "" : "xl:fixed xl:bg-transparent xl:dark:bg-transparent"}`}
          onDoubleClick={() => window.doubleClick && window.doubleClick()}
          onMouseDown={() => window.drag && window.drag()}
        >
          <ModelBar />
          <div className="flex items-center gap-2 pr-3 select-none">
            {incognito && (
              <span className="text-[11px] font-medium text-violet-500 dark:text-violet-400 bg-violet-50 dark:bg-violet-950/40 rounded-full px-2 py-0.5">
                Incognito
              </span>
            )}
            <button
              onClick={() => window.dispatchEvent(new Event("toggle-context-panel"))}
              onMouseDown={(e) => e.stopPropagation()}
              className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-700/75 text-neutral-400 dark:text-neutral-500 cursor-pointer transition-colors"
              title="Panneau contexte"
              aria-label="Panneau contexte"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" />
                <line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" />
                <line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" />
                <line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" />
              </svg>
            </button>
            <div className="flex items-center gap-1.5" onClick={handleLogoClick}>
              <svg className="h-4 w-4 text-teal-600 dark:text-teal-400" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C7.58 2 4 5.58 4 10c0 3.03 1.6 5.68 4 7.13V22h8v-4.87c2.4-1.45 4-4.1 4-7.13 0-4.42-3.58-8-8-8zm-2 18v-1h4v1h-4zm4-3h-4v-1h4v1zm1.5-4.58-.82.52-.18.12V15h-5v-1.94l-.18-.12-.82-.52A5.99 5.99 0 0 1 6 10c0-3.31 2.69-6 6-6s6 2.69 6 6a5.99 5.99 0 0 1-2.5 4.42z"/></svg>
              <span className="text-[13px] font-semibold tracking-tight text-neutral-700 dark:text-neutral-200">Dromadaire</span>
              <span className="text-[10px] font-mono font-medium text-teal-600 dark:text-teal-400 bg-teal-50 dark:bg-teal-950/40 border border-teal-200 dark:border-teal-800/50 rounded px-1.5 py-0.5">v7.9</span>
            </div>
          </div>
        </div>
        <ProjectTabs activeFolder={activeFolder} onFolderChange={setActiveFolder} />
        <div className="flex-1 min-h-0">
          {children}
        </div>
      </main>
    </div>
  );
}

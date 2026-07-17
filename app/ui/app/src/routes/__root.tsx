import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet, useNavigate } from "@tanstack/react-router";
import { getSettings, warmupModel, authStatus } from "@/api";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, useCallback, useMemo, Suspense } from "react";
import PasswordPrompt from "@/components/PasswordPrompt";
import { IncognitoProvider, useIncognito } from "@/contexts/IncognitoContext";
import { FolderProvider } from "@/contexts/FolderContext";
import { useTheme } from "@/hooks/useTheme";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useSettings } from "@/hooks/useSettings";
import { SearchModal } from "@/components/SearchModal";
import { DiscretionOverlay } from "@/components/DiscretionOverlay";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { TamagotchiCompanion } from "@/components/TamagotchiCompanion";

function RootComponent() {
  // This hook ensures settings are fetched on app startup
  const { data: settingsData } = useQuery({
    queryKey: ["settings"],
    queryFn: getSettings,
  });

  // Dromadaire: check auth status at startup
  const { data: auth } = useQuery({
    queryKey: ["auth-status"],
    queryFn: authStatus,
  });

  const [authenticated, setAuthenticated] = useState(false);

  // LOT 19: Apply theme CSS class on <html>
  useTheme();

  // Dromadaire: prefetch model into memory at startup for instant first response
  const warmedUpRef = useRef(false);
  const modelName = settingsData?.settings?.SelectedModel;
  useEffect(() => {
    if (modelName && !warmedUpRef.current && settingsData?.settings) {
      warmedUpRef.current = true;
      const s = settingsData.settings;
      warmupModel(modelName, {
        contextLength: s.ContextLength,
        numThread: s.NumThread,
        numBatch: s.NumBatch,
        useMlock: s.UseMlock,
        kvCacheType: s.KVCacheType,
      });
    }
  }, [modelName, settingsData]);

  // Dromadaire: dynamic window title with model name
  useEffect(() => {
    document.title = modelName
      ? `Dromadaire v7.9 · ${modelName}`
      : "Dromadaire v7.9";
  }, [modelName]);

  // Dromadaire LOT 9A: auto-lock after inactivity
  const lockTimeoutMinutes = settingsData?.settings?.LockTimeoutMinutes ?? 0;
  const lockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetLockTimer = useCallback(() => {
    if (lockTimerRef.current) {
      clearTimeout(lockTimerRef.current);
    }
    if (lockTimeoutMinutes > 0 && auth?.passwordEnabled && authenticated) {
      lockTimerRef.current = setTimeout(() => {
        setAuthenticated(false);
      }, lockTimeoutMinutes * 60 * 1000);
    }
  }, [lockTimeoutMinutes, auth?.passwordEnabled, authenticated]);

  useEffect(() => {
    if (lockTimeoutMinutes <= 0 || !auth?.passwordEnabled || !authenticated) {
      return;
    }

    resetLockTimer();

    const events = ["mousemove", "keydown", "click", "scroll", "touchstart"];
    const handler = () => resetLockTimer();

    events.forEach((e) =>
      window.addEventListener(e, handler, { passive: true }),
    );

    return () => {
      if (lockTimerRef.current) clearTimeout(lockTimerRef.current);
      events.forEach((e) => window.removeEventListener(e, handler));
    };
  }, [lockTimeoutMinutes, auth?.passwordEnabled, authenticated, resetLockTimer]);

  // Show password prompt if password protection is enabled and not yet authenticated
  if (auth?.passwordEnabled && !authenticated) {
    return <PasswordPrompt onSuccess={() => setAuthenticated(true)} />;
  }

  return (
    <IncognitoProvider>
      <FolderProvider>
        <AppShell settings={settingsData?.settings} />
      </FolderProvider>
    </IncognitoProvider>
  );
}

/** Inner component — lives inside IncognitoProvider so it can toggle incognito */
function AppShell({ settings }: { settings?: { KeyboardShortcutsEnabled?: boolean; SearchEnabled?: boolean; SidebarOpen?: boolean } }) {
  const navigate = useNavigate();
  const { toggleIncognito } = useIncognito();
  const { setSettings } = useSettings();
  const [searchOpen, setSearchOpen] = useState(false);
  const [discretionActive, setDiscretionActive] = useState(false);

  const handlers = useMemo(
    () => ({
      search: () => {
        if (settings?.SearchEnabled !== false) setSearchOpen(true);
      },
      newChat: () => navigate({ to: "/" }),
      toggleIncognito,
      openSettings: () => navigate({ to: "/settings" }),
      toggleSidebar: () => setSettings({ SidebarOpen: !(settings?.SidebarOpen ?? false) }),
      closeModal: () => setSearchOpen(false),
      toggleDiscretion: () => setDiscretionActive((v) => !v),
    }),
    [navigate, toggleIncognito, settings?.SearchEnabled, settings?.SidebarOpen, setSettings],
  );

  useKeyboardShortcuts(settings?.KeyboardShortcutsEnabled !== false, handlers);

  // Listen for "discretion" custom event from sidebar button
  useEffect(() => {
    const handler = () => setDiscretionActive((v) => !v);
    window.addEventListener("discretion", handler);
    return () => window.removeEventListener("discretion", handler);
  }, []);

  return (
    <div>
      <AppErrorBoundary>
        <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-neutral-500">Chargement…</div>}>
          <Outlet />
        </Suspense>
      </AppErrorBoundary>
      {searchOpen && <SearchModal onClose={() => setSearchOpen(false)} />}
      <DiscretionOverlay active={discretionActive} onDeactivate={() => setDiscretionActive(false)} />
      <TamagotchiCompanion />
    </div>
  );
}

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient;
}>()({
  component: RootComponent,
});

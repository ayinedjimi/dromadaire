import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Settings } from "@/gotypes";
import { getSettings, updateSettings } from "@/api";
import { useMemo, useCallback } from "react";

// TODO(hoyyeva): remove turboEnabled when we remove Migration logic in useSelectedModel.ts
interface SettingsState {
  turboEnabled: boolean;
  webSearchEnabled: boolean;
  selectedModel: string;
  sidebarOpen: boolean;
  airplaneMode: boolean;
  thinkEnabled: boolean;
  thinkLevel: string;
  encryptionEnabled: boolean;
  ragEnabled: boolean;
  embeddingModel: string;
  lockTimeoutMinutes: number;
  autoDeleteDays: number;
  clipboardClearSeconds: number;
  responseMode: string;
  systemPrompt: string;
  humanSubMode: string;
  writingStyleRules: string;
  styleAnalysisModel: string;
  ragAffinityThreshold: number;
  ragRetrievalLimit: number;
  chatFullWidth: boolean;
  autoTitleEnabled: boolean;
  showTokenCount: boolean;
  contextOverflowPolicy: string;
  sidebarWidth: number;
  contextPanelWidth: number;
  contextLength: number;
}

// Type for partial settings updates
type SettingsUpdate = Partial<{
  TurboEnabled: boolean;
  WebSearchEnabled: boolean;
  Agent: boolean;
  ThinkEnabled: boolean;
  ThinkLevel: string;
  SelectedModel: string;
  SidebarOpen: boolean;
  EncryptionEnabled: boolean;
  RAGEnabled: boolean;
  EmbeddingModel: string;
  AirplaneMode: boolean;
  LockTimeoutMinutes: number;
  AutoDeleteDays: number;
  ClipboardClearSeconds: number;
  ResponseMode: string;
  SystemPrompt: string;
  HumanSubMode: string;
  WritingStyleRules: string;
  StyleAnalysisModel: string;
  RAGAffinityThreshold: number;
  RAGRetrievalLimit: number;
  ChatFullWidth: boolean;
  AutoTitleEnabled: boolean;
  ShowTokenCount: boolean;
  ContextOverflowPolicy: string;
  SidebarWidth: number;
  ContextPanelWidth: number;
}>;

export function useSettings() {
  const queryClient = useQueryClient();

  // Fetch settings with useQuery
  // staleTime prevents re-fetching on every component mount/re-render
  // Settings rarely change — only when the user explicitly modifies them
  const { data: settingsData, error } = useQuery({
    queryKey: ["settings"],
    queryFn: getSettings,
    staleTime: 30_000, // 30s — data considered fresh, no refetch
    refetchOnWindowFocus: false,
  });

  // Update settings with useMutation
  const updateSettingsMutation = useMutation({
    mutationFn: updateSettings,
    onSuccess: () => {
      // Invalidate the query to ensure fresh data
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
  });

  // Extract settings with defaults
  const settings: SettingsState = useMemo(
    () => ({
      turboEnabled: settingsData?.settings?.TurboEnabled ?? false,
      webSearchEnabled: settingsData?.settings?.WebSearchEnabled ?? false,
      thinkEnabled: settingsData?.settings?.ThinkEnabled ?? false,
      thinkLevel: settingsData?.settings?.ThinkLevel ?? "none",
      selectedModel: settingsData?.settings?.SelectedModel ?? "",
      sidebarOpen: settingsData?.settings?.SidebarOpen ?? false,
      airplaneMode: settingsData?.settings?.AirplaneMode ?? false,
      encryptionEnabled: settingsData?.settings?.EncryptionEnabled ?? false,
      ragEnabled: settingsData?.settings?.RAGEnabled ?? false,
      embeddingModel: settingsData?.settings?.EmbeddingModel ?? "",
      lockTimeoutMinutes: settingsData?.settings?.LockTimeoutMinutes ?? 0,
      autoDeleteDays: settingsData?.settings?.AutoDeleteDays ?? 0,
      clipboardClearSeconds: settingsData?.settings?.ClipboardClearSeconds ?? 0,
      responseMode: settingsData?.settings?.ResponseMode ?? "",
      systemPrompt: settingsData?.settings?.SystemPrompt ?? "",
      humanSubMode: settingsData?.settings?.HumanSubMode ?? "",
      writingStyleRules: settingsData?.settings?.WritingStyleRules ?? "",
      styleAnalysisModel: settingsData?.settings?.StyleAnalysisModel ?? "gemma3:4b",
      ragAffinityThreshold: settingsData?.settings?.RAGAffinityThreshold ?? 0.3,
      ragRetrievalLimit: settingsData?.settings?.RAGRetrievalLimit ?? 5,
      chatFullWidth: settingsData?.settings?.ChatFullWidth ?? false,
      autoTitleEnabled: settingsData?.settings?.AutoTitleEnabled ?? true,
      showTokenCount: settingsData?.settings?.ShowTokenCount ?? false,
      contextOverflowPolicy: settingsData?.settings?.ContextOverflowPolicy ?? "truncate_old",
      sidebarWidth: settingsData?.settings?.SidebarWidth ?? 280,
      contextPanelWidth: settingsData?.settings?.ContextPanelWidth ?? 320,
      contextLength: settingsData?.settings?.ContextLength ?? 4096,
    }),
    [settingsData?.settings],
  );

  // Single function to update most settings
  const setSettings = useCallback(
    async (updates: SettingsUpdate) => {
      if (!settingsData?.settings) return;

      const updatedSettings = new Settings({
        ...settingsData.settings,
        ...updates,
      });

      await updateSettingsMutation.mutateAsync(updatedSettings);
    },
    [settingsData?.settings, updateSettingsMutation],
  );

  return useMemo(
    () => ({
      settings,
      settingsData: settingsData?.settings,
      error,
      setSettings,
    }),
    [settings, settingsData?.settings, error, setSettings],
  );
}

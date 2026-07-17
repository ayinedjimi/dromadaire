import { useEffect, useState, useCallback, useRef } from "react";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Field, Label, Description } from "@/components/ui/fieldset";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  Folder,
  Lightning,
  Wrench,
  X,
  GearSix,
  ArrowLeft,
  Sun,
  Moon,
  Lock,
  ShieldCheck,
  ClipboardText,
  DownloadSimple,
  Clock,
  MagnifyingGlass,
  ChatCircleDots,
  FileText,
  Terminal,
  Cpu,
  Warning,
} from "@phosphor-icons/react";
import { Settings as SettingsType } from "@/gotypes";
import { useNavigate } from "@tanstack/react-router";
import { useUser } from "@/hooks/useUser";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getSettings, updateSettings, getEncryptionKey, authStatus, setAppPassword, removeAppPassword, getHardwareInfo, runAutoconfig, restartServer, analyzeWritingStyle } from "@/api";
import type { HardwareInfo } from "@/api";

export default function Settings() {
  const queryClient = useQueryClient();
  const [showSaved, setShowSaved] = useState(false);
  const [restartMessage, _setRestartMessage] = useState(false);
  // Dromadaire: encryption key backup state
  const [encKeyBackup, setEncKeyBackup] = useState<{
    key: string;
    path: string;
  } | null>(null);
  const [keyCopied, setKeyCopied] = useState(false);

  // Dromadaire: password protection state
  const [pwdNew, setPwdNew] = useState("");
  const [pwdConfirm, setPwdConfirm] = useState("");
  const [pwdCurrent, setPwdCurrent] = useState("");
  const [pwdError, setPwdError] = useState<string | null>(null);
  const [pwdSaving, setPwdSaving] = useState(false);
  const pwdInputRef = useRef<HTMLInputElement>(null);
  // LOT 22: Performance settings state
  const [hardwareInfo, setHardwareInfo] = useState<HardwareInfo | null>(null);
  const [needsRestart, setNeedsRestart] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const [isAutoconfiguring, setIsAutoconfiguring] = useState(false);
  const {
    refetchUser,
  } = useUser();
  const navigate = useNavigate();

  const {
    data: settingsData,
    isLoading: loading,
    error,
  } = useQuery({
    queryKey: ["settings"],
    queryFn: getSettings,
  });

  const settings = settingsData?.settings || null;

  const { data: authData, refetch: refetchAuth } = useQuery({
    queryKey: ["auth-status"],
    queryFn: authStatus,
  });

  const updateSettingsMutation = useMutation({
    mutationFn: updateSettings,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      setShowSaved(true);
      setTimeout(() => setShowSaved(false), 1500);
    },
  });

  useEffect(() => {
    refetchUser();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // LOT 22: Fetch hardware info on mount
  useEffect(() => {
    getHardwareInfo().then(setHardwareInfo).catch(() => {});
  }, []);

  const handleChange = useCallback(
    (field: keyof SettingsType, value: boolean | string | number) => {
      if (settings) {
        const updatedSettings = new SettingsType({
          ...settings,
          [field]: value,
        });

        updateSettingsMutation.mutate(updatedSettings, {
          onSuccess: () => {
            // Dromadaire: show key backup panel when encryption is just enabled
            if (field === "EncryptionEnabled" && value === true) {
              getEncryptionKey()
                .then((data) => setEncKeyBackup(data))
                .catch((err) =>
                  console.error("Failed to fetch encryption key:", err),
                );
            }
            if (field === "EncryptionEnabled" && value === false) {
              setEncKeyBackup(null);
            }
          },
        });
      }
    },
    [settings, updateSettingsMutation],
  );

  // LOT 22: Performance change wrapper (sets needsRestart)
  const handlePerfChange = useCallback(
    (field: keyof SettingsType, value: boolean | string | number) => {
      handleChange(field, value);
      setNeedsRestart(true);
    },
    [handleChange],
  );

  // LOT 22: Autoconfig handler
  const handleAutoconfig = useCallback(async () => {
    setIsAutoconfiguring(true);
    try {
      const result = await runAutoconfig();
      setHardwareInfo(result.hardware);
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      setNeedsRestart(true);
      setShowSaved(true);
      setTimeout(() => setShowSaved(false), 1500);
    } catch (err) {
      console.error("Autoconfig failed:", err);
    } finally {
      setIsAutoconfiguring(false);
    }
  }, [queryClient]);

  // LOT 22: Restart handler
  const handleRestart = useCallback(async () => {
    setIsRestarting(true);
    try {
      await restartServer();
      setNeedsRestart(false);
      // Wait a bit for the server to restart
      setTimeout(() => setIsRestarting(false), 3000);
    } catch (err) {
      console.error("Restart failed:", err);
      setIsRestarting(false);
    }
  }, []);

  const handleResetToDefaults = () => {
    if (settings) {
      const defaultSettings = new SettingsType({
        Expose: false,
        Browser: false,
        Models: "",
        Agent: false,
        Tools: false,
        ContextLength: 4096,
        EncryptionEnabled: false,
      });
      updateSettingsMutation.mutate(defaultSettings);
    }
  };

  if (loading) {
    return null;
  }

  if (error || !settings) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-red-500">Impossible de charger les paramètres</div>
      </div>
    );
  }

  const isWindows = navigator.platform.toLowerCase().includes("win");

  return (
    <main className="flex h-screen w-full flex-col select-none dark:bg-neutral-900" data-testid="settings-page">
      <header
        className="w-full flex flex-none justify-between h-[52px] py-2.5 items-center border-b border-neutral-200 dark:border-neutral-800 select-none"
        onMouseDown={() => window.drag && window.drag()}
        onDoubleClick={() => window.doubleClick && window.doubleClick()}
      >
        <h1
          className={`${isWindows ? "pl-4" : "pl-24"} flex items-center font-rounded text-md font-medium dark:text-white`}
        >
          {isWindows && (
            <button
              onClick={() => navigate({ to: "/" })}
              className="hover:bg-neutral-100 mr-3 dark:hover:bg-neutral-800 rounded-full p-1.5"
            >
              <ArrowLeft size={20} weight="fill" className="dark:text-white" />
            </button>
          )}
          Paramètres
        </h1>
        {!isWindows && (
          <button
            onClick={() => navigate({ to: "/" })}
            className="p-1 hover:bg-neutral-100 mr-3 dark:hover:bg-neutral-800 rounded-full"
          >
            <X size={24} weight="fill" className="dark:text-white" />
          </button>
        )}
      </header>
      <div className="w-full p-6 overflow-y-auto flex-1 overscroll-contain">
        <div className="space-y-4 max-w-2xl mx-auto">
          {/* LOT 20: Portable mode info banner */}
          {settings?.PortableMode && (
            <div className="rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 p-4 flex items-start gap-3">
              <Folder size={20} weight="fill" className="text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-blue-900 dark:text-blue-200">
                  Mode portable actif
                </p>
                <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                  Toutes les données sont stockées sur le périphérique USB, à côté de l'exécutable. Aucune trace n'est laissée sur l'ordinateur hôte.
                </p>
              </div>
            </div>
          )}
          {/* Local Configuration */}
          <div className="relative overflow-hidden rounded-xl bg-white dark:bg-neutral-800">
            <div className="space-y-4 p-4">

              {/* Model Directory */}
              <Field>
                <div className="flex items-start space-x-3">
                  <Folder size={20} weight="fill" className="mt-1 flex-shrink-0 text-black dark:text-neutral-100" />
                  <div className="w-full">
                    <Label>Emplacement des modèles</Label>
                    <Description>Dossier de stockage des modèles.</Description>
                    <div className="mt-2 flex items-center space-x-2">
                      <Input
                        value={settings.Models || ""}
                        onChange={(e) => handleChange("Models", e.target.value)}
                        readOnly
                      />
                      <Button
                        type="button"
                        color="white"
                        className="px-2"
                        onClick={async () => {
                          if (window.webview?.selectModelsDirectory) {
                            try {
                              const directory =
                                await window.webview.selectModelsDirectory();
                              if (directory) {
                                handleChange("Models", directory);
                              }
                            } catch (error) {
                              console.error(
                                "Error selecting models directory:",
                                error,
                              );
                            }
                          }
                        }}
                      >
                        <Folder size={16} weight="fill" className="mr-1" />
                        Parcourir
                      </Button>
                    </div>
                  </div>
                </div>
              </Field>

              {/* LOT 19: Theme selector */}
              <Field>
                <div className="flex items-center justify-between">
                  <div className="flex items-start space-x-3">
                    {document.documentElement.classList.contains("dark") ? (
                      <Moon size={20} weight="fill" className="mt-1 flex-shrink-0 text-black dark:text-neutral-100" />
                    ) : (
                      <Sun size={20} weight="fill" className="mt-1 flex-shrink-0 text-black dark:text-neutral-100" />
                    )}
                    <div>
                      <Label>Theme</Label>
                      <Description>
                        Apparence de l'interface.
                      </Description>
                    </div>
                  </div>
                  <select
                    className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
                    value={settings?.Theme || "light"}
                    onChange={(e) => handleChange("Theme", e.target.value)}
                  >
                    <option value="light">Clair</option>
                    <option value="dark">Sombre</option>
                    <option value="oled">OLED Noir</option>
                    <option value="sepia">Sepia</option>
                    <option value="blue-night">Nuit Bleue</option>
                    <option value="nord">Nord</option>
                  </select>
                </div>
              </Field>

              {/* LOT 39: Chat full-width */}
              <Field>
                <div className="flex items-center justify-between">
                  <div className="flex items-start space-x-3">
                    <ChatCircleDots size={20} className="mt-1 flex-shrink-0 text-black dark:text-neutral-100" />
                    <div>
                      <Label>Chat pleine largeur</Label>
                      <Description>
                        Etend les messages sur toute la largeur disponible.
                      </Description>
                    </div>
                  </div>
                  <Switch
                    checked={settings?.ChatFullWidth ?? false}
                    onChange={(val: boolean) => handleChange("ChatFullWidth", val)}
                  />
                </div>
              </Field>

              {/* LOT 39: Auto-titre */}
              <Field>
                <div className="flex items-center justify-between">
                  <div className="flex items-start space-x-3">
                    <FileText size={20} className="mt-1 flex-shrink-0 text-black dark:text-neutral-100" />
                    <div>
                      <Label>Titre automatique</Label>
                      <Description>
                        Genere un titre par le LLM apres le premier echange.
                      </Description>
                    </div>
                  </div>
                  <Switch
                    checked={settings?.AutoTitleEnabled ?? true}
                    onChange={(val: boolean) => handleChange("AutoTitleEnabled", val)}
                  />
                </div>
              </Field>

              {/* LOT 39: Token count in sidebar */}
              <Field>
                <div className="flex items-center justify-between">
                  <div className="flex items-start space-x-3">
                    <Terminal size={20} className="mt-1 flex-shrink-0 text-black dark:text-neutral-100" />
                    <div>
                      <Label>Compteur de tokens</Label>
                      <Description>
                        Affiche le nombre estime de tokens dans la sidebar.
                      </Description>
                    </div>
                  </div>
                  <Switch
                    checked={settings?.ShowTokenCount ?? false}
                    onChange={(val: boolean) => handleChange("ShowTokenCount", val)}
                  />
                </div>
              </Field>
            </div>
          </div>

          {/* LOT 22: Performance Settings */}
          <div className="overflow-hidden rounded-xl bg-white dark:bg-neutral-800">
            <div className="space-y-4 p-4">
              {/* Section header with Autoconfig button */}
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Cpu size={20} weight="fill" className="text-black dark:text-neutral-100" />
                  <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Performance</h3>
                </div>
                <Button
                  type="button"
                  color="white"
                  className="!text-xs"
                  disabled={isAutoconfiguring}
                  onClick={handleAutoconfig}
                >
                  <Lightning size={14} weight="fill" className="mr-1" />
                  {isAutoconfiguring ? "Detection..." : "Autoconfig"}
                </Button>
              </div>

              {/* Hardware info banner */}
              {hardwareInfo && (
                <div className="rounded-lg bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 px-3 py-2">
                  <p className="text-xs text-neutral-600 dark:text-neutral-400">
                    CPU : {hardwareInfo.cpuCores} coeurs | RAM : {hardwareInfo.totalRAMGB.toFixed(1)} GB | GPU : {hardwareInfo.isGPU ? hardwareInfo.gpuName : (hardwareInfo.systemGPU || "aucun")}
                    {hardwareInfo.isGPU && hardwareInfo.vram && ` (${hardwareInfo.vram})`}
                  </p>
                </div>
              )}

              {/* Threads CPU */}
              <Field>
                <div className="flex items-center justify-between">
                  <div className="flex items-start space-x-3">
                    <Cpu size={20} className="mt-1 flex-shrink-0 text-black dark:text-neutral-100" />
                    <div>
                      <Label>Threads CPU</Label>
                      <Description>
                        Nombre de coeurs utilises pour l'inference.
                      </Description>
                    </div>
                  </div>
                  <select
                    className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
                    value={settings?.NumThread ?? 0}
                    onChange={(e) => handlePerfChange("NumThread", Number(e.target.value))}
                  >
                    <option value={0}>Auto ({Math.max(1, (hardwareInfo?.cpuCores ?? 4) - 2)})</option>
                    {Array.from({ length: hardwareInfo?.cpuCores ?? 8 }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>{n} {n === 1 ? "coeur" : "coeurs"}</option>
                    ))}
                  </select>
                </div>
              </Field>

              {/* Context Length - MOVED FROM LOCAL CONFIGURATION */}
              <Field>
                <div className="flex items-start space-x-3">
                  <GearSix size={20} weight="fill" className="mt-1 flex-shrink-0 text-black dark:text-neutral-100" />
                  <div className="w-full">
                    <Label>Longueur du contexte</Label>
                    <Description>
                      La longueur du contexte determine la quantite de conversation
                      que les LLM peuvent retenir pour generer des reponses.
                    </Description>
                    <div className="mt-3">
                      <Slider
                        value={settings.ContextLength || 4096}
                        onChange={(value) => handlePerfChange("ContextLength", value)}
                        options={[
                          { value: 1024, label: "1k" },
                          { value: 2048, label: "2k" },
                          { value: 4096, label: "4k" },
                          { value: 8192, label: "8k" },
                          { value: 16384, label: "16k" },
                          { value: 32768, label: "32k" },
                          { value: 65536, label: "64k" },
                        ]}
                      />
                    </div>
                  </div>
                </div>
              </Field>

              {/* Keep Alive */}
              <Field>
                <div className="flex items-center justify-between">
                  <div className="flex items-start space-x-3">
                    <Clock size={20} className="mt-1 flex-shrink-0 text-black dark:text-neutral-100" />
                    <div>
                      <Label>Keep Alive</Label>
                      <Description>
                        Duree avant dechargement du modele de la memoire.
                      </Description>
                    </div>
                  </div>
                  <select
                    className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
                    value={settings?.KeepAlive || ""}
                    onChange={(e) => handlePerfChange("KeepAlive", e.target.value)}
                  >
                    <option value="">Auto (2 min)</option>
                    <option value="2m">2 minutes</option>
                    <option value="5m">5 minutes</option>
                    <option value="30m">30 minutes</option>
                    <option value="1h">1 heure</option>
                    <option value="-1">Illimite</option>
                  </select>
                </div>
              </Field>

              {/* Max Loaded Models */}
              <Field>
                <div className="flex items-center justify-between">
                  <div className="flex items-start space-x-3">
                    <GearSix size={20} className="mt-1 flex-shrink-0 text-black dark:text-neutral-100" />
                    <div>
                      <Label>Modeles simultanes</Label>
                      <Description>
                        Nombre maximum de modeles charges en RAM.
                      </Description>
                    </div>
                  </div>
                  <select
                    className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
                    value={settings?.MaxLoadedModels ?? 0}
                    onChange={(e) => handlePerfChange("MaxLoadedModels", Number(e.target.value))}
                  >
                    <option value={0}>Auto</option>
                    <option value={1}>1</option>
                    <option value={2}>2</option>
                    <option value={3}>3</option>
                    <option value={4}>4</option>
                  </select>
                </div>
              </Field>

              {/* KV Cache Type */}
              <Field>
                <div className="flex items-center justify-between">
                  <div className="flex items-start space-x-3">
                    <GearSix size={20} className="mt-1 flex-shrink-0 text-black dark:text-neutral-100" />
                    <div>
                      <Label>Cache KV</Label>
                      <Description>
                        Quantification du cache attention. q8_0 recommande pour CPU.
                      </Description>
                    </div>
                  </div>
                  <select
                    className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
                    value={settings?.KVCacheType || ""}
                    onChange={(e) => handlePerfChange("KVCacheType", e.target.value)}
                  >
                    <option value="">Auto (q8_0)</option>
                    <option value="f16">f16 (pleine precision)</option>
                    <option value="q8_0">q8_0 (recommande CPU)</option>
                    <option value="q4_0">q4_0 (economique)</option>
                  </select>
                </div>
              </Field>

              {/* Batch Size */}
              <Field>
                <div className="flex items-center justify-between">
                  <div className="flex items-start space-x-3">
                    <GearSix size={20} className="mt-1 flex-shrink-0 text-black dark:text-neutral-100" />
                    <div>
                      <Label>Batch size</Label>
                      <Description>
                        Taille du batch pour le traitement du prompt.
                      </Description>
                    </div>
                  </div>
                  <select
                    className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
                    value={settings?.NumBatch ?? 0}
                    onChange={(e) => handlePerfChange("NumBatch", Number(e.target.value))}
                  >
                    <option value={0}>Auto (256)</option>
                    <option value={128}>128</option>
                    <option value={256}>256</option>
                    <option value={512}>512</option>
                    <option value={1024}>1024</option>
                  </select>
                </div>
              </Field>

              {/* MLock */}
              <Field>
                <div className="flex items-center justify-between">
                  <div className="flex items-start space-x-3">
                    <Lightning size={20} weight="fill" className="mt-1 flex-shrink-0 text-black dark:text-neutral-100" />
                    <div>
                      <Label>MLock (verrouiller RAM)</Label>
                      <Description>
                        Empêche Windows de pager le modèle sur disque. Réduit les stalls sous pression mémoire.
                      </Description>
                    </div>
                  </div>
                  <button
                    className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${settings?.UseMlock ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-neutral-100 text-neutral-600 dark:bg-neutral-700 dark:text-neutral-400"}`}
                    onClick={() => handlePerfChange("UseMlock", !settings?.UseMlock)}
                  >
                    {settings?.UseMlock ? "Activé" : "Désactivé"}
                  </button>
                </div>
              </Field>

              {/* Concurrent Predictions */}
              <Field>
                <div className="flex items-center justify-between">
                  <div className="flex items-start space-x-3">
                    <Lightning size={20} weight="fill" className="mt-1 flex-shrink-0 text-black dark:text-neutral-100" />
                    <div>
                      <Label>Predictions concurrentes</Label>
                      <Description>
                        Nombre de requetes simultanees. Necessite un redemarrage.
                      </Description>
                    </div>
                  </div>
                  <select
                    className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
                    value={settings?.NumParallel ?? 0}
                    onChange={(e) => handlePerfChange("NumParallel", Number(e.target.value))}
                  >
                    <option value={0}>Auto (1)</option>
                    <option value={1}>1</option>
                    <option value={2}>2</option>
                    <option value={4}>4</option>
                  </select>
                </div>
              </Field>

              {/* Context Overflow Policy */}
              <Field>
                <div className="flex items-center justify-between">
                  <div className="flex items-start space-x-3">
                    <Warning size={20} weight="fill" className="mt-1 flex-shrink-0 text-black dark:text-neutral-100" />
                    <div>
                      <Label>Politique de depassement contexte</Label>
                      <Description>
                        Comportement quand la conversation depasse la taille du contexte.
                      </Description>
                    </div>
                  </div>
                  <select
                    className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
                    value={settings?.ContextOverflowPolicy || "truncate_old"}
                    onChange={(e) => handlePerfChange("ContextOverflowPolicy", e.target.value)}
                  >
                    <option value="truncate_old">Tronquer les anciens messages</option>
                    <option value="stop_and_warn">Arreter et avertir</option>
                    <option value="summarize">Resumer les anciens messages</option>
                  </select>
                </div>
              </Field>

              {/* Runtime Selection (LM Studio style) */}
              <Field>
                <div className="flex items-start space-x-3 mb-3">
                  <Lightning size={20} weight="fill" className="mt-0.5 flex-shrink-0 text-black dark:text-neutral-100" />
                  <div>
                    <Label>Backend d'inference</Label>
                    <Description>
                      Selectionnez le moteur de calcul. Necessite un redemarrage.
                    </Description>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {/* CPU Backend Card */}
                  <button
                    type="button"
                    onClick={() => handlePerfChange("VulkanEnabled", false)}
                    className={`relative rounded-lg border-2 p-3 text-left transition-all ${
                      !(settings?.VulkanEnabled)
                        ? "border-blue-500 bg-blue-50 dark:bg-blue-950/30"
                        : "border-neutral-200 dark:border-neutral-700 hover:border-neutral-300 dark:hover:border-neutral-600"
                    }`}
                  >
                    {!(settings?.VulkanEnabled) && (
                      <span className="absolute top-2 right-2 flex h-2 w-2 rounded-full bg-blue-500" />
                    )}
                    <div className="flex items-center gap-2 mb-1">
                      <Cpu size={18} weight="bold" className={!(settings?.VulkanEnabled) ? "text-blue-600 dark:text-blue-400" : "text-neutral-500"} />
                      <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">CPU</span>
                    </div>
                    <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
                      llama.cpp (Haswell AVX2)
                    </p>
                    {hardwareInfo && (
                      <p className="text-[10px] text-neutral-400 dark:text-neutral-500 mt-1">
                        {hardwareInfo.cpuCores} coeurs · {hardwareInfo.totalRAMGB.toFixed(0)} GB RAM
                      </p>
                    )}
                  </button>
                  {/* Vulkan GPU Backend Card */}
                  <button
                    type="button"
                    onClick={() => handlePerfChange("VulkanEnabled", true)}
                    className={`relative rounded-lg border-2 p-3 text-left transition-all ${
                      settings?.VulkanEnabled
                        ? "border-green-500 bg-green-50 dark:bg-green-950/30"
                        : "border-neutral-200 dark:border-neutral-700 hover:border-neutral-300 dark:hover:border-neutral-600"
                    }`}
                  >
                    {settings?.VulkanEnabled && (
                      <span className="absolute top-2 right-2 flex h-2 w-2 rounded-full bg-green-500" />
                    )}
                    <div className="flex items-center gap-2 mb-1">
                      <Lightning size={18} weight="bold" className={settings?.VulkanEnabled ? "text-green-600 dark:text-green-400" : "text-neutral-500"} />
                      <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Vulkan GPU</span>
                    </div>
                    <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
                      llama.cpp + ggml-vulkan
                    </p>
                    {hardwareInfo && (
                      <p className="text-[10px] text-neutral-400 dark:text-neutral-500 mt-1">
                        {hardwareInfo.gpuName || hardwareInfo.systemGPU || "GPU non detecte"}{hardwareInfo.vram ? ` · ${hardwareInfo.vram}` : ""}
                      </p>
                    )}
                  </button>
                </div>
              </Field>
            </div>
          </div>

          {/* Dromadaire: Encryption at Rest */}
          <div className="overflow-hidden rounded-xl bg-white dark:bg-neutral-800">
            <div className="space-y-4 p-4">
              <Field>
                <div className="flex items-center justify-between">
                  <div className="flex items-start space-x-3">
                    <Lock size={20} weight="fill" className="mt-1 flex-shrink-0 text-black dark:text-neutral-100" />
                    <div>
                      <Label>Chiffrement des conversations</Label>
                      <Description>
                        Chiffre toutes les conversations stockées localement
                        avec AES-256-GCM.
                      </Description>
                      <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                        Attention : si la clé est perdue, les conversations
                        seront irrécupérables.
                      </p>
                    </div>
                  </div>
                  <Switch
                    checked={settings.EncryptionEnabled}
                    onChange={(checked) =>
                      handleChange("EncryptionEnabled", checked)
                    }
                  />
                </div>
              </Field>

              {/* Dromadaire: Key backup panel */}
              {encKeyBackup && (
                <div className="rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/30 p-3 space-y-3">
                  <p className="text-sm font-medium text-green-800 dark:text-green-300">
                    Sauvegardez votre clé de chiffrement
                  </p>
                  <p className="text-xs text-green-700 dark:text-green-400">
                    Conservez cette clé en lieu sûr. Sans elle, vos
                    conversations chiffrées seront irrécupérables.
                  </p>
                  <div className="bg-white dark:bg-neutral-900 rounded border border-green-200 dark:border-green-800 px-3 py-2">
                    <code className="text-xs text-neutral-700 dark:text-neutral-300 break-all select-all">
                      {encKeyBackup.key}
                    </code>
                  </div>
                  <p className="text-xs text-neutral-500 dark:text-neutral-500">
                    Fichier : {encKeyBackup.path}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      color="white"
                      className="flex-1 !text-xs"
                      onClick={() => {
                        navigator.clipboard.writeText(encKeyBackup.key);
                        setKeyCopied(true);
                        setTimeout(() => setKeyCopied(false), 2000);
                      }}
                    >
                      <ClipboardText size={16} className="mr-1" />
                      {keyCopied ? "Copié !" : "Copier la clé"}
                    </Button>
                    <Button
                      type="button"
                      color="white"
                      className="flex-1 !text-xs"
                      onClick={() => {
                        const blob = new Blob([encKeyBackup.key], {
                          type: "text/plain",
                        });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = "dromadaire-encryption.key";
                        a.click();
                        URL.revokeObjectURL(url);
                      }}
                    >
                      <DownloadSimple size={16} className="mr-1" />
                      Télécharger .key
                    </Button>
                  </div>
                  <Button
                    type="button"
                    color="white"
                    className="w-full !text-xs"
                    onClick={() => setEncKeyBackup(null)}
                  >
                    J'ai sauvegardé ma clé
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* Agent Mode */}
          {window.OLLAMA_TOOLS && (
            <div className="overflow-hidden rounded-xl bg-white dark:bg-neutral-800">
              <div className="space-y-4 p-4">
                <Field>
                  <div className="flex items-center justify-between">
                    <div className="flex items-start space-x-3">
                      <Lightning size={20} weight="fill" className="mt-1 flex-shrink-0 text-black dark:text-neutral-100" />
                      <div>
                        <Label>Mode Agent</Label>
                        <Description>
                          Utiliser des outils multi-tours pour répondre
                        </Description>
                      </div>
                    </div>
                    <Switch
                      checked={settings.Agent}
                      onChange={(checked) => handleChange("Agent", checked)}
                    />
                  </div>
                </Field>

                {/* Tools Mode */}
                <Field>
                  <div className="flex items-center justify-between">
                    <div className="flex items-start space-x-3">
                      <Wrench size={20} weight="fill" className="mt-1 flex-shrink-0 text-black dark:text-neutral-100" />
                      <div>
                        <Label>Mode Outils</Label>
                        <Description>
                          Utiliser des outils mono-tour pour répondre
                        </Description>
                      </div>
                    </div>
                    <Switch
                      checked={settings.Tools}
                      onChange={(checked) => handleChange("Tools", checked)}
                    />
                  </div>
                </Field>
              </div>
            </div>
          )}

          {/* Dromadaire: Password Protection */}
          <div className="overflow-hidden rounded-xl bg-white dark:bg-neutral-800">
            <div className="space-y-4 p-4">
              <Field>
                <div className="flex items-start space-x-3">
                  <ShieldCheck size={20} weight="fill" className="mt-1 flex-shrink-0 text-black dark:text-neutral-100" />
                  <div className="w-full">
                    <Label>Protection par mot de passe</Label>
                    <Description>
                      Demander un mot de passe au demarrage de l'application.
                    </Description>

                    {!authData?.passwordEnabled ? (
                      /* Set password form */
                      <div className="mt-3 space-y-2">
                        <input
                          ref={pwdInputRef}
                          type="password"
                          value={pwdNew}
                          onChange={(e) => setPwdNew(e.target.value)}
                          placeholder="Nouveau mot de passe (min. 4 car.)"
                          className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm dark:text-neutral-200 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                        <input
                          type="password"
                          value={pwdConfirm}
                          onChange={(e) => setPwdConfirm(e.target.value)}
                          placeholder="Confirmer le mot de passe"
                          className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm dark:text-neutral-200 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                        {pwdError && (
                          <p className="text-xs text-red-500">{pwdError}</p>
                        )}
                        <Button
                          type="button"
                          color="white"
                          className="!text-xs"
                          disabled={pwdSaving}
                          onClick={async () => {
                            setPwdError(null);
                            if (pwdNew.length < 4) {
                              setPwdError("Le mot de passe doit contenir au moins 4 caracteres.");
                              return;
                            }
                            if (pwdNew !== pwdConfirm) {
                              setPwdError("Les mots de passe ne correspondent pas.");
                              return;
                            }
                            setPwdSaving(true);
                            try {
                              await setAppPassword(pwdNew);
                              setPwdNew("");
                              setPwdConfirm("");
                              refetchAuth();
                              setShowSaved(true);
                              setTimeout(() => setShowSaved(false), 1500);
                            } catch (err: unknown) {
                              setPwdError(err instanceof Error ? err.message : "Erreur");
                            } finally {
                              setPwdSaving(false);
                            }
                          }}
                        >
                          Activer le mot de passe
                        </Button>
                      </div>
                    ) : (
                      /* Remove password form */
                      <div className="mt-3 space-y-2">
                        <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                          Mot de passe actif
                        </p>
                        <input
                          type="password"
                          value={pwdCurrent}
                          onChange={(e) => setPwdCurrent(e.target.value)}
                          placeholder="Mot de passe actuel pour desactiver"
                          className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm dark:text-neutral-200 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                        {pwdError && (
                          <p className="text-xs text-red-500">{pwdError}</p>
                        )}
                        <Button
                          type="button"
                          color="white"
                          className="!text-xs"
                          disabled={pwdSaving}
                          onClick={async () => {
                            setPwdError(null);
                            if (!pwdCurrent) {
                              setPwdError("Entrez votre mot de passe actuel.");
                              return;
                            }
                            setPwdSaving(true);
                            try {
                              await removeAppPassword(pwdCurrent);
                              setPwdCurrent("");
                              refetchAuth();
                              setShowSaved(true);
                              setTimeout(() => setShowSaved(false), 1500);
                            } catch (err: unknown) {
                              setPwdError(err instanceof Error ? err.message : "Mot de passe incorrect");
                            } finally {
                              setPwdSaving(false);
                            }
                          }}
                        >
                          Desactiver le mot de passe
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </Field>

              {/* Auto-delete on 3 failures */}
              {authData?.passwordEnabled && (
                <Field>
                  <div className="flex items-center justify-between">
                    <div className="flex items-start space-x-3">
                      <ShieldCheck size={20} weight="fill" className="mt-1 flex-shrink-0 text-red-500" />
                      <div>
                        <Label>Auto-suppression (3 echecs)</Label>
                        <Description>
                          Supprime toutes les conversations et la cle de chiffrement
                          apres 3 tentatives de mot de passe echouees.
                        </Description>
                        {settings?.AutoDeleteOnFailure && (
                          <p className="text-xs text-red-500 dark:text-red-400 mt-1 font-medium">
                            Attention : les donnees seront definitivement perdues.
                          </p>
                        )}
                      </div>
                    </div>
                    <Switch
                      checked={settings?.AutoDeleteOnFailure ?? false}
                      onChange={(checked) => {
                        if (checked) {
                          const ok = window.confirm(
                            "Activer la suppression automatique apres 3 echecs de mot de passe ?\n\nToutes les conversations et la cle de chiffrement seront definitivement supprimees."
                          );
                          if (!ok) return;
                        }
                        handleChange("AutoDeleteOnFailure", checked);
                      }}
                    />
                  </div>
                </Field>
              )}

              {/* Auto-lock after inactivity */}
              {authData?.passwordEnabled && (
                <Field>
                  <div className="flex items-center justify-between">
                    <div className="flex items-start space-x-3">
                      <Lock size={20} weight="fill" className="mt-1 flex-shrink-0 text-amber-500" />
                      <div>
                        <Label>Verrouillage automatique</Label>
                        <Description>
                          Verrouille l'application apres une periode d'inactivite.
                        </Description>
                      </div>
                    </div>
                    <select
                      className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
                      value={settings?.LockTimeoutMinutes ?? 0}
                      onChange={(e) => handleChange("LockTimeoutMinutes", Number(e.target.value))}
                    >
                      <option value={0}>Desactive</option>
                      <option value={5}>5 minutes</option>
                      <option value={10}>10 minutes</option>
                      <option value={30}>30 minutes</option>
                    </select>
                  </div>
                </Field>
              )}
            </div>
          </div>

          {/* Retention des conversations */}
          <div className="mt-4 rounded-lg border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-neutral-800">
            <div className="space-y-4">
              <Field>
                <div className="flex items-center justify-between">
                  <div className="flex items-start space-x-3">
                    <Clock size={20} className="mt-1 flex-shrink-0 text-black dark:text-neutral-100" />
                    <div>
                      <Label>Retention des conversations</Label>
                      <Description>
                        Supprime automatiquement les conversations anciennes au demarrage.
                      </Description>
                      {(settings?.AutoDeleteDays ?? 0) > 0 && (
                        <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                          Les conversations de plus de {settings?.AutoDeleteDays} jours seront supprimees au prochain demarrage.
                        </p>
                      )}
                    </div>
                  </div>
                  <select
                    className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
                    value={settings?.AutoDeleteDays ?? 0}
                    onChange={(e) => handleChange("AutoDeleteDays", Number(e.target.value))}
                  >
                    <option value={0}>Illimitee</option>
                    <option value={7}>7 jours</option>
                    <option value={30}>30 jours</option>
                    <option value={90}>90 jours</option>
                  </select>
                </div>
              </Field>
            </div>
          </div>

          {/* Nettoyage presse-papiers */}
          <div className="mt-4 rounded-lg border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-neutral-800">
            <div className="space-y-4">
              <Field>
                <div className="flex items-center justify-between">
                  <div className="flex items-start space-x-3">
                    <ClipboardText size={20} className="mt-1 flex-shrink-0 text-black dark:text-neutral-100" />
                    <div>
                      <Label>Effacer le presse-papiers</Label>
                      <Description>
                        Efface automatiquement le presse-papiers apres chaque copie.
                      </Description>
                    </div>
                  </div>
                  <select
                    className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
                    value={settings?.ClipboardClearSeconds ?? 0}
                    onChange={(e) => handleChange("ClipboardClearSeconds", Number(e.target.value))}
                  >
                    <option value={0}>Desactive</option>
                    <option value={15}>15 secondes</option>
                    <option value={30}>30 secondes</option>
                    <option value={60}>60 secondes</option>
                  </select>
                </div>
              </Field>
            </div>
          </div>

          {/* LOT 24: Custom system prompt */}
          <div className="px-4 pt-4">
            <h3 className="mb-3 text-sm font-semibold text-neutral-900 dark:text-neutral-100">Personnalisation</h3>
            <div className="space-y-4">
              <Field>
                <div className="flex items-start space-x-3">
                  <ChatCircleDots size={20} className="mt-1 flex-shrink-0 text-black dark:text-neutral-100" />
                  <div className="flex-1">
                    <Label>System prompt</Label>
                    <Description>
                      Instructions envoyees au modele a chaque message. Vide = defaut.
                    </Description>
                    <textarea
                      className="mt-2 w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-700 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 resize-y min-h-[80px]"
                      placeholder="Tu es un assistant intelligent. Reponds toujours en francais..."
                      value={settings?.SystemPrompt ?? ""}
                      onChange={(e) => handleChange("SystemPrompt", e.target.value)}
                      rows={3}
                    />
                  </div>
                </div>
              </Field>
            </div>
          </div>

          {/* LOT H: Writing style analysis for human mode */}
          <StyleAnalysisSection settings={settings} handleChange={handleChange} />

          {/* LOTs 15-21: Features settings */}
          <div className="px-4 pt-4">
            <h3 className="mb-3 text-sm font-semibold text-neutral-900 dark:text-neutral-100">Fonctionnalites</h3>
            <div className="space-y-4">
              {/* LOT 15: Search */}
              <Field>
                <div className="flex items-center justify-between">
                  <div className="flex items-start space-x-3">
                    <MagnifyingGlass size={20} className="mt-1 flex-shrink-0 text-black dark:text-neutral-100" />
                    <div>
                      <Label>Recherche conversations</Label>
                      <Description>
                        Rechercher dans les titres et messages.
                      </Description>
                    </div>
                  </div>
                  <Switch
                    checked={settings?.SearchEnabled ?? true}
                    onChange={(checked) => handleChange("SearchEnabled", checked)}
                  />
                </div>
              </Field>

              {/* LOT 16: RAG Citations */}
              <Field>
                <div className="flex items-center justify-between">
                  <div className="flex items-start space-x-3">
                    <ChatCircleDots size={20} className="mt-1 flex-shrink-0 text-black dark:text-neutral-100" />
                    <div>
                      <Label>Citations RAG</Label>
                      <Description>
                        Afficher les sources [1] [2] dans les reponses.
                      </Description>
                    </div>
                  </div>
                  <Switch
                    checked={settings?.RAGCitationsEnabled ?? true}
                    onChange={(checked) => handleChange("RAGCitationsEnabled", checked)}
                    disabled={!settings?.RAGEnabled}
                  />
                </div>
              </Field>

              {/* LOT 17: RAG Preview */}
              <Field>
                <div className="flex items-center justify-between">
                  <div className="flex items-start space-x-3">
                    <FileText size={20} className="mt-1 flex-shrink-0 text-black dark:text-neutral-100" />
                    <div>
                      <Label>Apercu documents RAG</Label>
                      <Description>
                        Voir les chunks de documents au clic sur une citation.
                      </Description>
                    </div>
                  </div>
                  <Switch
                    checked={settings?.RAGPreviewEnabled ?? true}
                    onChange={(checked) => handleChange("RAGPreviewEnabled", checked)}
                    disabled={!settings?.RAGEnabled}
                  />
                </div>
              </Field>

              {/* LOT 18: Artifacts */}
              <Field>
                <div className="flex items-center justify-between">
                  <div className="flex items-start space-x-3">
                    <Terminal size={20} className="mt-1 flex-shrink-0 text-black dark:text-neutral-100" />
                    <div>
                      <Label>Artifacts interactifs</Label>
                      <Description>
                        Rendu HTML/SVG/Mermaid dans les reponses (sandboxe).
                      </Description>
                    </div>
                  </div>
                  <Switch
                    checked={settings?.ArtifactsEnabled ?? true}
                    onChange={(checked) => handleChange("ArtifactsEnabled", checked)}
                  />
                </div>
              </Field>

              {/* LOT 21: Keyboard Shortcuts */}
              <Field>
                <div className="flex items-center justify-between">
                  <div className="flex items-start space-x-3">
                    <Lightning size={20} weight="fill" className="mt-1 flex-shrink-0 text-black dark:text-neutral-100" />
                    <div>
                      <Label>Raccourcis clavier</Label>
                      <Description>
                        Raccourcis globaux pour naviguer rapidement
                      </Description>
                    </div>
                  </div>
                  <Switch
                    checked={settings?.KeyboardShortcutsEnabled ?? true}
                    onChange={(checked) => handleChange("KeyboardShortcutsEnabled", checked)}
                  />
                </div>
                {(settings?.KeyboardShortcutsEnabled ?? true) && (
                  <div className="mt-3 ml-8 space-y-1">
                    {[
                      { keys: "Ctrl+K", description: "Rechercher" },
                      { keys: "Ctrl+N", description: "Nouvelle conversation" },
                      { keys: "Ctrl+Shift+I", description: "Mode incognito" },
                      { keys: "Ctrl+,", description: "Paramètres" },
                      { keys: "Escape", description: "Fermer" },
                    ].map(({ keys, description }) => (
                      <div key={keys} className="flex items-center justify-between text-sm">
                        <span className="text-neutral-600 dark:text-neutral-400">{description}</span>
                        <kbd className="px-2 py-0.5 text-xs font-mono bg-neutral-100 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-300 rounded border border-neutral-200 dark:border-neutral-600">
                          {keys}
                        </kbd>
                      </div>
                    ))}
                  </div>
                )}
              </Field>
            </div>
          </div>

          {/* Reset button */}
          <div className="mt-6 flex justify-end px-4">
            <Button
              type="button"
              color="white"
              className="px-3"
              onClick={handleResetToDefaults}
            >
              Réinitialiser
            </Button>
          </div>
        </div>

        {/* Restart required banner */}
        {needsRestart && (
          <div className="fixed bottom-12 left-1/2 transform -translate-x-1/2 z-50">
            <div className="flex items-center gap-3 rounded-xl bg-amber-500 text-white px-4 py-2 shadow-lg">
              <span className="text-sm font-medium">Redemarrage du serveur requis</span>
              <Button
                type="button"
                color="white"
                className="!text-xs !py-1"
                disabled={isRestarting}
                onClick={handleRestart}
              >
                {isRestarting ? "Redemarrage..." : "Redemarrer"}
              </Button>
            </div>
          </div>
        )}

        {/* Saved indicator */}
        {(showSaved || restartMessage) && (
          <div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 transition-opacity duration-300 z-50">
            <Badge
              color="green"
              className="!bg-green-500 !text-white dark:!bg-green-600"
            >
              Enregistré
            </Badge>
          </div>
        )}
      </div>
    </main>
  );
}

// LOT H: Style analysis section for human mode
function StyleAnalysisSection({ settings, handleChange }: { settings: any; handleChange: (field: keyof SettingsType, value: boolean | string | number) => void }) {
  const [samples, setSamples] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState("");

  const writingStyleRules = settings?.WritingStyleRules ?? "";
  const styleAnalysisModel = settings?.StyleAnalysisModel ?? "gemma3:4b";

  // Always show in Personnalisation section (rules are useful across modes)
  // No condition — the section is always visible

  const handleAnalyze = async () => {
    if (!samples.trim()) return;
    setAnalyzing(true);
    setError("");
    try {
      const result = await analyzeWritingStyle(samples.trim());
      handleChange("WritingStyleRules", result.rules);
    } catch (e: any) {
      setError(e.message || "Erreur lors de l'analyse");
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="px-4 pt-4">
      <h3 className="mb-3 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
        Style d'ecriture personnel
      </h3>
      <div className="space-y-3">
        <Field>
          <div className="flex-1">
            <Label>Textes d'exemple</Label>
            <Description>
              Collez vos emails, messages ou textes pour analyser votre style.
            </Description>
            <textarea
              className="mt-2 w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-700 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 resize-y"
              placeholder="Collez ici plusieurs exemples de textes ecrits dans votre style personnel..."
              value={samples}
              onChange={(e) => setSamples(e.target.value)}
              rows={5}
            />
          </div>
        </Field>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-xs text-neutral-500 dark:text-neutral-400">Modele :</label>
            <select
              className="rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs text-neutral-700 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
              value={styleAnalysisModel}
              onChange={(e) => handleChange("StyleAnalysisModel", e.target.value)}
            >
              <option value="gemma3:4b">gemma3:4b</option>
              <option value="gemma3:4b">gemma3:4b</option>
              <option value="qwen2.5:3b">qwen2.5:3b</option>
            </select>
          </div>

          <Button
            onClick={handleAnalyze}
            disabled={analyzing || !samples.trim()}
            className="text-xs"
          >
            {analyzing ? (
              <span className="flex items-center gap-1.5">
                <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Analyse en cours (~30s)...
              </span>
            ) : (
              "Analyser mon style"
            )}
          </Button>
        </div>

        {error && (
          <p className="text-xs text-red-500">{error}</p>
        )}

        {writingStyleRules && (
          <Field>
            <div className="flex-1">
              <Label>Regles extraites</Label>
              <Description>
                Ces regles sont injectees automatiquement en mode Humain. Vous pouvez les modifier.
              </Description>
              <textarea
                className="mt-2 w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-700 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 resize-y"
                value={writingStyleRules}
                onChange={(e) => handleChange("WritingStyleRules", e.target.value)}
                rows={6}
              />
            </div>
          </Field>
        )}
      </div>
    </div>
  );
}

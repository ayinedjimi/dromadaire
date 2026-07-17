import { useState, useRef, useEffect } from "react";
import { useSettings } from "@/hooks/useSettings";
import { useSelectedModel } from "@/hooks/useSelectedModel";

// Modes that require strong instruction-following (4b+ recommended)
const COMPLEX_MODES = new Set(["human", "ui-ux", "code", "pedagogic", "image"]);

const modes = [
  {
    key: "",
    label: "Normal",
    desc: "Reponses equilibrees",
    icon: (
      <svg width="16" height="16" viewBox="0 0 256 256" fill="none" stroke="currentColor" strokeWidth="20" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="128" cy="128" r="96" />
        <circle cx="92" cy="108" r="12" fill="currentColor" stroke="none" />
        <circle cx="164" cy="108" r="12" fill="currentColor" stroke="none" />
        <path d="M88 152c8 16 24 24 40 24s32-8 40-24" />
      </svg>
    ),
  },
  {
    key: "concise",
    label: "Concis",
    desc: "Court et direct",
    icon: (
      <svg width="16" height="16" viewBox="0 0 256 256" fill="none" stroke="currentColor" strokeWidth="20" strokeLinecap="round" strokeLinejoin="round">
        <line x1="40" y1="68" x2="216" y2="68" />
        <line x1="40" y1="128" x2="168" y2="128" />
        <line x1="40" y1="188" x2="120" y2="188" />
      </svg>
    ),
  },
  {
    key: "detailed",
    label: "Detaille",
    desc: "Complet et structure",
    icon: (
      <svg width="16" height="16" viewBox="0 0 256 256" fill="none" stroke="currentColor" strokeWidth="20" strokeLinecap="round" strokeLinejoin="round">
        <line x1="40" y1="48" x2="216" y2="48" />
        <line x1="40" y1="88" x2="216" y2="88" />
        <line x1="40" y1="128" x2="216" y2="128" />
        <line x1="40" y1="168" x2="216" y2="168" />
        <line x1="40" y1="208" x2="176" y2="208" />
      </svg>
    ),
  },
  {
    key: "code",
    label: "Code",
    desc: "Code commente uniquement",
    icon: (
      <svg width="16" height="16" viewBox="0 0 256 256" fill="none" stroke="currentColor" strokeWidth="20" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="64 88 16 128 64 168" />
        <polyline points="192 88 240 128 192 168" />
        <line x1="160" y1="40" x2="96" y2="216" />
      </svg>
    ),
  },
  {
    key: "pedagogic",
    label: "Pedagogue",
    desc: "Pas a pas, debutant",
    icon: (
      <svg width="16" height="16" viewBox="0 0 256 256" fill="none" stroke="currentColor" strokeWidth="20" strokeLinecap="round" strokeLinejoin="round">
        <path d="M128 32L16 96l112 64 112-64z" />
        <path d="M48 116v56c0 0 32 36 80 36s80-36 80-36v-56" />
        <line x1="240" y1="96" x2="240" y2="176" />
      </svg>
    ),
  },
  {
    key: "human",
    label: "Humain",
    desc: "Texte naturel, indetectable",
    icon: (
      <svg width="16" height="16" viewBox="0 0 256 256" fill="none" stroke="currentColor" strokeWidth="20" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="128" cy="72" r="40" />
        <path d="M56 232c0-44 32-80 72-80s72 36 72 80" />
      </svg>
    ),
  },
  {
    key: "ui-ux",
    label: "UI/UX",
    desc: "Design pro, Tailwind, responsive",
    icon: (
      <svg width="16" height="16" viewBox="0 0 256 256" fill="none" stroke="currentColor" strokeWidth="20" strokeLinecap="round" strokeLinejoin="round">
        <rect x="32" y="48" width="192" height="136" rx="12" />
        <line x1="32" y1="152" x2="224" y2="152" />
        <line x1="96" y1="184" x2="160" y2="184" />
        <rect x="56" y="76" width="56" height="48" rx="4" fill="currentColor" fillOpacity="0.15" stroke="currentColor" />
        <line x1="132" y1="84" x2="196" y2="84" />
        <line x1="132" y1="104" x2="180" y2="104" />
      </svg>
    ),
  },
  {
    key: "image",
    label: "Image",
    desc: "Genere des visuels SVG/HTML",
    icon: (
      <svg width="16" height="16" viewBox="0 0 256 256" fill="none" stroke="currentColor" strokeWidth="20" strokeLinecap="round" strokeLinejoin="round">
        <rect x="32" y="48" width="192" height="160" rx="12" />
        <circle cx="100" cy="108" r="20" />
        <path d="M224 168l-52-52c-6-6-16-6-22 0l-42 42-18-18c-6-6-16-6-22 0L32 176" />
      </svg>
    ),
  },
] as const;

const humanSubModes = [
  { key: "", label: "Conversation" },
  { key: "email", label: "Email" },
  { key: "sms", label: "SMS" },
  { key: "forum", label: "Forum" },
  { key: "academic", label: "Academique" },
] as const;

const uiUxSubModes = [
  { key: "", label: "General" },
  { key: "landing", label: "Landing" },
  { key: "dashboard", label: "Dashboard" },
  { key: "app", label: "App" },
  { key: "portfolio", label: "Portfolio" },
] as const;

export function ResponseModeButton() {
  const { settings, setSettings } = useSettings();
  const { selectedModel } = useSelectedModel();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const currentMode = settings?.responseMode || "";

  // Detect small models that can't follow complex mode instructions
  const modelName = selectedModel?.model || "";
  const isSmallModel = /:(1b|2b|3b|0\.5b|0\.6b|1\.5b)\b/i.test(modelName);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const activeMode = modes.find((m) => m.key === currentMode) || modes[0];
  const isActive = currentMode !== "";

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer border ${
          isActive
            ? "bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-900/40 dark:text-blue-300 dark:border-blue-700"
            : "text-neutral-500 border-transparent hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-700/50"
        }`}
        title={`Mode: ${activeMode.label}`}
      >
        {activeMode.icon}
        <span>{activeMode.label}</span>
        <svg width="10" height="10" viewBox="0 0 256 256" fill="none" stroke="currentColor" strokeWidth="28" strokeLinecap="round" strokeLinejoin="round" className="opacity-50">
          <polyline points="80 96 128 144 176 96" />
        </svg>
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-1 w-52 rounded-xl border border-neutral-200 bg-white shadow-xl dark:border-neutral-700 dark:bg-neutral-800 z-50 py-1 overflow-hidden animate-popover">
          {modes.map((mode) => (
            <div key={mode.key}>
              <button
                type="button"
                onClick={() => {
                  const newMode = currentMode === mode.key ? "" : mode.key;
                  if (newMode === "human" || newMode === "ui-ux") {
                    setSettings({ ResponseMode: newMode, HumanSubMode: "" });
                  } else {
                    setSettings({ ResponseMode: newMode, HumanSubMode: "" });
                  }
                }}
                className={`flex w-full items-center gap-3 px-3 py-2.5 text-sm transition-colors ${
                  currentMode === mode.key
                    ? "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                    : "text-neutral-700 hover:bg-neutral-50 dark:text-neutral-300 dark:hover:bg-neutral-700/50"
                }`}
              >
                <span className="flex-shrink-0 opacity-80">{mode.icon}</span>
                <div className="flex flex-col items-start">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium">{mode.label}</span>
                    {isSmallModel && COMPLEX_MODES.has(mode.key) && (
                      <span className="text-[9px] px-1 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400 leading-none" title="Ce mode necessite un modele 4b+ pour etre respecte">
                        4b+
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] opacity-60">{mode.desc}</span>
                </div>
                {currentMode === mode.key && (
                  <svg width="14" height="14" viewBox="0 0 256 256" fill="none" stroke="currentColor" strokeWidth="28" strokeLinecap="round" strokeLinejoin="round" className="ml-auto flex-shrink-0 text-blue-500">
                    <polyline points="40 128 96 184 216 64" />
                  </svg>
                )}
              </button>
              {/* LOT H: Sub-mode pills when human mode is selected */}
              {mode.key === "human" && currentMode === "human" && (
                <div className="flex flex-wrap gap-1 px-3 pb-2 pt-1">
                  {humanSubModes.map((sub) => (
                    <button
                      key={sub.key}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSettings({ HumanSubMode: sub.key });
                      }}
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors cursor-pointer border ${
                        (settings?.humanSubMode || "") === sub.key
                          ? "bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-900/50 dark:text-blue-300 dark:border-blue-600"
                          : "text-neutral-500 border-neutral-200 hover:bg-neutral-100 dark:text-neutral-400 dark:border-neutral-600 dark:hover:bg-neutral-700"
                      }`}
                    >
                      {sub.label}
                    </button>
                  ))}
                </div>
              )}
              {/* Sub-mode pills when UI/UX mode is selected */}
              {mode.key === "ui-ux" && currentMode === "ui-ux" && (
                <div className="flex flex-wrap gap-1 px-3 pb-2 pt-1">
                  {uiUxSubModes.map((sub) => (
                    <button
                      key={sub.key}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSettings({ HumanSubMode: sub.key });
                      }}
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors cursor-pointer border ${
                        (settings?.humanSubMode || "") === sub.key
                          ? "bg-violet-100 text-violet-700 border-violet-300 dark:bg-violet-900/50 dark:text-violet-300 dark:border-violet-600"
                          : "text-neutral-500 border-neutral-200 hover:bg-neutral-100 dark:text-neutral-400 dark:border-neutral-600 dark:hover:bg-neutral-700"
                      }`}
                    >
                      {sub.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

import { useEffect, useState } from "react";
import { X } from "@phosphor-icons/react";

const STORAGE_KEY = "dromadaire-tamagotchi";
const HUNGRY_AFTER_MS = 2 * 60 * 60 * 1000; // 2h
const SAD_AFTER_MS = 8 * 60 * 60 * 1000; // 8h

interface TamagotchiState {
  active: boolean;
  lastFed: number;
}

function readState(): TamagotchiState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { active: false, lastFed: Date.now() };
}

function writeState(state: TamagotchiState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function isTamagotchiActive() {
  return readState().active;
}

export function activateTamagotchi() {
  writeState({ active: true, lastFed: Date.now() });
  window.dispatchEvent(new Event("tamagotchi-changed"));
}

const MOODS = [
  { max: HUNGRY_AFTER_MS, face: "🐫", label: "En pleine forme" },
  { max: SAD_AFTER_MS, face: "😴", label: "A un peu faim" },
  { max: Infinity, face: "🥺", label: "Lui manque de l'affection" },
];

export function TamagotchiCompanion() {
  const [state, setState] = useState<TamagotchiState>(readState);
  const [bump, setBump] = useState(false);

  useEffect(() => {
    const refresh = () => setState(readState());
    window.addEventListener("storage", refresh);
    window.addEventListener("tamagotchi-changed", refresh);
    const interval = setInterval(refresh, 60_000);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener("tamagotchi-changed", refresh);
      clearInterval(interval);
    };
  }, []);

  if (!state.active) return null;

  const elapsed = Date.now() - state.lastFed;
  const mood = MOODS.find((m) => elapsed < m.max) ?? MOODS[MOODS.length - 1];

  const feed = () => {
    const next = { ...state, lastFed: Date.now() };
    writeState(next);
    setState(next);
    setBump(true);
    setTimeout(() => setBump(false), 400);
  };

  const dismiss = () => {
    const next = { ...state, active: false };
    writeState(next);
    setState(next);
  };

  return (
    <div className="tamagotchi-widget" title={mood.label}>
      <button className="tamagotchi-close" onClick={dismiss} title="Faire dormir le compagnon">
        <X size={10} />
      </button>
      <button className={`tamagotchi-face ${bump ? "tamagotchi-bump" : ""}`} onClick={feed} title="Cliquer pour cajoler">
        {mood.face}
      </button>

      <style>{`
        .tamagotchi-widget {
          position: fixed;
          bottom: 16px;
          right: 16px;
          z-index: 60;
          display: flex;
          align-items: center;
          -webkit-app-region: no-drag;
        }
        .tamagotchi-face {
          width: 44px;
          height: 44px;
          border-radius: 50%;
          border: 1px solid hsl(0 0% 85%);
          background: hsl(0 0% 100%);
          font-size: 22px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          box-shadow: 0 4px 14px hsl(0 0% 0% / 0.15);
          animation: tamagotchi-float 3s ease-in-out infinite;
        }
        .tamagotchi-bump { animation: tamagotchi-pop 400ms ease-out; }
        @keyframes tamagotchi-float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-4px); }
        }
        @keyframes tamagotchi-pop {
          0% { transform: scale(1); }
          40% { transform: scale(1.25); }
          100% { transform: scale(1); }
        }
        .tamagotchi-close {
          position: relative;
          right: -6px;
          top: -16px;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          border: none;
          background: hsl(0 0% 30%);
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          opacity: 0;
          transition: opacity 150ms;
        }
        .tamagotchi-widget:hover .tamagotchi-close { opacity: 0.8; }
        @media (prefers-color-scheme: dark) {
          .tamagotchi-face { background: hsl(0 0% 18%); border-color: hsl(0 0% 28%); }
        }
        :root[data-theme="dark"] .tamagotchi-face { background: hsl(0 0% 18%); border-color: hsl(0 0% 28%); }
      `}</style>
    </div>
  );
}

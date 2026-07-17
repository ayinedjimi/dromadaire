import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft, X, Wrench, Gauge } from "@phosphor-icons/react";
import { useInferenceCompute } from "@/hooks/useInferenceCompute";
import { DiagnosticModal } from "./DiagnosticModal";
import { BenchmarkModal } from "./BenchmarkModal";

export default function About() {
  const navigate = useNavigate();
  const { isGPU, gpuName, library, vram } = useInferenceCompute();
  const isWindows = navigator.platform.toLowerCase().includes("win");
  const [showDiagnostic, setShowDiagnostic] = useState(false);
  const [showBenchmark, setShowBenchmark] = useState(false);

  return (
    <main className="flex h-screen w-full flex-col select-none dark:bg-neutral-900">
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
              aria-label="Retour"
            >
              <ArrowLeft className="w-5 h-5 dark:text-white" />
            </button>
          )}
          A propos
        </h1>
        {!isWindows && (
          <button
            onClick={() => navigate({ to: "/" })}
            className="p-1 hover:bg-neutral-100 mr-3 dark:hover:bg-neutral-800 rounded-full"
            aria-label="Fermer"
          >
            <X className="w-6 h-6 dark:text-white" />
          </button>
        )}
      </header>
      <div className="w-full p-6 overflow-y-auto flex-1 overscroll-contain">
        <div className="max-w-md mx-auto space-y-4">
          {/* Logo & Identity */}
          <div className="text-center space-y-2 pb-1">
            <div className="mx-auto w-20 h-20 rounded-2xl bg-neutral-900 dark:bg-neutral-200 flex items-center justify-center shadow-lg">
              <svg width="48" height="48" viewBox="0 0 100 100" fill="none">
                <g fill="white" className="dark:fill-neutral-900">
                  <path d="M 25 36 C 22 34, 19 31, 18 28 C 17 25, 18 22, 20 20 C 21 18, 22 17, 23 16 C 25 14, 27 13, 29 13 Q 28 8, 31 12 C 32 14, 33 18, 33 22 C 33 30, 34 38, 37 44 C 39 50, 43 56, 51 56 C 55 52, 59 42, 62 34 C 64 30, 66 26, 68 25 C 70 24, 72 25, 73 27 C 75 30, 76 36, 77 42 C 78 50, 78 56, 76 60 L 76 62 L 35 62 C 33 58, 30 50, 27 42 C 26 40, 25 38, 25 36 Z" />
                  <rect x="37" y="62" width="4" height="22" rx="2" />
                  <rect x="44" y="62" width="4" height="22" rx="2" />
                  <rect x="64" y="62" width="4" height="22" rx="2" />
                  <rect x="71" y="62" width="4" height="22" rx="2" />
                </g>
                <path d="M 77 48 Q 83 42 81 36" stroke="white" className="dark:stroke-neutral-900" strokeWidth="2.5" fill="none" strokeLinecap="round" />
                <circle cx="26" cy="18" r="1.5" fill="#171717" className="dark:fill-neutral-200" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold dark:text-white">Dromadaire</h2>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              Version 7.0
            </p>
            <p className="text-xs text-neutral-400 dark:text-neutral-500">
              Ayi NEDJIMI — INTELLIGENCE PRIVEE
            </p>
          </div>

          {/* Description */}
          <div className="rounded-xl bg-white dark:bg-neutral-800 p-4">
            <p className="text-sm text-neutral-700 dark:text-neutral-300 leading-relaxed">
              Votre assistant IA local et confidentiel.
              Aucune telemetrie, aucune donnee envoyee vers le cloud.
            </p>
          </div>

          {/* Hardware info */}
          <div className="rounded-xl bg-white dark:bg-neutral-800 p-4 space-y-2">
            <h3 className="text-sm font-semibold dark:text-white">
              Materiel d'inference
            </h3>
            <div className="space-y-1.5">
              <div className="flex justify-between text-sm">
                <span className="text-neutral-500 dark:text-neutral-400">Mode</span>
                <span className={`font-medium ${isGPU ? "text-green-600 dark:text-green-400" : "text-neutral-700 dark:text-neutral-300"}`}>
                  {isGPU ? "GPU" : "CPU"}
                </span>
              </div>
              {isGPU && gpuName && (
                <div className="flex justify-between text-sm">
                  <span className="text-neutral-500 dark:text-neutral-400">GPU</span>
                  <span className="font-medium text-neutral-700 dark:text-neutral-300">
                    {gpuName}
                  </span>
                </div>
              )}
              {isGPU && library && (
                <div className="flex justify-between text-sm">
                  <span className="text-neutral-500 dark:text-neutral-400">API</span>
                  <span className="font-medium text-neutral-700 dark:text-neutral-300 uppercase">
                    {library}
                  </span>
                </div>
              )}
              {isGPU && vram && (
                <div className="flex justify-between text-sm">
                  <span className="text-neutral-500 dark:text-neutral-400">VRAM</span>
                  <span className="font-medium text-neutral-700 dark:text-neutral-300">
                    {vram}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Outils */}
          <div className="rounded-xl bg-white dark:bg-neutral-800 p-4 space-y-3">
            <h3 className="text-sm font-semibold dark:text-white">
              Outils
            </h3>
            <div className="flex gap-2">
              <button
                onClick={() => setShowDiagnostic(true)}
                className="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg bg-neutral-100 dark:bg-neutral-700 text-neutral-700 dark:text-neutral-200 hover:bg-neutral-200 dark:hover:bg-neutral-600 transition-colors"
              >
                <Wrench className="w-4 h-4" />
                Diagnostic
              </button>
              <button
                onClick={() => setShowBenchmark(true)}
                className="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg bg-neutral-100 dark:bg-neutral-700 text-neutral-700 dark:text-neutral-200 hover:bg-neutral-200 dark:hover:bg-neutral-600 transition-colors"
              >
                <Gauge className="w-4 h-4" />
                Performance
              </button>
            </div>
          </div>

          {/* Legal */}
          <div className="text-center pt-1 pb-4">
            <a
              href="https://intelligence-privee.fr"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400 hover:underline"
            >
              intelligence-privee.fr
            </a>
          </div>
        </div>
      </div>

      {showDiagnostic && (
        <DiagnosticModal onClose={() => setShowDiagnostic(false)} />
      )}
      {showBenchmark && (
        <BenchmarkModal onClose={() => setShowBenchmark(false)} />
      )}
    </main>
  );
}

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRestartStatus, restartServer } from "@/api";
import { API_BASE } from "@/lib/config";

/**
 * Global banner: shown on every page when a setting (for example the
 * lamazero engine or KV cache) only takes effect after a server restart.
 * The button restarts the server and waits until it answers again.
 */
export function RestartBanner() {
  const queryClient = useQueryClient();
  const [restarting, setRestarting] = useState(false);
  const { data } = useQuery({
    queryKey: ["restart-status"],
    queryFn: getRestartStatus,
    refetchInterval: 5000,
    retry: false,
  });

  // Once the restart is requested, wait for the server to come back.
  useEffect(() => {
    if (!restarting) return;
    let cancelled = false;
    const started = Date.now();
    const poll = async () => {
      while (!cancelled && Date.now() - started < 60000) {
        try {
          const r = await fetch(`${API_BASE}/api/v1/restart-status`);
          if (r.ok) {
            setRestarting(false);
            queryClient.invalidateQueries();
            return;
          }
        } catch {
          // server still down
        }
        await new Promise((res) => setTimeout(res, 1000));
      }
      if (!cancelled) setRestarting(false);
    };
    // Give the old process a moment to stop before polling.
    const t = setTimeout(poll, 1500);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [restarting, queryClient]);

  if (!data?.needed && !restarting) return null;

  const handleRestart = async () => {
    setRestarting(true);
    try {
      await restartServer();
    } catch {
      setRestarting(false);
    }
  };

  return (
    <div
      role="status"
      data-testid="restart-banner"
      className="fixed bottom-4 left-1/2 z-[60] -translate-x-1/2 transform"
    >
      <div className="flex items-center gap-3 rounded-xl bg-amber-500 px-4 py-2 text-white shadow-lg">
        <span className="text-sm font-medium">
          {restarting
            ? "Redémarrage du moteur en cours…"
            : "Réglage du moteur modifié : redémarrer le serveur pour l'appliquer."}
        </span>
        {!restarting && (
          <button
            type="button"
            data-testid="restart-now"
            onClick={handleRestart}
            className="rounded-md bg-white px-3 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50 cursor-pointer"
          >
            Redémarrer maintenant
          </button>
        )}
      </div>
    </div>
  );
}

import { useState, useEffect, useRef } from "react";

interface SystemMetrics {
  memory_used_mb: number;
  memory_total_mb: number;
  memory_percent: number;
  goroutines: number;
  uptime_seconds: number;
  heap_alloc_mb: number;
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${seconds}s`;
}

function memoryColor(percent: number): string {
  if (percent >= 80) return "hsl(0 70% 55%)";
  if (percent >= 50) return "hsl(40 90% 50%)";
  return "hsl(145 60% 42%)";
}

export function SystemMonitor() {
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [error, setError] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchMetrics() {
      try {
        const res = await fetch("/api/v1/system/metrics");
        if (!res.ok) throw new Error("fetch failed");
        const data: SystemMetrics = await res.json();
        if (!cancelled) {
          setMetrics(data);
          setError(false);
        }
      } catch {
        if (!cancelled) setError(true);
      }
    }

    fetchMetrics();
    intervalRef.current = setInterval(fetchMetrics, 5000);

    return () => {
      cancelled = true;
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  if (error && !metrics) {
    return (
      <div className="sys-monitor sys-monitor-err">
        Monitoring indisponible
        <style>{STYLES}</style>
      </div>
    );
  }

  if (!metrics) {
    return (
      <div className="sys-monitor sys-monitor-loading">
        Chargement...
        <style>{STYLES}</style>
      </div>
    );
  }

  const color = memoryColor(metrics.memory_percent);

  return (
    <div className="sys-monitor">
      <div className="sys-monitor-title">
        <span className="sys-monitor-dot" style={{ background: color }} />
        Monitoring serveur
      </div>
      <div className="sys-monitor-grid">
        <div className="sys-monitor-item">
          <span className="sys-monitor-label">Heap Go</span>
          <span className="sys-monitor-value">{metrics.heap_alloc_mb} MB</span>
        </div>
        <div className="sys-monitor-item">
          <span className="sys-monitor-label">Mem process</span>
          <span className="sys-monitor-value" style={{ color }}>
            {metrics.memory_used_mb} MB
          </span>
        </div>
        <div className="sys-monitor-item">
          <span className="sys-monitor-label">Goroutines</span>
          <span className="sys-monitor-value">{metrics.goroutines}</span>
        </div>
        <div className="sys-monitor-item">
          <span className="sys-monitor-label">Uptime</span>
          <span className="sys-monitor-value">{formatUptime(metrics.uptime_seconds)}</span>
        </div>
      </div>
      <div className="sys-monitor-bar-track">
        <div
          className="sys-monitor-bar-fill"
          style={{ width: `${Math.min(metrics.memory_percent, 100)}%`, background: color }}
        />
      </div>
      <div className="sys-monitor-bar-label">
        {metrics.memory_used_mb} / {metrics.memory_total_mb} MB ({metrics.memory_percent.toFixed(1)}%)
      </div>
      <style>{STYLES}</style>
    </div>
  );
}

const STYLES = `
  .sys-monitor {
    margin-top: 12px;
    padding: 10px;
    border-radius: 10px;
    background: var(--ctx-stat-bg, hsl(0 0% 96%));
    font-size: 12px;
  }
  .sys-monitor-err,
  .sys-monitor-loading {
    color: var(--ctx-hint, hsl(0 0% 55%));
    text-align: center;
    padding: 16px 10px;
  }
  .sys-monitor-title {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    color: var(--ctx-label, hsl(0 0% 45%));
    margin-bottom: 8px;
  }
  .sys-monitor-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .sys-monitor-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
  }
  .sys-monitor-item {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .sys-monitor-label {
    font-size: 10px;
    color: var(--ctx-hint, hsl(0 0% 55%));
  }
  .sys-monitor-value {
    font-size: 13px;
    font-weight: 700;
    color: var(--ctx-tab-active-text, hsl(0 0% 10%));
    font-variant-numeric: tabular-nums;
  }
  .sys-monitor-bar-track {
    margin-top: 8px;
    height: 4px;
    border-radius: 2px;
    background: var(--ctx-input-border, hsl(0 0% 88%));
    overflow: hidden;
  }
  .sys-monitor-bar-fill {
    height: 100%;
    border-radius: 2px;
    transition: width 500ms ease, background 500ms ease;
  }
  .sys-monitor-bar-label {
    margin-top: 3px;
    font-size: 10px;
    color: var(--ctx-hint, hsl(0 0% 55%));
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  @media (prefers-color-scheme: dark) {
    .sys-monitor {
      --ctx-stat-bg: hsl(0 0% 15%);
    }
  }
  :root[data-theme="dark"] .sys-monitor {
    --ctx-stat-bg: hsl(0 0% 15%);
  }
`;

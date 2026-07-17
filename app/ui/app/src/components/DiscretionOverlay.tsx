import { useEffect, useState, useCallback } from "react";

/** Fake Windows 11 desktop overlay — "boss key" to hide the app instantly.
 *  Uses a real Windows 11 desktop screenshot as background (/wallpaper.jpg).
 *  The taskbar clock is overlaid with the real current time for realism.
 *  Activated via Ctrl+Shift+H or the discretion button.
 *  Deactivated via Escape ONLY (click does nothing — prevents accidental reveal).
 */
export function DiscretionOverlay({
  active,
  onDeactivate,
}: {
  active: boolean;
  onDeactivate: () => void;
}) {
  const [time, setTime] = useState(() => formatTime());
  const [date, setDate] = useState(() => formatDate());

  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onDeactivate();
      }
      // Swallow ALL other keys so nothing happens in the background
      e.preventDefault();
      e.stopPropagation();
    },
    [onDeactivate],
  );

  useEffect(() => {
    if (!active) return;

    // Update clock every second
    const interval = setInterval(() => {
      setTime(formatTime());
      setDate(formatDate());
    }, 1000);

    // Capture ALL keyboard events
    window.addEventListener("keydown", handleKey, true);

    // Change window title for extra stealth
    const prevTitle = document.title;
    document.title = "";

    // Hide scrollbars
    document.body.style.overflow = "hidden";

    return () => {
      clearInterval(interval);
      window.removeEventListener("keydown", handleKey, true);
      document.title = prevTitle;
      document.body.style.overflow = "";
    };
  }, [active, handleKey]);

  if (!active) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 99999,
        cursor: "default",
        userSelect: "none",
        fontFamily: "'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif",
        WebkitUserSelect: "none",
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Full-screen desktop screenshot */}
      <img
        src="/wallpaper.jpg"
        alt=""
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
        }}
        draggable={false}
      />

      {/* Live clock patch — positioned over the screenshot's clock area.
          Windows 11 taskbar clock is at bottom-right, ~48px tall taskbar.
          We cover just the time/date portion with a matching background. */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          right: 0,
          // Windows 11 taskbar clock area styling
          background: "linear-gradient(180deg, rgba(32,32,32,0.82) 0%, rgba(28,28,28,0.92) 100%)",
          backdropFilter: "blur(20px) saturate(1.8)",
          WebkitBackdropFilter: "blur(20px) saturate(1.8)",
          padding: "4px 16px 6px 18px",
          textAlign: "center",
          lineHeight: 1.35,
          minWidth: 80,
          // Match Windows 11 taskbar height
          height: 48,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <div style={{ color: "rgba(255,255,255,0.95)", fontSize: 12, fontWeight: 400, letterSpacing: 0.2 }}>
          {time}
        </div>
        <div style={{ color: "rgba(255,255,255,0.72)", fontSize: 11, fontWeight: 400, letterSpacing: 0.1 }}>
          {date}
        </div>
      </div>

      {/* Invisible hint — tiny text that blends with the wallpaper */}
      <div
        style={{
          position: "absolute",
          bottom: 52,
          right: 8,
          color: "rgba(0,0,0,0.03)",
          fontSize: 8,
          pointerEvents: "none",
        }}
      >
        Echap
      </div>
    </div>
  );
}

function formatTime(): string {
  const now = new Date();
  return now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

function formatDate(): string {
  const now = new Date();
  return now.toLocaleDateString("fr-FR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

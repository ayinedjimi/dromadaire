import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { getSettings } from "@/api";
import { getAgentColorForModel } from "@/hooks/useAgents";

export const THEMES = [
  "light",
  "dark",
  "oled",
  "sepia",
  "blue-night",
  "nord",
] as const;

export type Theme = (typeof THEMES)[number];

export const THEME_LABELS: Record<Theme, string> = {
  light: "Clair",
  dark: "Sombre",
  oled: "OLED Noir",
  sepia: "Sepia",
  "blue-night": "Nuit Bleue",
  nord: "Nord",
};

// Themes that should also have Tailwind's dark class for dark: variants
const DARK_THEMES: Theme[] = ["dark", "oled", "blue-night", "nord"];

// hex "#rrggbb" -> hue in degrees, for tinting the whole GUI to an agent's color
function hexToHueDeg(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) return 0;
  let hue: number;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  hue *= 60;
  if (hue < 0) hue += 360;
  return hue;
}

/**
 * Applies the theme class on <html> and adds/removes the Tailwind `dark` class.
 * Call once at root level to keep theme synchronized with settings.
 */
export function useTheme() {
  const { data: settingsData } = useQuery({
    queryKey: ["settings"],
    queryFn: getSettings,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const theme = (settingsData?.settings?.Theme || "light") as Theme;
  const selectedModel = settingsData?.settings?.SelectedModel || "";

  useEffect(() => {
    const root = document.documentElement;

    // Anti-FOUC: disable transitions during theme swap (pattern LM Studio)
    root.classList.add("disable-transitions");

    // Remove all theme classes
    THEMES.forEach((t) => root.classList.remove(t));

    // Apply current theme class
    root.classList.add(theme);

    // Toggle Tailwind dark class for dark themes
    if (DARK_THEMES.includes(theme)) {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }

    // Re-enable transitions after paint (double-RAF ensures layout is flushed)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        root.classList.remove("disable-transitions");
      });
    });
  }, [theme]);

  // Tint the whole GUI to the active agent's accent color, if the selected
  // model matches one created in the Agents gallery
  useEffect(() => {
    const root = document.documentElement;
    const color = selectedModel ? getAgentColorForModel(selectedModel) : null;

    if (color) {
      // sepia() alone produces a ~47deg hue; rotate from there to the target
      const rotation = (hexToHueDeg(color) - 47 + 360) % 360;
      root.style.setProperty("--agent-theme-hue", `${rotation}deg`);
      root.classList.add("agent-theme-active");
    } else {
      root.classList.remove("agent-theme-active");
      root.style.removeProperty("--agent-theme-hue");
    }
  }, [selectedModel]);

  return theme;
}

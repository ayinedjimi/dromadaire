import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { getSettings } from "@/api";

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

  return theme;
}

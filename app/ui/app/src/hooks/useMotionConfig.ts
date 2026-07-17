import { useEffect, useState } from "react";

/** Safe matchMedia check — returns false if not available (SSR, test env) */
function getReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Centralized motion preferences hook.
 * Respects the OS-level "prefers-reduced-motion" setting and provides
 * helpers for conditional animation in JS (Framer Motion, inline styles).
 *
 * CSS animations are handled globally via the @media rule in index.css.
 * This hook is for JS-driven animations that need runtime decisions.
 */
export function useMotionConfig() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(getReducedMotion);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = (e: MediaQueryListEvent) =>
      setPrefersReducedMotion(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  return {
    /** true when the OS requests reduced motion */
    prefersReducedMotion,
    /** Duration multiplier: 0 when reduced, 1 otherwise */
    durationScale: prefersReducedMotion ? 0 : 1,
    /** Framer Motion transition preset */
    transition: prefersReducedMotion
      ? { duration: 0 }
      : { duration: 0.2, ease: "easeOut" as const },
  };
}

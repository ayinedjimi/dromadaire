import { useRef, useCallback, useEffect, useMemo, useState } from "react";
import type { Message } from "@/gotypes";

const LATCH_THRESHOLD_PX = 20;
const SCROLL_DURATION_MS = 180;

interface UseMessageAutoscrollOptions {
  messages: Message[];
  isStreaming: boolean;
  chatId: string;
}

interface MessageAutoscrollBehavior {
  handleNewUserMessage: () => void;
  containerRef: React.RefObject<HTMLElement | null>;
  innerRef: React.RefObject<HTMLDivElement | null>;
  spacerHeight: number;
  showScrollBtn: boolean;
  scrollToBottom: () => void;
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export const useMessageAutoscroll = ({
  isStreaming,
  chatId,
}: UseMessageAutoscrollOptions): MessageAutoscrollBehavior => {
  const containerRef = useRef<HTMLElement | null>(null);
  const innerRef = useRef<HTMLDivElement | null>(null);
  const latchedRef = useRef(true);
  const prevChatIdRef = useRef(chatId);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const rafIdRef = useRef<number>(0);
  const isManualScrollRef = useRef(false);

  const smoothScrollToBottom = useCallback((duration = SCROLL_DURATION_MS) => {
    const container = containerRef.current;
    if (!container) return;
    cancelAnimationFrame(rafIdRef.current);

    const target = container.scrollHeight - container.clientHeight;
    const start = container.scrollTop;
    const distance = target - start;
    if (distance <= 0) return;

    if (distance < 4 || duration === 0) {
      container.scrollTop = target;
      return;
    }

    const startTime = performance.now();
    const animate = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      container.scrollTop = start + distance * easeOutCubic(progress);
      if (progress < 1) {
        rafIdRef.current = requestAnimationFrame(animate);
      }
    };
    rafIdRef.current = requestAnimationFrame(animate);
  }, []);

  const scrollToBottom = useCallback(() => {
    smoothScrollToBottom(SCROLL_DURATION_MS);
  }, [smoothScrollToBottom]);

  const snapToBottom = useCallback(() => {
    const container = containerRef.current;
    if (container) {
      cancelAnimationFrame(rafIdRef.current);
      container.scrollTop = container.scrollHeight;
    }
  }, []);

  const handleNewUserMessage = useCallback(() => {
    latchedRef.current = true;
    requestAnimationFrame(() => {
      requestAnimationFrame(snapToBottom);
    });
  }, [snapToBottom]);

  useEffect(() => {
    if (prevChatIdRef.current !== chatId) {
      latchedRef.current = true;
      prevChatIdRef.current = chatId;
      requestAnimationFrame(snapToBottom);
    }
  }, [chatId, snapToBottom]);

  // Scroll event: detect latch/unlatch + show/hide button
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const checkScroll = () => {
      const gap = container.scrollHeight - container.scrollTop - container.clientHeight;
      setShowScrollBtn(gap > 150);
      if (gap <= LATCH_THRESHOLD_PX) {
        latchedRef.current = true;
      }
    };
    container.addEventListener("scroll", checkScroll, { passive: true });
    return () => container.removeEventListener("scroll", checkScroll);
  }, []);

  // Wheel/touch up during streaming: unlatch
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) {
        latchedRef.current = false;
        cancelAnimationFrame(rafIdRef.current);
      }
    };
    let lastTouchY = 0;
    const onTouchStart = (e: TouchEvent) => {
      lastTouchY = e.touches[0]?.clientY ?? 0;
    };
    const onTouchMove = (e: TouchEvent) => {
      const currentY = e.touches[0]?.clientY ?? 0;
      if (currentY > lastTouchY + 10) {
        latchedRef.current = false;
        cancelAnimationFrame(rafIdRef.current);
      }
    };
    container.addEventListener("wheel", onWheel, { passive: true });
    container.addEventListener("touchstart", onTouchStart, { passive: true });
    container.addEventListener("touchmove", onTouchMove, { passive: true });
    return () => {
      container.removeEventListener("wheel", onWheel);
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("touchmove", onTouchMove);
    };
  }, []);

  // Mousedown/mouseup: detect manual scroll drag (pattern LM Studio)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onDown = () => { isManualScrollRef.current = true; };
    const onUp = () => { isManualScrollRef.current = false; };
    container.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);
    return () => {
      container.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  // ResizeObserver on inner content: auto-scroll when content grows while latched
  useEffect(() => {
    const inner = innerRef.current;
    const container = containerRef.current;
    if (!inner || !container) return;

    const observer = new ResizeObserver(() => {
      if (latchedRef.current && !isManualScrollRef.current) {
        // During streaming: instant snap (no animation for every token)
        // After streaming: smooth scroll for final adjustment
        if (isStreaming) {
          container.scrollTop = container.scrollHeight;
        } else {
          smoothScrollToBottom(120);
        }
      }
    });
    observer.observe(inner);
    return () => observer.disconnect();
  }, [isStreaming, smoothScrollToBottom]);

  return useMemo(
    () => ({
      handleNewUserMessage,
      containerRef,
      innerRef,
      spacerHeight: 0,
      showScrollBtn,
      scrollToBottom,
    }),
    [handleNewUserMessage, showScrollBtn, scrollToBottom],
  );
};

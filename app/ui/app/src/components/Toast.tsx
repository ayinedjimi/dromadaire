import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

export interface ToastDetail {
  message: string;
  emoji?: string;
}

export function showToast(detail: ToastDetail) {
  window.dispatchEvent(new CustomEvent<ToastDetail>("dromadaire-toast", { detail }));
}

export function Toast() {
  const [toast, setToast] = useState<ToastDetail | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const handler = (e: Event) => {
      setToast((e as CustomEvent<ToastDetail>).detail);
      clearTimeout(timer);
      timer = setTimeout(() => setToast(null), 3000);
    };
    window.addEventListener("dromadaire-toast", handler);
    return () => {
      window.removeEventListener("dromadaire-toast", handler);
      clearTimeout(timer);
    };
  }, []);

  return (
    <AnimatePresence>
      {toast && (
        <motion.div
          initial={{ opacity: 0, y: 12, x: "-50%" }}
          animate={{ opacity: 1, y: 0, x: "-50%" }}
          exit={{ opacity: 0, y: 8, x: "-50%" }}
          transition={{ duration: 0.18 }}
          className="fixed bottom-6 left-1/2 z-200 flex items-center gap-2 rounded-full border border-zinc-950/10 bg-white px-4 py-2.5 text-sm font-medium text-zinc-800 shadow-xl dark:border-white/10 dark:bg-zinc-800 dark:text-zinc-100"
        >
          {toast.emoji && <span>{toast.emoji}</span>}
          {toast.message}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

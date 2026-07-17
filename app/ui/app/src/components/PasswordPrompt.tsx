import { useState, useRef, useEffect } from "react";
import { Lock } from "@phosphor-icons/react";
import { motion } from "framer-motion";
import { verifyPassword } from "@/api";
import { useMotionConfig } from "@/hooks/useMotionConfig";

interface PasswordPromptProps {
  onSuccess: () => void;
}

export default function PasswordPrompt({ onSuccess }: PasswordPromptProps) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [wiped, setWiped] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { transition } = useMotionConfig();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim() || isLoading) return;

    setIsLoading(true);
    setError(null);

    try {
      const result = await verifyPassword(password);

      if (result.wiped) {
        setWiped(true);
        setPassword("");
        setError(null);
        return;
      }

      if (result.authenticated) {
        onSuccess();
      } else {
        const left = result.attemptsLeft ?? 0;
        setError(
          left > 0
            ? `Mot de passe incorrect. ${left} tentative${left > 1 ? "s" : ""} restante${left > 1 ? "s" : ""}.`
            : "Mot de passe incorrect."
        );
        setPassword("");
        inputRef.current?.focus();
      }
    } catch {
      setError("Erreur de connexion au serveur.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-white dark:bg-neutral-900">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={transition}
        className="w-full max-w-sm px-6"
      >
        <div className="flex flex-col items-center text-center">
          <div className="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mb-6">
            <Lock className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />
          </div>

          <h1 className="text-xl font-semibold text-neutral-800 dark:text-neutral-100 mb-1">
            Dromadaire
          </h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-6">
            Entrez votre mot de passe pour continuer
          </p>

          {wiped && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="w-full mb-4 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 p-3"
            >
              <p className="text-sm text-red-700 dark:text-red-400 font-medium">
                Donnees supprimees
              </p>
              <p className="text-xs text-red-600 dark:text-red-500 mt-1">
                Toutes les conversations et la cle de chiffrement ont ete supprimees apres 3 tentatives echouees.
              </p>
            </motion.div>
          )}

          <form onSubmit={handleSubmit} className="w-full space-y-3">
            <input
              ref={inputRef}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Mot de passe"
              className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-4 py-2.5 text-sm text-neutral-800 dark:text-neutral-200 placeholder-neutral-400 dark:placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 dark:focus:ring-emerald-600"
              autoComplete="current-password"
              disabled={isLoading}
            />

            {error && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-sm text-red-600 dark:text-red-400"
              >
                {error}
              </motion.p>
            )}

            <button
              type="submit"
              disabled={isLoading || !password.trim()}
              className="w-full rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2.5 text-sm font-medium text-white transition-colors"
            >
              {isLoading ? "Verification..." : "Deverrouiller"}
            </button>
          </form>
        </div>
      </motion.div>
    </div>
  );
}

import { forwardRef } from "react";

interface ButtonProps {
  isVisible?: boolean;
  isActive: boolean;
  onToggle: () => void;
}

export const RagButton = forwardRef<HTMLButtonElement, ButtonProps>(
  function RagButton({ isVisible, isActive, onToggle }, ref) {
    if (!isVisible) return null;

    return (
      <button
        ref={ref}
        title={isActive ? "Désactiver les connaissances" : "Activer les connaissances"}
        onClick={onToggle}
        className={`select-none flex items-center justify-center rounded-full h-9 w-9 bg-white dark:bg-neutral-700 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer transition-all whitespace-nowrap border border-transparent ${
          isActive
            ? "text-[rgba(0,115,255,1)] dark:text-[rgba(70,155,255,1)]"
            : "text-neutral-500 dark:text-neutral-400"
        }`}
      >
        {/* Book/document icon */}
        <svg
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25"
          />
        </svg>
      </button>
    );
  },
);

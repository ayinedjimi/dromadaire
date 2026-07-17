import CopyButton from "./CopyButton";
import { GitBranch } from "@phosphor-icons/react";
import React from "react";

export function MessageActions({
  content,
  copyRef,
  isLastAssistantMessage,
  onRegenerate,
  onContinue,
  onDelete,
  onBranch,
}: {
  content: string;
  copyRef: React.RefObject<HTMLElement>;
  isLastAssistantMessage: boolean;
  onRegenerate?: () => void;
  onContinue?: () => void;
  onDelete?: () => void;
  onBranch?: () => void;
}) {
  return (
    <div className="-ml-1 flex items-center gap-0.5 msg-actions-container">
      <CopyButton
        content={content}
        copyRef={copyRef as React.RefObject<HTMLElement>}
        removeClasses={["copy-button"]}
        size="md"
        showLabels={false}
        className="copy-button z-10 text-neutral-500 dark:text-neutral-400"
        title="Copier"
      />
      {onBranch && (
        <button
          type="button"
          onClick={onBranch}
          className="p-1.5 rounded-md text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700/50 transition-colors cursor-pointer btn-press-sm"
          title="Brancher ici" aria-label="Brancher la conversation ici"
        >
          <GitBranch size={16} />
        </button>
      )}
      {onRegenerate && (
        <button
          type="button"
          onClick={onRegenerate}
          className="p-1.5 rounded-md text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700/50 transition-colors cursor-pointer btn-press-sm"
          title="Regenerer" aria-label="Régénérer la réponse"
        >
          <svg width="16" height="16" viewBox="0 0 256 256" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M224 128a96 96 0 0 1-163.88 67.88" stroke="currentColor" strokeWidth="20" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
            <path d="M32 128A96 96 0 0 1 195.88 60.12" stroke="currentColor" strokeWidth="20" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
            <polyline points="224 48 224 96 176 96" stroke="currentColor" strokeWidth="20" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
            <polyline points="32 208 32 160 80 160" stroke="currentColor" strokeWidth="20" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
          </svg>
        </button>
      )}
      {isLastAssistantMessage && onContinue && (
        <button
          type="button"
          onClick={onContinue}
          className="p-1.5 rounded-md text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700/50 transition-colors cursor-pointer btn-press-sm"
          title="Continuer la reponse" aria-label="Continuer la réponse"
        >
          <svg width="16" height="16" viewBox="0 0 256 256" fill="none" xmlns="http://www.w3.org/2000/svg">
            <line x1="128" y1="40" x2="128" y2="216" stroke="currentColor" strokeWidth="20" strokeLinecap="round" strokeLinejoin="round"/>
            <polyline points="56 144 128 216 200 144" stroke="currentColor" strokeWidth="20" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
          </svg>
        </button>
      )}
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          className="p-1.5 rounded-md text-neutral-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors cursor-pointer btn-press-sm"
          title="Supprimer ce message et les suivants" aria-label="Supprimer"
        >
          <svg width="16" height="16" viewBox="0 0 256 256" fill="none" xmlns="http://www.w3.org/2000/svg">
            <line x1="216" y1="60" x2="40" y2="60" stroke="currentColor" strokeWidth="20" strokeLinecap="round" strokeLinejoin="round"/>
            <line x1="104" y1="104" x2="104" y2="168" stroke="currentColor" strokeWidth="20" strokeLinecap="round" strokeLinejoin="round"/>
            <line x1="152" y1="104" x2="152" y2="168" stroke="currentColor" strokeWidth="20" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M200 60v152a8 8 0 0 1-8 8H64a8 8 0 0 1-8-8V60" stroke="currentColor" strokeWidth="20" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
            <path d="M168 60V36a16 16 0 0 0-16-16H104a16 16 0 0 0-16 16v24" stroke="currentColor" strokeWidth="20" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
          </svg>
        </button>
      )}
    </div>
  );
}

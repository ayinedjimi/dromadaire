import { useState } from "react";
import { Terminal, Check, X } from "@phosphor-icons/react";
import { approveToolExecution } from "@/api";

export interface PendingToolApproval {
  command: string;
  toolName: string;
  chatId: string;
}

export function ToolApprovalBlock({
  approval,
  onResolved,
}: {
  approval: PendingToolApproval;
  onResolved: () => void;
}) {
  const [isLoading, setIsLoading] = useState(false);

  const handleApprove = async (approved: boolean) => {
    setIsLoading(true);
    try {
      await approveToolExecution(approval.chatId, approved);
      onResolved();
    } catch (err) {
      console.error("Failed to send tool approval:", err);
      setIsLoading(false);
    }
  };

  return (
    <div className="my-3 rounded-lg border border-amber-300 dark:border-amber-600 bg-amber-50 dark:bg-amber-950/30 p-4 space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium text-amber-800 dark:text-amber-300">
        <Terminal size={16} weight="bold" />
        <span>Approbation requise</span>
      </div>

      <pre className="text-sm font-mono bg-neutral-900 text-green-400 rounded-md p-3 overflow-x-auto whitespace-pre-wrap break-all">
        <code>$ {approval.command}</code>
      </pre>

      <div className="flex gap-2">
        <button
          onClick={() => handleApprove(true)}
          disabled={isLoading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md bg-green-600 hover:bg-green-700 text-white disabled:opacity-50 transition-colors"
        >
          <Check size={14} weight="bold" />
          Exécuter
        </button>
        <button
          onClick={() => handleApprove(false)}
          disabled={isLoading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md bg-neutral-200 dark:bg-neutral-700 hover:bg-neutral-300 dark:hover:bg-neutral-600 text-neutral-800 dark:text-neutral-200 disabled:opacity-50 transition-colors"
        >
          <X size={14} weight="bold" />
          Refuser
        </button>
      </div>
    </div>
  );
}

interface Template {
  label: string;
  icon: string;
  prompt: string;
  mode?: string;
  subMode?: string;
}

const templates: Template[] = [
  { label: "Résumer", icon: "✦", prompt: "Resume le texte suivant en points cles :\n\n" },
  { label: "Traduire", icon: "🌐", prompt: "Traduis le texte suivant en [langue] :\n\n" },
  { label: "Code", icon: "⟨⟩", prompt: "Explique ce code etape par etape :\n\n```\n\n```" },
  { label: "Mail", icon: "✉", prompt: "Ameliore cet email en gardant mon style naturel, corrige les fautes et rends-le plus clair :\n\n", mode: "human", subMode: "email" },
  { label: "Page web", icon: "◈", prompt: "Cree une page web moderne et belle pour ", mode: "ui-ux", subMode: "landing" },
  { label: "Brainstorm", icon: "💡", prompt: "Donne-moi 10 idees creatives pour [sujet]." },
];

export function PromptTemplates({
  onSelectTemplate,
  onModeChange,
}: {
  onSelectTemplate: (prompt: string) => void;
  onModeChange?: (settings: Record<string, string>) => void;
}) {
  return (
    <div className="flex flex-wrap justify-center gap-2 w-full max-w-2xl mx-auto px-4 mb-4">
      {templates.map((t, i) => (
        <button
          key={t.label}
          type="button"
          onClick={() => {
            onSelectTemplate(t.prompt);
            if (t.mode && onModeChange) {
              onModeChange({ ResponseMode: t.mode, HumanSubMode: t.subMode || "" });
            }
          }}
          style={{ animationDelay: `${i * 40}ms` }}
          className="animate-card-enter btn-press flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-all cursor-pointer bg-white dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-750 border border-neutral-200/80 dark:border-neutral-700/60 shadow-[0_1px_2px_rgba(0,0,0,0.04)] dark:shadow-none"
        >
          <span className="text-xs opacity-60">{t.icon}</span>
          {t.label}
        </button>
      ))}
    </div>
  );
}

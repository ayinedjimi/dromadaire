import { useMemo } from "react";

/**
 * Follow-up suggestion chips displayed after the last assistant message.
 * Hybrid approach: parse <<FOLLOWUP: ...>> tags from model if present,
 * otherwise generate contextual suggestions from the conversation content.
 */
export function FollowUpSuggestions({
  assistantMessage,
  onSelect,
}: {
  assistantMessage: string;
  onSelect: (prompt: string) => void;
}) {
  const suggestions = useMemo(
    () => getSuggestions(assistantMessage),
    [assistantMessage],
  );

  if (suggestions.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 mt-3 mb-1">
      {suggestions.map((s, i) => (
        <button
          key={i}
          type="button"
          onClick={() => onSelect(s)}
          className="text-[13px] px-3 py-1.5 rounded-full border border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700/60 hover:border-neutral-300 dark:hover:border-neutral-600 transition-colors cursor-pointer leading-snug"
        >
          {s}
        </button>
      ))}
    </div>
  );
}

function getSuggestions(content: string): string[] {
  // 1. Try parsing <<FOLLOWUP: ...>> tags from model
  const parsed = extractFollowUps(content);
  if (parsed.length > 0) return parsed;

  // 2. Fallback: generate contextual suggestions
  return generateContextual(content);
}

/** Extract <<FOLLOWUP: text>> tags from assistant response */
function extractFollowUps(content: string): string[] {
  const regex = /<<FOLLOWUP:\s*(.+?)>>/g;
  const results: string[] = [];
  let match;
  while ((match = regex.exec(content)) !== null) {
    const text = match[1].trim();
    if (text.length > 3 && text.length < 100) results.push(text);
  }
  return results.slice(0, 3);
}

/** Generate contextual follow-ups based on response content */
function generateContextual(content: string): string[] {
  const c = content.toLowerCase();
  const len = content.length;

  // Too short = likely a clarification or greeting, no follow-up
  if (len < 100) return [];

  const results: string[] = [];

  // --- Detect content patterns ---
  const hasCode = /```[\s\S]{10,}```/.test(content);
  const hasMultipleCodeBlocks = (content.match(/```/g) || []).length >= 4;
  const hasNumberedList = /\n\d+[\.)\s]/.test(content);
  const hasBulletList = (content.match(/\n[-*•]\s/g) || []).length >= 3;
  const hasTable = /\|.*\|.*\|/.test(content) && /[-]{3,}/.test(content);

  // Detect programming languages in code blocks
  const codeBlockLangs = [...content.matchAll(/```(\w+)/g)].map(m => m[1].toLowerCase());
  const hasPython = codeBlockLangs.includes("python") || codeBlockLangs.includes("py");
  const hasJS = codeBlockLangs.includes("javascript") || codeBlockLangs.includes("js") || codeBlockLangs.includes("typescript") || codeBlockLangs.includes("ts");
  const hasSQL = codeBlockLangs.includes("sql");
  const hasHTML = codeBlockLangs.includes("html") || codeBlockLangs.includes("css");
  const hasBash = codeBlockLangs.includes("bash") || codeBlockLangs.includes("sh") || codeBlockLangs.includes("shell");

  // Detect topic patterns
  const hasComparison = c.includes("avantage") || c.includes("inconvénient") || c.includes("inconvenient") ||
    c.includes("différence") || c.includes("difference") || c.includes(" vs ") || c.includes("comparé") || c.includes("compare");
  const hasHowTo = c.includes("étape") || c.includes("etape") || c.includes("d'abord") || c.includes("ensuite") ||
    c.includes("enfin") || c.includes("commencer par") || c.includes("pour commencer");
  const hasError = c.includes("erreur") || c.includes("error") || c.includes("problème") || c.includes("probleme") ||
    c.includes("bug") || c.includes("exception") || c.includes("debug");
  const hasSecurity = c.includes("sécurité") || c.includes("securite") || c.includes("vulnérab") || c.includes("vulnerab") ||
    c.includes("authentif") || c.includes("chiffr") || c.includes("mot de passe") || c.includes("password");
  const hasPerf = c.includes("performance") || c.includes("optimis") || c.includes("rapide") || c.includes("lent") ||
    c.includes("cache") || c.includes("mémoire") || c.includes("memoire");
  const hasAPI = c.includes("api") || c.includes("endpoint") || c.includes("requête") || c.includes("requete") ||
    c.includes("rest") || c.includes("graphql");
  const hasDB = c.includes("base de données") || c.includes("base de donnees") || c.includes("sql") || c.includes("table") ||
    c.includes("requête") || c.includes("migration");
  const hasConcept = c.includes("concept") || c.includes("paradigm") || c.includes("architect") ||
    c.includes("design pattern") || c.includes("principe");
  const hasWarning = c.includes("attention") || c.includes("important") || c.includes("⚠") || c.includes("prudent") ||
    c.includes("risque");
  const hasMath = c.includes("formule") || c.includes("calcul") || c.includes("algorithme") || c.includes("complexité") ||
    c.includes("complexite");
  const hasExplanation = len > 500 && !hasCode;

  // --- Extract specific topics mentioned ---
  // Try to find the main topic being discussed
  const topicHints = extractTopicHints(content);

  // --- Generate contextual suggestions ---

  if (hasCode) {
    if (hasMultipleCodeBlocks) {
      results.push("Combine ces exemples en un code complet");
    }
    if (hasPython) {
      results.push("Ajoute des tests unitaires avec pytest");
    } else if (hasJS) {
      results.push("Ajoute la gestion d'erreurs");
    } else if (hasSQL) {
      results.push("Comment optimiser cette requete ?");
    } else if (hasHTML) {
      results.push("Rends-le responsive");
    } else if (hasBash) {
      results.push("Explique chaque commande");
    } else {
      if (c.includes("function") || c.includes("def ") || c.includes("func ") || c.includes("fn ")) {
        results.push("Comment tester cette fonction ?");
      } else {
        results.push("Ajoute des commentaires au code");
      }
    }
    if (!hasMultipleCodeBlocks) {
      results.push("Montre un exemple d'utilisation");
    }
    if (hasError) {
      results.push("Comment gerer les cas d'erreur ?");
    } else if (hasPerf) {
      results.push("Comment optimiser la performance ?");
    }
  } else if (hasTable) {
    results.push("Quel choix recommandes-tu et pourquoi ?");
    if (topicHints.length > 0) {
      results.push(`Detaille ${topicHints[0]}`);
    } else {
      results.push("Developpe les differences cles");
    }
  } else if (hasComparison) {
    results.push("Lequel recommandes-tu pour mon cas ?");
    results.push("Montre un exemple concret pour chacun");
  } else if (hasHowTo) {
    results.push("Quels sont les pieges a eviter ?");
    if (hasCode || c.includes("code") || c.includes("install") || c.includes("config")) {
      results.push("Montre le code complet");
    } else {
      results.push("Donne un exemple concret");
    }
  } else if (hasError) {
    results.push("Comment corriger cette erreur ?");
    results.push("Comment eviter ce probleme a l'avenir ?");
  } else if (hasSecurity) {
    results.push("Quelles sont les bonnes pratiques ?");
    results.push("Montre une implementation securisee");
  } else if (hasPerf) {
    results.push("Comment mesurer l'amelioration ?");
    results.push("Quels outils utiliser pour profiler ?");
  } else if (hasAPI) {
    results.push("Montre un exemple d'appel");
    results.push("Comment gerer les erreurs API ?");
  } else if (hasDB) {
    results.push("Comment indexer pour la performance ?");
    results.push("Montre le schema complet");
  } else if (hasConcept) {
    results.push("Donne un exemple concret");
    results.push("Quand utiliser ce pattern ?");
  } else if (hasMath) {
    results.push("Montre un exemple avec des chiffres");
    results.push("Quelle est la complexite ?");
  } else if (hasNumberedList || hasBulletList) {
    if ((content.match(/\n\d+[\.)]\s/g) || []).length >= 5) {
      results.push("Resume les 3 points essentiels");
    }
    if (topicHints.length > 0) {
      results.push(`Developpe le point sur ${topicHints[0]}`);
    } else {
      results.push("Developpe le point le plus important");
    }
    results.push("Donne des exemples concrets");
  } else if (hasExplanation) {
    if (hasWarning) {
      results.push("Comment eviter ces risques ?");
    }
    results.push("Peux-tu simplifier l'explication ?");
    results.push("Donne un exemple pratique");
  }

  // Ensure at least 2 suggestions for substantial responses
  if (results.length < 2 && len > 200) {
    if (topicHints.length > 0 && !results.some(r => r.includes(topicHints[0]))) {
      results.push(`En savoir plus sur ${topicHints[0]}`);
    }
    if (!results.some(r => r.includes("exemple"))) {
      results.push("Donne un exemple concret");
    }
    if (results.length < 2 && !results.some(r => r.includes("resumer") || r.includes("simplif"))) {
      results.push("Resume en 3 points cles");
    }
  }

  return results.slice(0, 3);
}

/** Extract topic keywords from bold headers, headings, or emphasized text */
function extractTopicHints(content: string): string[] {
  const hints: string[] = [];

  // Extract from markdown headers (## Title)
  const headers = [...content.matchAll(/^#{1,3}\s+(.+)$/gm)];
  for (const h of headers) {
    const text = h[1].trim().replace(/[*_`#]/g, "").toLowerCase();
    if (text.length > 3 && text.length < 40 && !text.includes("exemple") && !text.includes("conclusion")) {
      hints.push(text);
    }
  }

  // Extract from bold text (**topic**)
  if (hints.length === 0) {
    const bolds = [...content.matchAll(/\*\*(.+?)\*\*/g)];
    for (const b of bolds.slice(0, 5)) {
      const text = b[1].trim().toLowerCase();
      if (text.length > 3 && text.length < 30) {
        hints.push(text);
      }
    }
  }

  // Deduplicate and return top 3
  return [...new Set(hints)].slice(0, 3);
}

/** Strip <<FOLLOWUP: ...>> tags from content before rendering */
export function stripFollowUps(content: string): string {
  return content.replace(/\n*<<FOLLOWUP:\s*.+?>>\n*/g, "").trimEnd();
}

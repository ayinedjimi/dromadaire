import { Message } from "@/gotypes";

/** Basic markdown-to-HTML conversion for the HTML export (inline, no dependencies). */
function basicMarkdownToHtml(text: string): string {
  // Escape HTML entities first
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Code blocks (``` ... ```)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, _lang, code) => {
    return `<pre><code>${code.trim()}</code></pre>`;
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  // Italic
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

  // Line breaks (double newline = paragraph)
  html = html
    .split("\n\n")
    .map((block) => {
      if (block.startsWith("<pre>")) return block;
      return `<p>${block.replace(/\n/g, "<br>")}</p>`;
    })
    .join("");

  return html;
}

export function exportConversation(
  chat: { title: string; created_at: any; messages: Message[] },
  format: "markdown" | "json" | "text" | "html",
): void {
  let content: string;
  let ext: string;
  let mime: string;

  const dateStr = chat.created_at
    ? new Date(chat.created_at).toLocaleString("fr-FR")
    : "";

  switch (format) {
    case "markdown": {
      const lines = [`# ${chat.title || "Conversation"}`, `Date: ${dateStr}`, "---", ""];
      for (const msg of chat.messages) {
        if (msg.role === "user") {
          lines.push(`**Vous:** ${msg.content}`, "");
        } else if (msg.role === "assistant") {
          const modelTag = msg.model ? ` *(${msg.model})*` : "";
          let genTag = "";
          if (msg.genInfo) {
            const tps = msg.genInfo.tokensPerSecond?.toFixed(1);
            if (tps) genTag = ` — ${tps} tok/s`;
          }
          lines.push(`**Assistant${modelTag}:**${genTag} ${msg.content}`, "");
        }
      }

      // --- Statistiques ---
      const userMsgs = chat.messages.filter((m) => m.role === "user");
      const assistantMsgs = chat.messages.filter((m) => m.role === "assistant");
      let totalEvalTokens = 0;
      let totalPromptTokens = 0;
      let totalEvalDurationMs = 0;
      for (const m of assistantMsgs) {
        if (m.genInfo) {
          totalEvalTokens += m.genInfo.evalCount || 0;
          totalPromptTokens += m.genInfo.promptEvalCount || 0;
          totalEvalDurationMs += m.genInfo.evalDurationMs || 0;
        }
      }
      const totalTokens = totalEvalTokens + totalPromptTokens;
      const avgTps =
        totalEvalDurationMs > 0
          ? (totalEvalTokens / (totalEvalDurationMs / 1000)).toFixed(1)
          : null;

      lines.push("---", "", "## Statistiques", "");
      lines.push(`- Messages utilisateur : ${userMsgs.length}`);
      lines.push(`- Messages assistant : ${assistantMsgs.length}`);
      lines.push(`- Tokens totaux estimes : ${totalTokens}`);
      if (totalEvalTokens > 0) {
        lines.push(`  - Tokens generation : ${totalEvalTokens}`);
        lines.push(`  - Tokens prompt : ${totalPromptTokens}`);
      }
      if (avgTps) {
        lines.push(`- Vitesse moyenne : ${avgTps} tok/s`);
      }

      // Duration: use created_at of first and last messages if available
      if (chat.created_at) {
        const firstMsgTime = chat.messages[0]?.created_at;
        const lastMsgTime = chat.messages[chat.messages.length - 1]?.created_at;
        if (firstMsgTime && lastMsgTime) {
          const startMs = new Date(firstMsgTime as any).getTime();
          const endMs = new Date(lastMsgTime as any).getTime();
          if (!isNaN(startMs) && !isNaN(endMs) && endMs > startMs) {
            const durationSec = Math.round((endMs - startMs) / 1000);
            const mins = Math.floor(durationSec / 60);
            const secs = durationSec % 60;
            lines.push(
              `- Duree de la conversation : ${mins > 0 ? `${mins} min ` : ""}${secs} s`,
            );
          }
        }
      }
      lines.push("");

      content = lines.join("\n");
      ext = "md";
      mime = "text/markdown";
      break;
    }
    case "json": {
      content = JSON.stringify(
        {
          title: chat.title,
          created_at: chat.created_at,
          messages: chat.messages.map((m) => ({
            role: m.role,
            content: m.content,
            model: m.model,
            created_at: m.created_at,
            genInfo: m.genInfo,
          })),
        },
        null,
        2,
      );
      ext = "json";
      mime = "application/json";
      break;
    }
    case "text": {
      const lines = [`${chat.title || "Conversation"}`, `Date: ${dateStr}`, "---", ""];
      for (const msg of chat.messages) {
        if (msg.role === "user") {
          lines.push(`Vous: ${msg.content}`, "");
        } else if (msg.role === "assistant") {
          lines.push(`Assistant: ${msg.content}`, "");
        }
      }
      content = lines.join("\n");
      ext = "txt";
      mime = "text/plain";
      break;
    }
    case "html": {
      const title = chat.title || "Conversation";
      const messagesHtml = chat.messages
        .map((msg) => {
          if (msg.role !== "user" && msg.role !== "assistant") return "";

          const isUser = msg.role === "user";
          const roleClass = isUser ? "user" : "assistant";
          const roleLabel = isUser ? "Vous" : "Assistant";

          let metaHtml = "";
          if (!isUser) {
            const parts: string[] = [];
            if (msg.model) parts.push(msg.model);
            if (msg.genInfo?.tokensPerSecond) {
              parts.push(`${msg.genInfo.tokensPerSecond.toFixed(1)} tok/s`);
            }
            if (msg.genInfo?.evalCount) {
              parts.push(`${msg.genInfo.evalCount} tokens`);
            }
            if (parts.length > 0) {
              metaHtml = `<div class="meta">${parts.join(" &middot; ")}</div>`;
            }
          }

          const bodyHtml = basicMarkdownToHtml(msg.content || "");
          return `<div class="message ${roleClass}"><div class="bubble"><div class="role">${roleLabel}</div><div class="content">${bodyHtml}</div>${metaHtml}</div></div>`;
        })
        .join("\n");

      // Stats summary
      const userCount = chat.messages.filter((m) => m.role === "user").length;
      const assistantCount = chat.messages.filter((m) => m.role === "assistant").length;
      let totalTokensHtml = 0;
      for (const m of chat.messages) {
        if (m.genInfo) {
          totalTokensHtml += (m.genInfo.evalCount || 0) + (m.genInfo.promptEvalCount || 0);
        }
      }

      content = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} — Export Dromadaire</title>
<style>
  :root {
    --bg: #ffffff;
    --text: #1a1a1a;
    --user-bg: #dbeafe;
    --user-border: #3b82f6;
    --assistant-bg: #f3f4f6;
    --assistant-border: #9ca3af;
    --meta-color: #6b7280;
    --code-bg: #f1f5f9;
    --pre-bg: #1e293b;
    --pre-text: #e2e8f0;
    --header-bg: #f8fafc;
    --border: #e5e7eb;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0f172a;
      --text: #e2e8f0;
      --user-bg: #1e3a5f;
      --user-border: #3b82f6;
      --assistant-bg: #1e293b;
      --assistant-border: #475569;
      --meta-color: #94a3b8;
      --code-bg: #334155;
      --pre-bg: #0f172a;
      --pre-text: #e2e8f0;
      --header-bg: #1e293b;
      --border: #334155;
    }
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background: var(--bg);
    color: var(--text);
    line-height: 1.6;
    padding: 0;
  }
  .header {
    background: var(--header-bg);
    border-bottom: 1px solid var(--border);
    padding: 24px 32px;
    text-align: center;
  }
  .header h1 {
    font-size: 1.5rem;
    font-weight: 600;
    margin-bottom: 4px;
  }
  .header .date {
    color: var(--meta-color);
    font-size: 0.875rem;
  }
  .header .stats {
    color: var(--meta-color);
    font-size: 0.8rem;
    margin-top: 8px;
  }
  .messages {
    max-width: 800px;
    margin: 0 auto;
    padding: 24px 16px;
  }
  .message {
    display: flex;
    margin-bottom: 16px;
  }
  .message.user {
    justify-content: flex-end;
  }
  .message.assistant {
    justify-content: flex-start;
  }
  .bubble {
    max-width: 85%;
    padding: 12px 16px;
    border-radius: 12px;
    position: relative;
  }
  .message.user .bubble {
    background: var(--user-bg);
    border: 1px solid var(--user-border);
    border-bottom-right-radius: 4px;
  }
  .message.assistant .bubble {
    background: var(--assistant-bg);
    border: 1px solid var(--assistant-border);
    border-bottom-left-radius: 4px;
  }
  .role {
    font-weight: 600;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 4px;
    color: var(--meta-color);
  }
  .content {
    font-size: 0.9375rem;
  }
  .content p {
    margin-bottom: 8px;
  }
  .content p:last-child {
    margin-bottom: 0;
  }
  .content code {
    background: var(--code-bg);
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 0.85em;
    font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
  }
  .content pre {
    background: var(--pre-bg);
    color: var(--pre-text);
    padding: 12px 16px;
    border-radius: 8px;
    overflow-x: auto;
    margin: 8px 0;
  }
  .content pre code {
    background: none;
    padding: 0;
    font-size: 0.85em;
  }
  .meta {
    margin-top: 8px;
    font-size: 0.75rem;
    color: var(--meta-color);
    text-align: right;
  }
  .footer {
    text-align: center;
    padding: 24px;
    color: var(--meta-color);
    font-size: 0.75rem;
    border-top: 1px solid var(--border);
  }
</style>
</head>
<body>
<div class="header">
  <h1>${title}</h1>
  ${dateStr ? `<div class="date">${dateStr}</div>` : ""}
  <div class="stats">${userCount} message${userCount > 1 ? "s" : ""} utilisateur, ${assistantCount} message${assistantCount > 1 ? "s" : ""} assistant${totalTokensHtml > 0 ? ` &middot; ${totalTokensHtml} tokens` : ""}</div>
</div>
<div class="messages">
${messagesHtml}
</div>
<div class="footer">Exporte depuis Dromadaire</div>
</body>
</html>`;
      ext = "html";
      mime = "text/html";
      break;
    }
  }

  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(chat.title || "conversation").replace(/[^a-zA-Z0-9-_ ]/g, "").slice(0, 50)}.${ext}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

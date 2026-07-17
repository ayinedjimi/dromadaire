import { visit } from "unist-util-visit";
import type { Root, RootContent } from "mdast";

/**
 * Remark plugin that parses [N] patterns (where N is a digit) into custom
 * rag-citation nodes. These are separate from browser citations (【N†...】).
 *
 * Only matches standalone [N] patterns (not markdown links [text](url)),
 * where N is 1-9 (single digit).
 */
export default function remarkRAGCitationParser() {
  return (tree: Root) => {
    visit(tree, "text", (node, index, parent) => {
      // Match [N] where N is 1-9, not preceded by ] (to avoid [[N]])
      // and not followed by ( (to avoid markdown links [N](url))
      const regex = /\[(\d{1,2})\](?!\()/g;
      let match;
      let last = 0;
      const pieces: RootContent[] = [];

      while ((match = regex.exec(node.value))) {
        // text before the citation
        if (match.index > last) {
          pieces.push({
            type: "text",
            value: node.value.slice(last, match.index),
          });
        }
        // RAG citation node
        pieces.push({
          // @ts-expect-error: custom type
          type: "rag-citation" as const,
          data: {
            hName: "rag-citation",
            hProperties: {
              index: parseInt(match[1], 10),
            },
          },
        });
        last = match.index + match[0].length;
      }

      // trailing text
      if (last > 0 && last < node.value.length) {
        pieces.push({ type: "text", value: node.value.slice(last) });
      }

      if (pieces.length) {
        parent?.children?.splice(index ?? 0, 1, ...pieces);
        return (index ?? 0) + pieces.length;
      }
    });
  };
}

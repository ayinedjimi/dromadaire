import { describe, it, expect } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkMyDelimiter from "./remarkCitationParser";
import type { Root } from "mdast";

function parse(md: string): Root {
  const processor = unified().use(remarkParse).use(remarkMyDelimiter);
  return processor.runSync(processor.parse(md)) as Root;
}

/** Helper: flatten the children of the first paragraph node */
function paragraphChildren(tree: Root) {
  const para = tree.children.find((n) => n.type === "paragraph");
  return (para as any)?.children ?? [];
}

describe("remarkCitationParser", () => {
  it("parses range citation 【1†L25-L30】 into custom-citation node", () => {
    const tree = parse("【1†L25-L30】");
    const nodes = paragraphChildren(tree);

    expect(nodes).toHaveLength(1);
    expect(nodes[0].type).toBe("custom-citation");
    expect(nodes[0].data.hProperties.cursor).toBe("1");
    expect(nodes[0].data.hProperties.start).toBe("25");
    expect(nodes[0].data.hProperties.end).toBe("30");
  });

  it("parses generic citation 【3†source.pdf】 with cursor only (no range)", () => {
    const tree = parse("【3†source.pdf】");
    const nodes = paragraphChildren(tree);

    expect(nodes).toHaveLength(1);
    expect(nodes[0].type).toBe("custom-citation");
    expect(nodes[0].data.hProperties.cursor).toBe("3");
    expect(nodes[0].data.hProperties.start).toBeUndefined();
    expect(nodes[0].data.hProperties.end).toBeUndefined();
  });

  it("splits mixed text into text + citation + text nodes", () => {
    const tree = parse("Voici la réponse【1†L5-L10】 suite");
    const nodes = paragraphChildren(tree);

    expect(nodes).toHaveLength(3);
    expect(nodes[0].type).toBe("text");
    expect(nodes[0].value).toBe("Voici la réponse");
    expect(nodes[1].type).toBe("custom-citation");
    expect(nodes[1].data.hProperties.cursor).toBe("1");
    expect(nodes[1].data.hProperties.start).toBe("5");
    expect(nodes[1].data.hProperties.end).toBe("10");
    expect(nodes[2].type).toBe("text");
    expect(nodes[2].value).toBe(" suite");
  });

  it("leaves tree unchanged when there are no citations", () => {
    const tree = parse("Just some normal text without citations.");
    const nodes = paragraphChildren(tree);

    expect(nodes).toHaveLength(1);
    expect(nodes[0].type).toBe("text");
    expect(nodes[0].value).toBe("Just some normal text without citations.");
  });

  it("handles special characters in surrounding text", () => {
    const tree = parse("Résultat: <foo> & 'bar'【2†L1-L3】fin!");
    const nodes = paragraphChildren(tree);

    // The text before should contain the special characters
    const textBefore = nodes.find(
      (n: any) => n.type === "text" && n.value.includes("Résultat"),
    );
    expect(textBefore).toBeDefined();

    const citation = nodes.find((n: any) => n.type === "custom-citation");
    expect(citation).toBeDefined();
    expect(citation.data.hProperties.cursor).toBe("2");
  });

  it("deduplicates adjacent citations with the same cursor", () => {
    const tree = parse("【1†L1-L5】【1†source.pdf】");
    const nodes = paragraphChildren(tree);

    // Both have cursor=1, so the second pass should remove the duplicate
    const citations = nodes.filter((n: any) => n.type === "custom-citation");
    expect(citations).toHaveLength(1);
    expect(citations[0].data.hProperties.cursor).toBe("1");
  });
});

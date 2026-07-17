import { describe, it, expect } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkRAGCitationParser from "./remarkRAGCitationParser";
import type { Root, Paragraph } from "mdast";

/** Parse markdown and apply the RAG citation plugin, returning the AST */
function parse(markdown: string): Root {
  const tree = unified().use(remarkParse).parse(markdown);
  // Apply the plugin (it returns a transformer function)
  const transformer = remarkRAGCitationParser();
  transformer(tree);
  return tree;
}

/** Get the children of the first paragraph node */
function firstParagraphChildren(tree: Root) {
  const para = tree.children[0] as Paragraph;
  return para?.children ?? [];
}

describe("remarkRAGCitationParser", () => {
  it("parses a single digit citation [1]", () => {
    const tree = parse("See source [1] for details");
    const children = firstParagraphChildren(tree);

    expect(children.length).toBe(3);
    expect(children[0]).toMatchObject({ type: "text", value: "See source " });
    expect(children[1]).toMatchObject({
      type: "rag-citation",
      data: { hName: "rag-citation", hProperties: { index: 1 } },
    });
    expect(children[2]).toMatchObject({ type: "text", value: " for details" });
  });

  it("parses a double digit citation [12]", () => {
    const tree = parse("Ref [12] here");
    const children = firstParagraphChildren(tree);

    const citation = children.find((c: any) => c.type === "rag-citation");
    expect(citation).toBeDefined();
    expect((citation as any).data.hProperties.index).toBe(12);
  });

  it("parses multiple citations in one text", () => {
    const tree = parse("Sources [1] and [2] agree");
    const children = firstParagraphChildren(tree);

    const citations = children.filter((c: any) => c.type === "rag-citation");
    expect(citations.length).toBe(2);
    expect((citations[0] as any).data.hProperties.index).toBe(1);
    expect((citations[1] as any).data.hProperties.index).toBe(2);
  });

  it("does NOT match markdown links [1](url)", () => {
    const tree = parse("Click [1](http://example.com) here");
    const children = firstParagraphChildren(tree);

    // Should be a normal link, not a rag-citation
    const citations = children.filter((c: any) => c.type === "rag-citation");
    expect(citations.length).toBe(0);

    const links = children.filter((c: any) => c.type === "link");
    expect(links.length).toBe(1);
  });

  it("preserves text before and after citations", () => {
    const tree = parse("Before [3] after");
    const children = firstParagraphChildren(tree);

    expect(children[0]).toMatchObject({ type: "text", value: "Before " });
    expect(children[2]).toMatchObject({ type: "text", value: " after" });
  });

  it("handles adjacent citations [1][2]", () => {
    const tree = parse("Data [1][2] end");
    const children = firstParagraphChildren(tree);

    const citations = children.filter((c: any) => c.type === "rag-citation");
    expect(citations.length).toBe(2);
    expect((citations[0] as any).data.hProperties.index).toBe(1);
    expect((citations[1] as any).data.hProperties.index).toBe(2);
  });

  it("does NOT match non-numeric brackets [abc]", () => {
    const tree = parse("See [abc] for info");
    const children = firstParagraphChildren(tree);

    const citations = children.filter((c: any) => c.type === "rag-citation");
    expect(citations.length).toBe(0);
  });

  it("handles plain text without citations", () => {
    const tree = parse("No citations here");
    const children = firstParagraphChildren(tree);

    // Should remain a single text node
    expect(children.length).toBe(1);
    expect(children[0]).toMatchObject({ type: "text", value: "No citations here" });
  });
});

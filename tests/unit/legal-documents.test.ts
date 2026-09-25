import { describe, expect, it } from "vitest";
import {
  LEGAL_SLUGS,
  getLegalDocument,
  parseInlines,
  parseLegalMarkdown,
  type LegalBlock,
  type LegalInline,
} from "@/lib/legal/documents";

function collectInlines(blocks: LegalBlock[]): LegalInline[] {
  const out: LegalInline[] = [];
  const takeAll = (groups: LegalInline[][]) => {
    for (const group of groups) out.push(...group);
  };
  for (const block of blocks) {
    if (block.kind === "paragraph") takeAll(block.lines);
    if (block.kind === "list") takeAll(block.items);
    if (block.kind === "table") {
      takeAll(block.header);
      for (const row of block.rows) takeAll(row);
    }
  }
  return out;
}

describe("legal document sources", () => {
  it("parses all three approved documents without unsupported constructs", () => {
    for (const slug of LEGAL_SLUGS) {
      const doc = getLegalDocument(slug);
      expect(doc.slug).toBe(slug);
      expect(doc.blocks[0]).toEqual({ kind: "h1", text: expect.stringContaining("AVTOSH.AZ") });
      expect(doc.blocks.some((b) => b.kind === "h2")).toBe(true);
    }
  });

  it("extracts the approved version and update date from each document", () => {
    for (const slug of LEGAL_SLUGS) {
      const doc = getLegalDocument(slug);
      expect(doc.version).toBe("1.2");
      expect(doc.updatedAt).toBe("25.09.2026");
      expect(doc.title).not.toContain("AVTOSH.AZ");
      expect(doc.title.length).toBeGreaterThan(0);
    }
  });

  it("keeps the two data tables of the privacy policy", () => {
    const doc = getLegalDocument("mexfilik-siyaseti");
    const tables = doc.blocks.filter((b) => b.kind === "table");
    expect(tables).toHaveLength(2);
    for (const table of tables) {
      expect(table.header.length).toBeGreaterThan(1);
      expect(table.rows.length).toBeGreaterThan(0);
      for (const row of table.rows) {
        expect(row).toHaveLength(table.header.length);
      }
    }
  });

  it("cross-links every legal route from the documents", () => {
    const hrefs = new Set(
      LEGAL_SLUGS.flatMap((slug) =>
        collectInlines(getLegalDocument(slug).blocks)
          .filter((p) => p.kind === "link")
          .map((p) => (p.kind === "link" ? p.href : "")),
      ),
    );
    expect(hrefs).toContain("/istifadeci-razilasmasi");
    expect(hrefs).toContain("/qaydalar");
    expect(hrefs).toContain("/mexfilik-siyaseti");
  });

  it("contains no unresolved placeholder tokens", () => {
    for (const slug of LEGAL_SLUGS) {
      for (const part of collectInlines(getLegalDocument(slug).blocks)) {
        expect(part.text).not.toMatch(/TODO|TBD|\{\{|\bXXX\b|lorem ipsum/i);
      }
    }
  });
});

describe("parseLegalMarkdown guard rails", () => {
  it("rejects heading depths outside the approved grammar", () => {
    expect(() => parseLegalMarkdown("### deep heading", "test")).toThrow(/unsupported heading depth/);
  });

  it("rejects blockquotes, star lists and true ordered lists", () => {
    expect(() => parseLegalMarkdown("> quoted", "test")).toThrow(/unsupported Markdown construct/);
    expect(() => parseLegalMarkdown("* star item", "test")).toThrow(/unsupported Markdown construct/);
    expect(() => parseLegalMarkdown("1. ordered item", "test")).toThrow(/unsupported Markdown construct/);
  });

  it("throws on a malformed heading instead of looping forever", () => {
    // Regression: "#unspaced" matched no branch and the paragraph loop
    // consumed zero lines, so the parser spun at the same index.
    expect(() => parseLegalMarkdown("#unspaced", "test")).toThrow(/malformed heading at line 1/);
    expect(() => parseLegalMarkdown("Adi bir abzas.\n\n#unspaced", "test")).toThrow(
      /malformed heading at line 3/,
    );
    expect(() => parseLegalMarkdown("##also-unspaced", "test")).toThrow(/malformed heading/);
  });

  it("rejects tables without a delimiter row", () => {
    expect(() => parseLegalMarkdown("| a | b |\n| 1 | 2 |", "test")).toThrow(/no delimiter row/);
  });

  it("treats numbered clauses like 1.1. as plain paragraph text", () => {
    const blocks = parseLegalMarkdown("1.1. Bu bir bənddir.", "test");
    expect(blocks).toEqual([
      { kind: "paragraph", lines: [[{ kind: "text", text: "1.1. Bu bir bənddir." }]] },
    ]);
  });
});

describe("parseInlines", () => {
  it("tokenizes bold, links and code spans", () => {
    expect(parseInlines("**Versiya:** 1.2 — [Qaydalar](/qaydalar) və `https://avtosh.az/`")).toEqual([
      { kind: "bold", text: "Versiya:" },
      { kind: "text", text: " 1.2 — " },
      { kind: "link", text: "Qaydalar", href: "/qaydalar" },
      { kind: "text", text: " və " },
      { kind: "code", text: "https://avtosh.az/" },
    ]);
  });
});

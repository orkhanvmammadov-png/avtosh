import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Legal document source of truth: the approved Markdown files under
 * content/legal/ (editorial text, never paraphrased in code). This
 * module parses exactly the constructs those documents use — h1/h2
 * headings, paragraphs with bold/link/code inlines, unordered lists
 * and GFM tables — and THROWS on anything else, so an unsupported
 * edit to the legal copy fails the build instead of rendering wrong.
 */

export type LegalInline =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; text: string; href: string };

export type LegalBlock =
  | { kind: "h1"; text: string }
  | { kind: "h2"; text: string }
  | { kind: "paragraph"; lines: LegalInline[][] }
  | { kind: "list"; items: LegalInline[][] }
  | { kind: "table"; header: LegalInline[][]; rows: LegalInline[][][] };

export interface LegalDocument {
  slug: string;
  /** H1 text without the site prefix, e.g. "İstifadəçi razılaşması". */
  title: string;
  version: string;
  updatedAt: string;
  blocks: LegalBlock[];
}

export const LEGAL_SLUGS = [
  "istifadeci-razilasmasi",
  "qaydalar",
  "mexfilik-siyaseti",
] as const;
export type LegalSlug = (typeof LEGAL_SLUGS)[number];

const INLINE = /(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)|`[^`]+`)/g;

export function parseInlines(text: string): LegalInline[] {
  const out: LegalInline[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    if (match.index! > last) {
      out.push({ kind: "text", text: text.slice(last, match.index) });
    }
    const token = match[0];
    if (token.startsWith("**")) {
      out.push({ kind: "bold", text: token.slice(2, -2) });
    } else if (token.startsWith("`")) {
      out.push({ kind: "code", text: token.slice(1, -1) });
    } else {
      const m = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token)!;
      out.push({ kind: "link", text: m[1], href: m[2] });
    }
    last = match.index! + token.length;
  }
  if (last < text.length) {
    out.push({ kind: "text", text: text.slice(last) });
  }
  return out;
}

function parseTableRow(line: string): LegalInline[][] {
  return line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => parseInlines(cell.trim()));
}

export function parseLegalMarkdown(source: string, slug: string): LegalBlock[] {
  const blocks: LegalBlock[] = [];
  const lines = source.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === "") {
      i += 1;
      continue;
    }
    if (/^#{3,} /.test(line)) {
      throw new Error(`${slug}: unsupported heading depth at line ${i + 1}`);
    }
    if (line.startsWith("## ")) {
      blocks.push({ kind: "h2", text: line.slice(3).trim() });
      i += 1;
    } else if (line.startsWith("# ")) {
      blocks.push({ kind: "h1", text: line.slice(2).trim() });
      i += 1;
    } else if (line.startsWith("|")) {
      const header = parseTableRow(line);
      if (!/^\|[\s:|-]+\|$/.test(lines[i + 1] ?? "")) {
        throw new Error(`${slug}: table at line ${i + 1} has no delimiter row`);
      }
      i += 2;
      const rows: LegalInline[][][] = [];
      while (i < lines.length && lines[i].startsWith("|")) {
        rows.push(parseTableRow(lines[i]));
        i += 1;
      }
      blocks.push({ kind: "table", header, rows });
    } else if (line.startsWith("- ")) {
      const items: LegalInline[][] = [];
      while (i < lines.length && lines[i].startsWith("- ")) {
        items.push(parseInlines(lines[i].slice(2).trim()));
        i += 1;
      }
      blocks.push({ kind: "list", items });
    } else if (/^(#{3,} |> |\* |\d+\. )/.test(trimmed)) {
      // h3+, blockquotes, star lists and true ordered lists are not part
      // of the approved documents' grammar (clauses like "1.1." are
      // plain paragraph text and do not match `1. `).
      throw new Error(`${slug}: unsupported Markdown construct at line ${i + 1}: ${trimmed.slice(0, 40)}`);
    } else {
      // Paragraph: consecutive non-empty plain lines; a trailing double
      // space in the source means an intentional line break (the
      // version/date header block uses this).
      const paraLines: LegalInline[][] = [];
      while (
        i < lines.length &&
        lines[i].trim() !== "" &&
        !lines[i].startsWith("#") &&
        !lines[i].startsWith("|") &&
        !lines[i].startsWith("- ")
      ) {
        paraLines.push(parseInlines(lines[i].replace(/\s+$/, "")));
        i += 1;
      }
      blocks.push({ kind: "paragraph", lines: paraLines });
    }
  }
  return blocks;
}

function requireMeta(blocks: LegalBlock[], slug: string): { title: string; version: string; updatedAt: string } {
  const h1 = blocks[0];
  if (h1?.kind !== "h1") {
    throw new Error(`${slug}: document must start with an H1 title`);
  }
  const title = h1.text.replace(/^AVTOSH\.AZ\s+—\s+/, "");
  const meta = blocks[1];
  let version = "";
  let updatedAt = "";
  if (meta?.kind === "paragraph") {
    for (const lineInlines of meta.lines) {
      const bold = lineInlines.find((p) => p.kind === "bold");
      const text = lineInlines
        .filter((p) => p.kind === "text")
        .map((p) => p.text)
        .join("")
        .trim();
      if (bold?.text.startsWith("Versiya")) version = text;
      if (bold?.text.startsWith("Son yenilənmə")) updatedAt = text;
    }
  }
  if (version === "" || updatedAt === "") {
    throw new Error(`${slug}: version/updated-at header block missing`);
  }
  return { title, version, updatedAt };
}

const cache = new Map<string, LegalDocument>();

export function getLegalDocument(slug: LegalSlug): LegalDocument {
  const cached = cache.get(slug);
  if (cached !== undefined) {
    return cached;
  }
  const file = path.join(process.cwd(), "content", "legal", `${slug}.md`);
  const blocks = parseLegalMarkdown(readFileSync(file, "utf8"), slug);
  const { title, version, updatedAt } = requireMeta(blocks, slug);
  const doc: LegalDocument = { slug, title, version, updatedAt, blocks };
  cache.set(slug, doc);
  return doc;
}

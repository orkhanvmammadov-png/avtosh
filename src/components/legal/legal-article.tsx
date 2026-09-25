import Link from "next/link";
import type { LegalBlock, LegalDocument, LegalInline } from "@/lib/legal/documents";

/**
 * Renders an approved legal document (parsed server-side from the
 * repository Markdown source) with the design-system typography.
 * Purely presentational — the editorial text is never altered here.
 */

function Inlines({ parts }: { parts: LegalInline[] }) {
  return (
    <>
      {parts.map((part, i) => {
        if (part.kind === "bold") {
          return (
            <strong key={i} className="font-semibold text-ink">
              {part.text}
            </strong>
          );
        }
        if (part.kind === "code") {
          return (
            <code key={i} className="rounded bg-sunken px-1 py-0.5 text-[0.85em] text-ink">
              {part.text}
            </code>
          );
        }
        if (part.kind === "link") {
          return (
            <Link key={i} href={part.href} className="font-medium text-primary underline underline-offset-2 hover:text-primary/80">
              {part.text}
            </Link>
          );
        }
        return <span key={i}>{part.text}</span>;
      })}
    </>
  );
}

function Block({ block }: { block: LegalBlock }) {
  switch (block.kind) {
    case "h1":
      return <h1 className="text-2xl font-bold tracking-tight text-ink">{block.text}</h1>;
    case "h2":
      return <h2 className="mt-10 text-lg font-bold text-ink">{block.text}</h2>;
    case "paragraph":
      return (
        <p className="mt-4 text-sm leading-relaxed text-slate-strong">
          {block.lines.map((lineParts, i) => (
            <span key={i}>
              {i > 0 ? <br /> : null}
              <Inlines parts={lineParts} />
            </span>
          ))}
        </p>
      );
    case "list":
      return (
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-slate-strong">
          {block.items.map((item, i) => (
            <li key={i}>
              <Inlines parts={item} />
            </li>
          ))}
        </ul>
      );
    case "table":
      return (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead>
              <tr>
                {block.header.map((cell, i) => (
                  <th
                    key={i}
                    scope="col"
                    className="border border-line bg-sunken px-3 py-2 text-left align-top font-semibold text-ink"
                  >
                    <Inlines parts={cell} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c} className="border border-line px-3 py-2 align-top leading-relaxed text-slate-strong">
                      <Inlines parts={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

export function LegalArticle({ document }: { document: LegalDocument }) {
  return (
    <article className="mx-auto max-w-3xl" data-testid={`legal-${document.slug}`}>
      {document.blocks.map((block, i) => (
        <Block key={i} block={block} />
      ))}
    </article>
  );
}

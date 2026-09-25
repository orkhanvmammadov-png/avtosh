import type { Metadata } from "next";
import { LegalArticle } from "@/components/legal/legal-article";
import { Container } from "@/components/ui/container";
import { getLegalDocument } from "@/lib/legal/documents";

export const metadata: Metadata = {
  title: "İstifadəçi razılaşması",
  description: "AVTOSH.AZ platformasının istifadə şərtləri.",
};

/** Public legal page rendered from the approved repository Markdown source. */
export default function Page() {
  const document = getLegalDocument("istifadeci-razilasmasi");
  return (
    <Container className="py-10">
      <LegalArticle document={document} />
    </Container>
  );
}

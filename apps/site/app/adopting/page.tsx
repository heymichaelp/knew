import type { Metadata } from "next";

import { DocBody, DocHeader } from "@/components/site/page-shell";
import { headingsOf, packageManifest, readShipped, renderMarkdown } from "@/lib/package-docs";

export const metadata: Metadata = {
  title: "Adopting the engine",
  description: "The guide: define, write, read, test. Rendered from the package's ADOPTING.md.",
};

export default function AdoptingPage() {
  const markdown = readShipped("ADOPTING.md");
  const headings = headingsOf(markdown);
  const html = renderMarkdown(markdown, { dropTitle: true });

  return (
    <>
      <DocHeader
        clause="The guide"
        title="Adopting the engine"
        standfirst="The package's ADOPTING.md, read from the installed tarball at build time."
        aside={
          <p className="stamp">
            <span>as shipped in</span>
            <span>{packageManifest.version}</span>
          </p>
        }
      />
      <DocBody headings={headings}>
        <article className="prose" dangerouslySetInnerHTML={{ __html: html }} />
      </DocBody>
    </>
  );
}

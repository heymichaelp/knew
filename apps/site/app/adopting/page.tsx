import type { Metadata } from "next";

import { DocBody, DocHeader } from "@/components/site/page-shell";
import { headingsOf, packageManifest, readShipped, renderMarkdown } from "@/lib/package-docs";

export const metadata: Metadata = {
  title: "Adopting the engine",
  description: "The guide a client follows, rendered from the package's own ADOPTING.md.",
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
        standfirst="How a client takes knew on, in the order the questions come up. This page is the package's own ADOPTING.md, read out of the installed tarball at build time — so it cannot describe a version that was never shipped."
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

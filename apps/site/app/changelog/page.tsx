import type { Metadata } from "next";

import { DocBody, DocHeader } from "@/components/site/page-shell";
import { headingsOf, packageManifest, readShipped, renderMarkdown } from "@/lib/package-docs";

export const metadata: Metadata = {
  title: "Changelog",
  description: "What each release changed, and the rule that decides the next version number.",
};

export default function ChangelogPage() {
  const markdown = readShipped("CHANGELOG.md");
  const headings = headingsOf(markdown);
  const html = renderMarkdown(markdown, { dropTitle: true });

  return (
    <>
      <DocHeader
        clause="Releases"
        title="Changelog"
        standfirst="The package's own CHANGELOG.md. Before 1.0 a minor may break; from 1.0 a lens-schema change that keeps registered lenses valid is a minor, and a change to the contract is a major."
        aside={
          <p className="stamp">
            <span>latest</span>
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

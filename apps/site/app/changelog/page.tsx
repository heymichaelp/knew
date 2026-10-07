import type { Metadata } from "next";

import { DocBody, DocHeader } from "@/components/site/page-shell";
import { headingsOf, packageManifest, readShipped, renderMarkdown } from "@/lib/package-docs";

export const metadata: Metadata = {
  title: "Changelog",
  description: "What each release changed.",
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
        standfirst="The package's CHANGELOG.md, read from the installed tarball at build time."
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

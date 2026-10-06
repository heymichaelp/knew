import Link from "next/link";
import type { ReactNode } from "react";

import type { Heading } from "@/lib/package-docs";

/**
 * Every page but the front one is a document: a clause number in the margin, a
 * title, a standfirst, and — where the body is long — its own contents list
 * pinned in the margin beside it.
 */
export function DocHeader({
  clause,
  title,
  standfirst,
  aside,
}: {
  readonly clause: string;
  readonly title: string;
  readonly standfirst: string;
  readonly aside?: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-6xl px-6 pt-16 pb-10 sm:pt-24">
      <p className="clause rise">{clause}</p>
      <div className="mt-4 grid gap-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div>
          <h1 className="display rise text-title">{title}</h1>
          <p className="measure rise mt-5 text-lg text-ink-soft" style={{ animationDelay: "80ms" }}>
            {standfirst}
          </p>
        </div>
        {aside ? <div className="press">{aside}</div> : null}
      </div>
    </div>
  );
}

export function Contents({ headings }: { readonly headings: Heading[] }) {
  if (headings.length === 0) return null;
  return (
    <nav aria-label="On this page" className="lg:sticky lg:top-24">
      <p className="label">On this page</p>
      <ol className="mt-3 space-y-1.5">
        {headings
          .filter((h) => h.level === 2)
          .map((heading) => (
            <li key={heading.id}>
              <a
                href={`#${heading.id}`}
                className="block text-sm leading-snug text-ink-soft no-underline transition-colors hover:text-stamp"
              >
                {heading.text}
              </a>
            </li>
          ))}
      </ol>
    </nav>
  );
}

/** A document body with its contents list in the margin. */
export function DocBody({ headings, children }: { readonly headings: Heading[]; readonly children: ReactNode }) {
  return (
    <div className="mx-auto grid max-w-6xl gap-12 px-6 pb-8 lg:grid-cols-[14rem_minmax(0,1fr)]">
      <div className="order-2 lg:order-1">
        <Contents headings={headings} />
      </div>
      <div className="order-1 min-w-0 lg:order-2">{children}</div>
    </div>
  );
}

export function Section({
  clause,
  title,
  children,
}: {
  readonly clause: string;
  readonly title: string;
  readonly children: ReactNode;
}) {
  const id = title.toLowerCase().replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-");
  return (
    <section id={id} className="rule-t pt-10">
      <p className="clause">{clause}</p>
      <h2 className="display mt-2 text-3xl">{title}</h2>
      <div className="mt-6">{children}</div>
    </section>
  );
}

/** A link in running text: ink, underlined in the stamp's colour, as the shipped docs' links are. */
export function TextLink({ href, children }: { readonly href: string; readonly children: ReactNode }) {
  return (
    <Link href={href} className="text-ink underline decoration-stamp decoration-1 underline-offset-4 hover:text-stamp">
      {children}
    </Link>
  );
}

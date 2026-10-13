import Link from "next/link";

import { packageManifest } from "@/lib/package-docs";

import { Mark } from "./mark";
import { Wordmark } from "./wordmark";

export const NAV = [
  { href: "/lenses", label: "Lenses" },
  { href: "/presets", label: "Presets" },
  { href: "/sandbox", label: "Sandbox" },
  { href: "/adopting", label: "Adopting" },
  { href: "/api", label: "The API" },
  { href: "/contract", label: "The contract" },
  { href: "/privacy", label: "Privacy" },
  { href: "/changelog", label: "Changelog" },
] as const;

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-rule bg-paper/88 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl flex-wrap items-baseline gap-x-6 gap-y-2 px-6 py-3.5">
        <Link href="/" aria-label="knew, home" className="flex items-center gap-2 self-center text-ink no-underline">
          <Mark className="size-6 shrink-0" />
          <Wordmark className="text-2xl" />
        </Link>
        <nav className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-sm text-ink-soft no-underline transition-colors hover:text-stamp"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <a
          href="https://www.npmjs.com/package/@popjoker/knew"
          className="label ml-auto no-underline transition-colors hover:text-stamp"
        >
          {packageManifest.name} {packageManifest.version}
        </a>
      </div>
    </header>
  );
}

/** The quiet links at the foot of the home page's drawer. */
export const DRAWER_FOOTER = [
  { href: "https://www.npmjs.com/package/@popjoker/knew", label: `${packageManifest.name} ${packageManifest.version}` },
  { href: "https://github.com/heymichaelp/knew", label: "GitHub" },
];

export function SiteFooter() {
  return (
    <footer className="mt-28 border-t border-rule">
      <div className="mx-auto grid max-w-6xl gap-8 px-6 py-12 sm:grid-cols-[1fr_auto]">
        <div className="measure">
          <p className="flex items-center gap-2.5">
            <Mark className="size-7 shrink-0" />
            <Wordmark className="text-3xl" />
          </p>
          <p className="mt-3 text-sm text-ink-soft">
            The relationship engine. {packageManifest.license}-licensed, {packageManifest.version}, by invitation.
            Its core ships no vocabulary or lens of its own.
          </p>
        </div>
        <div className="flex flex-col gap-2 text-sm sm:text-right">
          <a href="https://www.npmjs.com/package/@popjoker/knew" className="text-ink-soft no-underline hover:text-stamp">
            npm
          </a>
          <a href="https://github.com/heymichaelp/knew" className="text-ink-soft no-underline hover:text-stamp">
            GitHub
          </a>
          <Link href="/privacy" className="text-ink-soft no-underline hover:text-stamp">
            What it will not do
          </Link>
        </div>
      </div>
    </footer>
  );
}

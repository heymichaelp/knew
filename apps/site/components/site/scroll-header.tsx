"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { Mark } from "./mark";
import { Wordmark } from "./wordmark";

export interface NavItem {
  readonly href: string;
  readonly label: string;
}

/**
 * The home page's header, after knewpeople's. The page opens with the mark in
 * the middle of the screen, so at the top there is only the menu, at the right. Once the
 * opening has been scrolled past, the header slides in behind it: the name at the left,
 * the menu where it was. The menu opens a drawer from the right with every page.
 */
export function ScrollHeader({ nav, footer }: { readonly nav: readonly NavItem[]; readonly footer: readonly NavItem[] }) {
  const [shown, setShown] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // Past most of the first screen: the opening is behind you.
    const onScroll = () => setShown(window.scrollY > window.innerHeight * 0.6);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [open]);

  return (
    <>
      {/* The menu over the opening, before the header has arrived: where the header's will be. */}
      <div className="pointer-events-none fixed inset-x-0 top-0 z-40">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-end px-6">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Menu"
            aria-expanded={open}
            tabIndex={shown ? -1 : 0}
            className={`-mr-2.5 flex size-11 items-center justify-center rounded-md text-ink transition-opacity duration-300 hover:bg-paper-sunken ${shown || open ? "opacity-0" : "pointer-events-auto opacity-100"}`}
          >
            <Menu className="size-6" strokeWidth={2} />
          </button>
        </div>
      </div>
      <header
        aria-hidden={!shown && !open}
        className={`fixed inset-x-0 top-0 z-40 border-b border-rule bg-paper/90 backdrop-blur transition-transform duration-300 ${shown || open ? "translate-y-0" : "-translate-y-full"}`}
      >
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link href="/" aria-label="knew, home" tabIndex={shown ? 0 : -1} className="flex items-center gap-2 text-ink no-underline">
            <Mark className="size-6 shrink-0" />
            <Wordmark className="text-2xl" />
          </Link>
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Menu"
            aria-expanded={open}
            tabIndex={shown ? 0 : -1}
            className="-mr-2.5 flex size-11 items-center justify-center rounded-md text-ink transition-colors hover:bg-paper-sunken"
          >
            <Menu className="size-6" strokeWidth={2} />
          </button>
        </div>
      </header>

      {/* The drawer: a scrim, and a panel from the right with every page. */}
      <div
        aria-hidden
        onClick={() => setOpen(false)}
        className={`fixed inset-0 z-50 bg-ink/40 transition-opacity duration-300 ${open ? "opacity-100" : "pointer-events-none opacity-0"}`}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        aria-hidden={!open}
        className={`fixed inset-y-0 right-0 z-50 flex w-[min(20rem,85vw)] flex-col border-l-[1.5px] border-ink bg-paper shadow-[-4px_0_0_var(--ink)] transition-transform duration-300 ${open ? "translate-x-0" : "translate-x-[calc(100%+8px)]"}`}
      >
        <div className="flex h-16 items-center justify-between px-5">
          <span className="flex items-center gap-2 text-ink">
            <Mark className="size-5 shrink-0" />
            <Wordmark className="text-xl" />
          </span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
            tabIndex={open ? 0 : -1}
            className="flex size-11 items-center justify-center rounded-md text-ink transition-colors hover:bg-paper-sunken"
          >
            <X className="size-6" strokeWidth={2} />
          </button>
        </div>
        <nav className="flex flex-col px-3 pt-2">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              tabIndex={open ? 0 : -1}
              className="display rounded-md px-3 py-2 text-xl text-ink no-underline transition-colors hover:bg-paper-sunken"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto flex flex-col gap-2 px-6 pb-8 text-sm">
          {footer.map((item) => (
            <a key={item.href} href={item.href} tabIndex={open ? 0 : -1} className="text-ink-soft no-underline hover:text-ink">
              {item.label}
            </a>
          ))}
        </div>
      </aside>
    </>
  );
}

/** The site header on every page but the home page, which brings its own. */
export function UnlessHome({ children }: { readonly children: React.ReactNode }) {
  return usePathname() === "/" ? null : children;
}

import Link from "next/link";

import { TextLink } from "@/components/site/page-shell";
import { contractCaseSummaries, presetOutlines } from "@/lib/engine";
import {
  AT,
  exampleEpisode,
  exampleFacts,
  examplePage,
  exampleProposal,
  exampleReadiness,
} from "@/lib/example";
import { codeBlocks, packageManifest, readShipped } from "@/lib/package-docs";

const day = (date: Date) => date.toISOString().slice(0, 10);

const WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve"];
/** "Five facts" — a count as the sentence would say it. */
const counted = (n: number, noun: string) => `${WORDS[n] ?? n} ${noun}${n === 1 ? "" : "s"}`;

const missing = exampleReadiness.needs.filter((need) => need.state !== "met");
const next = exampleReadiness.next.slice(0, 3);

/** "person", "person and place", "person, place and team". */
const listed = (items: string[]) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);
const presetNames = presetOutlines().map((outline) => outline.name);

const quickstart = codeBlocks(readShipped("README.md"));
const install = quickstart.find((b) => b.lang === "sh")?.code ?? "npm install @popjoker/knew";
const usage = quickstart.find((b) => b.lang === "ts")?.code ?? "";

const DOCS = [
  { href: "/lenses", label: "Lenses", blurb: "Every field of a vocabulary and a lens, generated from the schemas, and the defaults." },
  {
    href: "/presets",
    label: "Presets",
    blurb: `The ${listed(presetNames)} preset${presetNames.length === 1 ? "" : "s"}: dimensions, fact types and starter lenses.`,
  },
  { href: "/adopting", label: "Adopting", blurb: "The guide: define, write, read, test." },
  { href: "/api", label: "The API", blurb: "Every route, the envelope, and the two headers." },
  { href: "/contract", label: "The contract", blurb: `The ${contractCaseSummaries().length} cases a driver must pass.` },
  { href: "/privacy", label: "Privacy", blurb: "What it will not do." },
  { href: "/changelog", label: "Changelog", blurb: "What each release changed." },
] as const;

/** The last card stretches to the end of its row, so the grid never shows an empty cell. */
const LAST_CARD = [DOCS.length % 2 === 1 ? "sm:col-span-2" : "", ["lg:col-span-1", "lg:col-span-3", "lg:col-span-2"][DOCS.length % 3]].join(" ");

export default function Home() {
  return (
    <>
      {/* ------------------------------------------------------------- hero */}
      <section className="mx-auto max-w-6xl px-6 pt-20 pb-16 sm:pt-28">
        <p className="clause rise">The attention engine</p>
        <h1 className="display rise mt-5 max-w-4xl text-hero" style={{ animationDelay: "60ms" }}>
          Understanding, by dimension, and where it should go next.
        </h1>
        <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,34rem)_auto] lg:items-start lg:justify-between">
          <p className="rise text-lg leading-relaxed text-ink-soft" style={{ animationDelay: "140ms" }}>
            knew reads notes into typed, dated facts, organised by the dimensions of what someone understands about a
            person, place or thing. For a goal, it reports the current understanding, what is missing, and the most
            valuable direction to take next. It writes no questions: what to do with a direction is your app&apos;s
            call.
          </p>
          <p className="stamp press" style={{ animationDelay: "320ms" }}>
            <span>{packageManifest.license}</span>
            <span aria-hidden>·</span>
            <span>{packageManifest.version}</span>
            <span aria-hidden>·</span>
            <span>by invitation</span>
          </p>
        </div>
        <div className="rise mt-10 flex flex-wrap items-center gap-x-6 gap-y-3" style={{ animationDelay: "220ms" }}>
          <Link
            href="/adopting"
            className="border border-ink bg-ink px-5 py-2.5 text-sm text-paper no-underline transition-colors hover:border-stamp hover:bg-stamp"
          >
            Read the guide
          </Link>
          <a href="#quickstart" className="text-sm text-ink no-underline underline-offset-4 hover:text-stamp hover:underline">
            Twenty lines to the first fact ↓
          </a>
        </div>
      </section>

      {/* -------------------------------------------- the spread: in, out, read */}
      <section className="mx-auto max-w-6xl px-6 pb-8">
        <div className="rule-t grid gap-px bg-rule pt-0 lg:grid-cols-3">
          {/* said */}
          <article className="panel min-w-0 bg-paper-sunken p-7">
            <p className="clause">01 — What was said</p>
            <p className="label mt-5">
              {exampleEpisode.sourceLabel} · {day(exampleEpisode.at)}
            </p>
            <blockquote className="mt-4 font-[family-name:var(--font-display)] text-[1.0625rem] leading-relaxed italic">
              “{exampleEpisode.words}”
            </blockquote>
            <p className="mt-6 text-sm text-ink-faint">
              Your words are the truth of it. Everything below is derived, and can always be rebuilt from this.
            </p>
          </article>

          {/* became */}
          <article className="panel min-w-0 bg-paper-raised p-7">
            <p className="clause">02 — What it became</p>
            <p className="label mt-5">{counted(exampleFacts.length, "fact")}, typed and dated</p>
            <div className="mt-3">
              {exampleFacts.map((f) => (
                <div key={f.id} className="ledger-row">
                  <span className="code text-[0.6875rem] tracking-[0.12em] text-stamp">
                    {f.type}
                    {typeof f.attributes.level === "string" ? (
                      <span className="text-ink-faint"> [{f.attributes.level}]</span>
                    ) : null}
                  </span>
                  <span className="text-[0.9375rem] leading-snug">{f.fact}</span>
                  {f.validAt ? (
                    <span className="text-[0.6875rem] italic text-ink-faint">
                      since {day(f.validAt).slice(0, 7)}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
            <div className="mt-6 border border-dashed border-rule-strong p-3">
              <p className="label">Proposed, not written</p>
              <p className="mt-1.5 text-sm text-ink-soft">
                <code className="code text-stamp">{exampleProposal.field}</code> is a
                field the client owns. The engine noticed the move and proposes a value; it does not write one.
              </p>
            </div>
          </article>

          {/* read */}
          <article className="panel min-w-0 bg-paper-raised p-7">
            <p className="clause">03 — Understanding, for one goal</p>
            <p className="label mt-5">The page: current understanding</p>
            <pre className="mt-4 border-l-2 border-rule-strong bg-paper-sunken p-4 code text-[0.75rem] leading-relaxed whitespace-pre-wrap">
              {examplePage}
            </pre>
            <div className="mt-6">
              <p className="label">By dimension</p>
              <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 text-sm">
                {exampleReadiness.dimensions.map((dimension) => (
                  <div key={dimension.id} className="contents">
                    <span className={dimension.facts > 0 ? "text-ink" : "text-ink-faint"}>{dimension.label}</span>
                    <span className="text-right text-ink-faint">{dimension.facts > 0 ? counted(dimension.facts, "fact") : "nothing yet"}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-6">
              <p className="label">Missing, for this goal</p>
              <p className="mt-2 text-sm text-ink-soft">{missing.map((need) => need.label).join(" · ") || "Nothing"}</p>
            </div>
            {next.map((direction, index) => (
              <div key={direction.need} className="mt-5 border-l-2 border-derived pl-4">
                <p className="label" style={{ color: "var(--derived)" }}>
                  {index === 0 ? "Next direction" : "Then"} · {direction.kind === "learn" ? "learn" : "revisit"}
                </p>
                <p className="mt-1.5 text-[0.9375rem] leading-snug">
                  {direction.label}
                  {direction.factIds.length > 0 ? (
                    <span className="text-ink-faint"> — builds on {counted(direction.factIds.length, "fact").toLowerCase()}</span>
                  ) : null}
                </p>
              </div>
            ))}
            <p className="mt-6 text-sm text-ink-faint">
              Everything in this panel comes from <code className="code">renderBrief</code> and{" "}
              <code className="code">readinessFor</code>, run at build time through the{" "}
              <TextLink href="/presets#the-person-preset">person preset</TextLink>, as of {day(AT)}.
              Goal: “{exampleReadiness.objective}”
            </p>
          </article>
        </div>
      </section>

      {/* ------------------------------------------------------------ the modes */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <p className="clause">Two modes</p>
        <h2 className="display mt-2 max-w-2xl text-title">
          It can hold the ledger, or hold nothing at all.
        </h2>
        <div className="mt-10 grid gap-6 md:grid-cols-2">
          <div className="card p-7">
            <p className="label">Hosted</p>
            <h3 className="display mt-3 text-2xl">The engine keeps it for you</h3>
            <p className="mt-4 text-ink-soft">
              Register a vocabulary and lenses, upsert entities, post episodes. The service stores episodes and facts
              with their history and runs extraction. Read the page, the gaps and readiness through any lens.
            </p>
          </div>
          <div className="card p-7">
            <p className="label" style={{ color: "var(--derived)" }}>
              Stateless
            </p>
            <h3 className="display mt-3 text-2xl">The engine keeps nothing</h3>
            <p className="mt-4 text-ink-soft">
              Send the roster, the facts you hold and one episode; get back a reconciliation plan to apply to your own
              store. The page and readiness are pure functions you run yourself. Nothing is kept.
            </p>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ quickstart */}
      <section id="quickstart" className="mx-auto max-w-6xl px-6 pb-20">
        <div className="rule-t grid gap-10 pt-10 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <div>
            <p className="clause">Quickstart</p>
            <h2 className="display mt-2 text-3xl">Twenty lines to the first fact.</h2>
            <p className="mt-4 text-sm text-ink-soft">
              From the package&apos;s <code className="code">README.md</code>, read at build time.
            </p>
            <p className="mt-4 text-sm text-ink-faint">Node 22 or later, ES modules. The only dependency is zod 4.</p>
          </div>
          <div className="min-w-0">
            <pre className="overflow-x-auto border border-rule border-l-2 border-l-stamp bg-paper-sunken p-5 code text-[0.8125rem] leading-relaxed">
              {install}
            </pre>
            <pre className="mt-4 overflow-x-auto border border-rule border-l-2 border-l-rule-strong bg-paper-sunken p-5 code text-[0.8125rem] leading-relaxed">
              {usage}
            </pre>
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------------------- docs */}
      <section className="mx-auto max-w-6xl px-6 pb-4">
        <p className="clause">The rest of it</p>
        <div className="mt-6 grid gap-px bg-rule sm:grid-cols-2 lg:grid-cols-3">
          {DOCS.map((doc, index) => (
            <Link
              key={doc.href}
              href={doc.href}
              className={`group bg-paper-raised p-6 no-underline transition-colors hover:bg-paper-sunken ${index === DOCS.length - 1 ? LAST_CARD : ""}`}
            >
              <p className="display text-xl text-ink group-hover:text-stamp">{doc.label}</p>
              <p className="mt-2 text-sm text-ink-soft">{doc.blurb}</p>
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}

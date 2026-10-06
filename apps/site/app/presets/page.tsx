import type { Metadata } from "next";
import type { ReactNode } from "react";

import { Inline } from "@/components/site/inline";
import { DocBody, DocHeader, Section, TextLink } from "@/components/site/page-shell";
import { askMarks, presetOutlines, type PresetOutline } from "@/lib/engine";
import { presetExtensionExample, slugify } from "@/lib/package-docs";

export const metadata: Metadata = {
  title: "Presets",
  description:
    "Where a client starts: each preset's dimensions, the types of fact that inform them, and its starter lens, read out of @popjoker/knew/presets at build time.",
};

const outlines = presetOutlines();
const extending = presetExtensionExample();

const titleOf = (outline: PresetOutline) => `The ${outline.name} preset`;
const clauseOf = (index: number) => String(index + 1).padStart(2, "0");

const HEADINGS = [
  ...outlines.map((outline) => ({ id: slugify(titleOf(outline)), text: titleOf(outline), level: 2 })),
  { id: "extending-a-preset", text: "Extending a preset", level: 2 },
];

function Row({ term, children }: { readonly term: string; readonly children: ReactNode }) {
  return (
    <div className="rule-t grid gap-x-6 gap-y-1 py-3 lg:grid-cols-[11rem_minmax(0,1fr)]">
      <dt className="text-sm text-ink-faint">{term}</dt>
      <dd className="text-[0.9375rem] leading-relaxed text-ink-soft">{children}</dd>
    </div>
  );
}

function Preset({ outline, clause }: { readonly outline: PresetOutline; readonly clause: string }) {
  const { name, vocabulary, dimensions, lens, firstQuestion } = outline;
  const label = new Map(dimensions.map((dimension) => [dimension.id, dimension.label]));
  const sameWeight = new Set(lens.asks.map((ask) => ask.weight)).size <= 1;
  const waits = lens.asks.some((ask) => ask.after.length > 0);

  return (
    <Section clause={clause} title={titleOf(outline)}>
      <p className="measure text-ink-soft">
        <code className="code">{name}.vocabulary()</code> and <code className="code">{name}.lens()</code>, from{" "}
        <code className="code">@popjoker/knew/presets</code>. The vocabulary is{" "}
        <code className="code">{vocabulary.id}</code>, version {vocabulary.version}, for entities of kind{" "}
        <code className="code">{vocabulary.kind}</code>: {vocabulary.factTypeKeys.length} types of fact across{" "}
        {dimensions.length} dimensions.
      </p>

      <h3 className="display mt-10 text-xl">The taxonomy</h3>
      <p className="measure mt-3 text-[0.9375rem] text-ink-soft">
        The dimensions, in the order a reader takes them in, each with the types of fact that inform it. Extraction
        writes every fact as one of these types, and readiness reports what is known by dimension. What pinned,
        enduring, a revisit window and the fallback mean is explained with{" "}
        <TextLink href="/lenses#the-vocabulary">
          the vocabulary&apos;s fields
        </TextLink>
        .
      </p>
      <div className="mt-6 space-y-8">
        {dimensions.map((dimension) => (
          <div key={dimension.id}>
            <div className="flex flex-wrap items-baseline gap-x-3">
              <h4 className="display text-lg">{dimension.label}</h4>
              <code className="code text-[0.75rem] text-derived">{dimension.id}</code>
            </div>
            <p className="mt-1 text-[0.9375rem] text-ink-soft">
              {dimension.question ? (
                `“${dimension.question}”`
              ) : (
                <span className="italic text-ink-faint">No question, so the default asks leave it alone.</span>
              )}
            </p>
            <div className="mt-2">
              {dimension.types.map((type) => (
                <div key={type.key} className="ledger-row">
                  <span className="code text-[0.6875rem] tracking-[0.12em] text-stamp">{type.key}</span>
                  <span className="text-[0.9375rem] leading-snug">
                    {type.description}
                    {type.attributes.length ? <span className="text-ink-faint"> {type.attributes.join(", ")}</span> : null}
                  </span>
                  <span className="text-[0.6875rem] italic text-ink-faint">{type.marks.join(" · ")}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <h3 className="display mt-12 text-xl">The starter lens</h3>
      <p className="measure mt-3 text-[0.9375rem] text-ink-soft">
        <code className="code">{lens.id}</code>, version {lens.version}
        {lens.objective ? <>, for one objective: “{lens.objective}”</> : "."} Shown compiled: what it leaves out
        is filled in with the engine&apos;s defaults.
      </p>
      <ol className="mt-4">
        {lens.asks.map((ask, index) => {
          const marks = askMarks(ask, sameWeight);
          return (
            <li key={ask.id} className="rule-t grid gap-x-4 gap-y-1 py-3 lg:grid-cols-[2rem_minmax(0,1fr)_15rem]">
              <span className="text-[0.8125rem] italic text-ink-faint">{index + 1}</span>
              <span className="text-[0.9375rem]">
                {ask.question}
                {marks.length ? (
                  <span className="text-ink-faint">
                    {" "}
                    — <Inline text={marks.join(", ")} />
                  </span>
                ) : null}
              </span>
              <span className="text-[0.8125rem] leading-snug text-ink-faint">
                {ask.dimension ? `${label.get(ask.dimension)}: ` : "Answered by "}
                <span className="code text-[0.75rem]">{ask.answeredBy.join(", ")}</span>
              </span>
            </li>
          );
        })}
      </ol>
      <p className="rule-t mt-0 pt-4 text-sm text-ink-faint">
        {sameWeight
          ? waits
            ? "Every ask weighs the same, so this is the order of the gaps, except that an ask is held back until the ones it comes after are answered."
            : "Every ask weighs the same and none waits on another, so this is the order of the gaps."
          : "Heavier asks come first among the gaps, and ties keep this order."}
        {firstQuestion ? ` Asked about a ${vocabulary.kind} nothing is known about yet, it starts with “${firstQuestion}”` : null}
      </p>

      <dl className="mt-8">
        <Row term="The page opens">“{lens.header}”</Row>
        <Row term="Its sections">
          {lens.sections.map((section) => section.heading).join(" · ")}
          {lens.definition.sections ? null : (
            <span className="text-ink-faint"> — the default: one per dimension, headed by its label</span>
          )}
        </Row>
        <Row term="Honored, not weighed">
          <span className="code text-[0.8125rem]">{[...lens.pinned].join(", ")}</span> — always on the page, first, and
          handed over as must-honor
        </Row>
        <Row term="Facts that are over">Last, under “{lens.overHeading}”</Row>
        {lens.attributeTags.length ? (
          <Row term="In brackets">
            <Inline text={lens.attributeTags.map((tag) => `\`${tag}\``).join(", ")} /> — after a fact that carries one
          </Row>
        ) : null}
      </dl>

      <h3 className="display mt-12 text-xl">The charter</h3>
      <pre className="mt-4 overflow-x-auto border border-rule border-l-2 border-l-stamp bg-paper-sunken p-5 code text-[0.8125rem] leading-relaxed whitespace-pre-wrap">
        {vocabulary.charter}
      </pre>
      <p className="mt-4 text-sm text-ink-faint">Handed to the model with every extraction. A client replaces it with its own.</p>
    </Section>
  );
}

export default function PresetsPage() {
  const types = outlines.reduce((sum, outline) => sum + outline.vocabulary.factTypeKeys.length, 0);

  return (
    <>
      <DocHeader
        clause="Presets"
        title="Where a client starts."
        standfirst="A preset is a vocabulary and a starter lens for one kind of entity, generic on purpose, for a client to extend rather than write from nothing. It is opt-in, the one place in the package with content, and reviewed like API: an addition is a minor release, and a change to what a type means bumps the preset's version and is a major. Every dimension, type and ask below is read out of the package at build time."
        aside={
          <p className="stamp">
            <span>
              {outlines.length} preset{outlines.length === 1 ? "" : "s"}
            </span>
            <span aria-hidden>·</span>
            <span>{types} types of fact</span>
          </p>
        }
      />

      <DocBody headings={HEADINGS}>
        <div className="space-y-4">
          {outlines.map((outline, index) => (
            <Preset key={outline.name} outline={outline} clause={clauseOf(index)} />
          ))}

          <Section clause={clauseOf(outlines.length)} title="Extending a preset">
            <p className="measure text-ink-soft">
              A client extends a preset rather than copying it out. <code className="code">extendVocabulary</code> and{" "}
              <code className="code">extendLens</code> take the base and say only what differs: a key given replaces or
              merges, <code className="code">null</code> removes, and a key left out keeps the base&apos;s. The
              vocabulary is stamped <code className="code">basedOn</code> with the preset, its version, and every type
              or dimension changed or added, so a fact typed in a type left alone still means what the preset meant by
              it.
            </p>
            <pre className="mt-6 overflow-x-auto border border-rule border-l-2 border-l-rule-strong bg-paper-sunken p-5 code text-[0.8125rem] leading-relaxed">
              {extending.code}
            </pre>
            <p className="mt-4 text-sm text-ink-faint">
              From the package&apos;s own <code className="code">ADOPTING.md</code>, read at build time. The rest is in
              the guide, under{" "}
              <TextLink href={`/adopting#${extending.section.id}`}>
                {extending.section.text}
              </TextLink>
              .
            </p>
          </Section>
        </div>
      </DocBody>
    </>
  );
}

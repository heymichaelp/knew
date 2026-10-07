import type { Metadata } from "next";
import type { ReactNode } from "react";

import { Inline } from "@/components/site/inline";
import { DocBody, DocHeader, Section, TextLink } from "@/components/site/page-shell";
import { needMarks, presetOutlines, type PresetOutline } from "@/lib/engine";
import { presetExtensionExample, slugify } from "@/lib/package-docs";

export const metadata: Metadata = {
  title: "Presets",
  description:
    "Each preset's dimensions, fact types and starter lens, read from @popjoker/knew/presets at build time.",
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
  const { name, vocabulary, dimensions, lens, firstDirection } = outline;
  const sameWeight = new Set(lens.needs.map((need) => need.weight)).size <= 1;
  const waits = lens.needs.some((need) => need.after.length > 0);

  return (
    <Section clause={clause} title={titleOf(outline)}>
      <p className="measure text-ink-soft">
        <code className="code">{name}.vocabulary()</code> and <code className="code">{name}.lens()</code> from{" "}
        <code className="code">@popjoker/knew/presets</code>. Vocabulary <code className="code">{vocabulary.id}</code>{" "}
        v{vocabulary.version}, kind <code className="code">{vocabulary.kind}</code>: {vocabulary.factTypeKeys.length} types
        in {dimensions.length} dimensions.
      </p>

      <h3 className="display mt-10 text-xl">Dimensions</h3>
      <p className="measure mt-3 text-[0.9375rem] text-ink-soft">
        Each dimension, in reading order, with the fact types that inform it. The flags are defined with{" "}
        <TextLink href="/lenses#the-vocabulary">the vocabulary&apos;s fields</TextLink>.
      </p>
      <div className="mt-6 space-y-8">
        {dimensions.map((dimension) => (
          <div key={dimension.id}>
            <div className="flex flex-wrap items-baseline gap-x-3">
              <h4 className="display text-lg">{dimension.label}</h4>
              <code className="code text-[0.75rem] text-derived">{dimension.id}</code>
            </div>
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

      <h3 className="display mt-12 text-xl">Starter lens</h3>
      <p className="measure mt-3 text-[0.9375rem] text-ink-soft">
        <code className="code">{lens.id}</code> v{lens.version}
        {lens.objective ? <>. Objective: “{lens.objective}”</> : null} Its needs, compiled with the engine&apos;s defaults:
      </p>
      <ol className="mt-4">
        {lens.needs.map((need, index) => {
          const marks = needMarks(need, sameWeight);
          return (
            <li key={need.id} className="rule-t grid gap-x-4 gap-y-1 py-3 lg:grid-cols-[2rem_minmax(0,1fr)_15rem]">
              <span className="text-[0.8125rem] italic text-ink-faint">{index + 1}</span>
              <span className="text-[0.9375rem]">
                {need.label}
                {marks.length ? (
                  <span className="text-ink-faint">
                    {" "}
                    — <Inline text={marks.join(", ")} />
                  </span>
                ) : null}
              </span>
              <span className="code text-[0.75rem] leading-snug text-ink-faint">{need.types.join(", ")}</span>
            </li>
          );
        })}
      </ol>
      <p className="rule-t mt-0 pt-4 text-sm text-ink-faint">
        {sameWeight
          ? waits
            ? "Needs weigh the same, so directions follow this order; a need waits until the ones it comes after are met."
            : "Needs weigh the same, so directions follow this order."
          : "Heavier needs come first; ties keep this order."}
        {firstDirection ? ` With nothing known, the first direction is “${firstDirection}”.` : null}
      </p>

      <dl className="mt-8">
        <Row term="The page opens">“{lens.header}”</Row>
        <Row term="Its sections">
          {lens.sections.map((section) => section.heading).join(" · ")}
          {lens.definition.sections ? null : (
            <span className="text-ink-faint"> (default: one per dimension)</span>
          )}
        </Row>
        <Row term="Must honor">
          <span className="code text-[0.8125rem]">{[...lens.pinned].join(", ")}</span>, first on the page and returned as{" "}
          <code className="code">mustHonor</code>
        </Row>
        <Row term="Ended facts">Last, under “{lens.overHeading}”</Row>
        {lens.attributeTags.length ? (
          <Row term="Tags">
            <Inline text={lens.attributeTags.map((tag) => `\`${tag}\``).join(", ")} />, in brackets after a fact
          </Row>
        ) : null}
      </dl>

      <h3 className="display mt-12 text-xl">Charter</h3>
      <pre className="mt-4 overflow-x-auto border border-rule border-l-2 border-l-stamp bg-paper-sunken p-5 code text-[0.8125rem] leading-relaxed whitespace-pre-wrap">
        {vocabulary.charter}
      </pre>
      <p className="mt-4 text-sm text-ink-faint">Sent to the model with every extraction. Replace it with your own.</p>
    </Section>
  );
}

export default function PresetsPage() {
  const types = outlines.reduce((sum, outline) => sum + outline.vocabulary.factTypeKeys.length, 0);

  return (
    <>
      <DocHeader
        clause="Presets"
        title="Starting points."
        standfirst="A preset is a generic vocabulary and starter lens for one kind of entity. Extend one instead of writing your own from nothing. Opt-in, from @popjoker/knew/presets; everything below is read from the package at build time."
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
              <code className="code">extendVocabulary</code> and <code className="code">extendLens</code> take a base
              and your overrides: a key given replaces or merges, <code className="code">null</code> removes, a key
              left out is kept. The result records <code className="code">basedOn</code>: the preset, its version, and
              what you changed or added.
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

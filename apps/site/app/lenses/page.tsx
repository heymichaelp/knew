import type { Metadata } from "next";

import { FieldTable } from "@/components/site/field-table";
import { Inline } from "@/components/site/inline";
import { DocBody, DocHeader, Section, TextLink } from "@/components/site/page-shell";
import { DEFAULT_NOTES } from "@/lib/default-notes";
import {
  engineDefaults,
  lensFields,
  lensNestedFields,
  personVocabulary,
  vocabularyFields,
  vocabularyNestedFields,
} from "@/lib/engine";
import { LENS_FIELD_NOTES, LENS_NESTED_NOTES } from "@/lib/lens-notes";
import { VOCABULARY_FIELD_NOTES, VOCABULARY_NESTED_NOTES } from "@/lib/vocabulary-notes";

export const metadata: Metadata = {
  title: "Vocabularies and lenses",
  description:
    "Every field of a vocabulary and a lens, generated from the schemas, and the engine's defaults.",
};

const HEADINGS = [
  { id: "the-vocabulary", text: "The vocabulary", level: 2 },
  { id: "the-lens", text: "The lens", level: 2 },
  { id: "defaults", text: "Defaults", level: 2 },
  { id: "the-charter", text: "The charter", level: 2 },
];

export default function LensesPage() {
  const vocabulary = vocabularyFields();
  const lens = lensFields();

  return (
    <>
      <DocHeader
        clause="Vocabularies and lenses"
        title="Two definitions a client registers."
        standfirst="A vocabulary defines the dimensions of understanding for one kind of entity and the fact types that inform them. A lens reads that understanding for one goal: what the page shows, what must be honored, and what the goal needs understood. Several lenses can read one vocabulary."
        aside={
          <p className="stamp">
            <span>{vocabulary.length} vocabulary fields</span>
            <span aria-hidden>·</span>
            <span>{lens.length} lens fields</span>
          </p>
        }
      />

      <DocBody headings={HEADINGS}>
        <div className="space-y-4">
          <section id="the-vocabulary">
            <p className="clause">01</p>
            <h2 className="display mt-2 text-3xl">The vocabulary</h2>
            <p className="measure mt-4 text-ink-soft">
              Facts are stored in its terms, so changing it may call for a replay. Generated from{" "}
              <code className="code">vocabularyDefinitionSchema</code>.
            </p>
            <FieldTable fields={vocabulary} notes={VOCABULARY_FIELD_NOTES} nested={vocabularyNestedFields()} nestedNotes={VOCABULARY_NESTED_NOTES} />
            <p className="rule-t mt-0 pt-4 text-sm text-ink-faint">
              <span className="text-stamp">*</span> required. Also checked: every type informs an existing dimension, every
              dimension holds a type, the fallback is one of your types, prompt fields are a subset of fields, and no
              enduring type has a revisit window.
            </p>
          </section>

          <Section clause="02" title="The lens">
            <p className="measure text-ink-soft">
              Cheap to change: writing never names a lens. Generated from{" "}
              <code className="code">lensDefinitionSchema</code>. The smallest lens names its vocabulary, header and
              ended-facts heading.
            </p>
            <FieldTable fields={lens} notes={LENS_FIELD_NOTES} nested={lensNestedFields()} nestedNotes={LENS_NESTED_NOTES} />
            <p className="rule-t mt-0 pt-4 text-sm text-ink-faint">
              <span className="text-stamp">*</span> required. Compiling checks every reference: sections hold each dimension
              once, named types exist, a <code className="code">when</code> names a field, and no need waits on itself or
              in a circle.
            </p>
          </Section>

          <Section clause="03" title="Defaults">
            <p className="measure text-ink-soft">
              Each layer overrides the one below: the engine&apos;s defaults, a{" "}
              <TextLink href="/presets">preset</TextLink>, your vocabulary, a lens, the call. The engine&apos;s own,
              from <code className="code">ENGINE_DEFAULTS</code>:
            </p>
            <div className="mt-6">
              {engineDefaults().map((item) => (
                <div key={item.name} className="rule-t grid gap-x-6 gap-y-1 py-4 lg:grid-cols-[13rem_6rem_minmax(0,1fr)]">
                  <span className="code text-sm">{item.name}</span>
                  <span className="text-sm text-ink">{item.value}</span>
                  <span className="text-[0.9375rem] leading-relaxed text-ink-soft">
                    <Inline text={DEFAULT_NOTES[item.name]} />
                  </span>
                </div>
              ))}
            </div>
          </Section>

          <Section clause="04" title="The charter">
            <p className="measure text-ink-soft">
              The one prose field. Sent with every extraction: what to keep, and what never to record.
            </p>
            <pre className="mt-6 overflow-x-auto border border-rule border-l-2 border-l-stamp bg-paper-sunken p-5 code text-[0.8125rem] leading-relaxed whitespace-pre-wrap">
              {personVocabulary.charter}
            </pre>
            <p className="mt-4 text-sm text-ink-faint">
              The <TextLink href="/presets#the-person-preset">person preset</TextLink>&apos;s charter, as an example.
            </p>
          </Section>
        </div>
      </DocBody>
    </>
  );
}

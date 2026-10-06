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
    "A vocabulary is what extraction writes in; a lens is a direction over it for one objective. Both definitions, field by field, generated from the schemas, and the defaults beneath them.",
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
        title="Two kinds of data a client registers."
        standfirst="A vocabulary is what extraction writes in: the types of fact about one kind of thing, and the dimensions of it they inform. A lens is a direction over that vocabulary for one objective: what the page shows, what must be honored, and what to ask next. Several lenses read one vocabulary's facts. The core engine names no domain; a preset is where a client starts."
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
              The expensive half to change: facts are stored in its terms, so a new version may be worth a replay. Every
              row below is generated from <code className="code">vocabularyDefinitionSchema</code> at build time —
              the names, the types, the patterns and what is required. Only the prose is written by hand, and a test
              refuses to build this page if a field has no note.
            </p>
            <FieldTable fields={vocabulary} notes={VOCABULARY_FIELD_NOTES} nested={vocabularyNestedFields()} nestedNotes={VOCABULARY_NESTED_NOTES} />
            <p className="rule-t mt-0 pt-4 text-sm text-ink-faint">
              <span className="text-stamp">*</span> required. The schema also cross-checks the fields against each other:
              every type informs a dimension the vocabulary has, every dimension holds a type, the fallback is one of your
              own types, prompt fields are a subset of the fields, and an enduring type refuses a revisit window.
            </p>
          </section>

          <Section clause="02" title="The lens">
            <p className="measure text-ink-soft">
              The cheap half to change: writing never names a lens, so a new version touches no episode and no fact.
              Generated from <code className="code">lensDefinitionSchema</code>. Everything a lens leaves out has a
              default, so the smallest lens names its vocabulary, its header and its heading for what is over.
            </p>
            <FieldTable fields={lens} notes={LENS_FIELD_NOTES} nested={lensNestedFields()} nestedNotes={LENS_NESTED_NOTES} />
            <p className="rule-t mt-0 pt-4 text-sm text-ink-faint">
              <span className="text-stamp">*</span> required. Compiled against its vocabulary, a lens has every reference
              checked: sections hold every dimension exactly once, pinned types and answering types exist, a{" "}
              <code className="code">when</code> names one of the vocabulary&apos;s fields, and no ask waits on itself or
              in a circle.
            </p>
          </Section>

          <Section clause="03" title="Defaults">
            <p className="measure text-ink-soft">
              The layers, each overriding the one below: the engine&apos;s defaults, then a{" "}
              <TextLink href="/presets">
                preset
              </TextLink>
              , then the client&apos;s vocabulary, then a lens, then the call. The engine&apos;s own are mechanics only, read out of{" "}
              <code className="code">ENGINE_DEFAULTS</code>; a lens that says nothing about its sections reads each
              dimension as one, its pinned types are the vocabulary&apos;s, and its asks are each dimension&apos;s question.
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
              The one field that is prose rather than structure. It travels with every extraction, and it is where a
              product says what it cares about and — more usefully — what it must never record. The engine has no
              opinion about its content; it only guarantees the model sees it.
            </p>
            <pre className="mt-6 overflow-x-auto border border-rule border-l-2 border-l-stamp bg-paper-sunken p-5 code text-[0.8125rem] leading-relaxed whitespace-pre-wrap">
              {personVocabulary.charter}
            </pre>
            <p className="mt-4 text-sm text-ink-faint">
              The{" "}
              <TextLink href="/presets#the-person-preset">
                person preset
              </TextLink>
              &apos;s charter, above, read straight out of <code className="code">@popjoker/knew/presets</code>. A client
              replaces it with its own.
            </p>
          </Section>
        </div>
      </DocBody>
    </>
  );
}

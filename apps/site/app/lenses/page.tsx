import type { Metadata } from "next";

import { Inline } from "@/components/site/inline";
import { DocBody, DocHeader, Section } from "@/components/site/page-shell";
import { fixtureLens, lensFields } from "@/lib/engine";
import { LENS_FIELD_NOTES } from "@/lib/lens-notes";

export const metadata: Metadata = {
  title: "Lenses",
  description: "A lens is data a client registers. The definition, field by field, generated from the schema.",
};

const HEADINGS = [
  { id: "the-definition", text: "The definition", level: 2 },
  { id: "the-charter", text: "The charter", level: 2 },
  { id: "a-worked-example", text: "A worked example", level: 2 },
];

export default function LensesPage() {
  const fields = lensFields();
  const required = fields.filter((f) => f.required);

  return (
    <>
      <DocHeader
        clause="Lenses"
        title="A lens is data a client registers."
        standfirst="Nothing in the engine names a domain: no fact type, no heading, no charter, no question. A client hands over a lens — what to remember about a subject, how the page reads, what to ask next — and the engine validates it, stores it per version, and reads facts through it."
        aside={
          <p className="stamp">
            <span>{fields.length} fields</span>
            <span aria-hidden>·</span>
            <span>{required.length} required</span>
          </p>
        }
      />

      <DocBody headings={HEADINGS}>
        <div className="space-y-4">
          <section id="the-definition">
            <p className="clause">01</p>
            <h2 className="display mt-2 text-3xl">The definition</h2>
            <p className="measure mt-4 text-ink-soft">
              Every row below is generated from <code className="code">lensDefinitionSchema</code>{" "}
              at build time — the names, the types, the patterns and what is required. Only the last column is written
              by hand, and a test refuses to build this page if a field has no note.
            </p>

            <div className="mt-8 space-y-0">
              {fields.map((field, index) => (
                <div key={field.name} className="rule-t grid gap-x-6 gap-y-2 py-5 lg:grid-cols-[13rem_minmax(0,1fr)]">
                  <div>
                    <p className="code text-sm text-ink">
                      {field.name}
                      {field.required ? <span className="text-stamp">*</span> : null}
                    </p>
                    <p className="label mt-1.5 normal-case tracking-normal">
                      {field.required ? "required" : "optional"}
                    </p>
                  </div>
                  <div className="min-w-0">
                    <p className="overflow-x-auto code text-[0.8125rem] text-derived">
                      {field.type}
                    </p>
                    {field.constraint ? (
                      <p className="mt-1 code text-[0.75rem] text-ink-faint">
                        {field.constraint}
                      </p>
                    ) : null}
                    <p className="mt-2.5 text-[0.9375rem] leading-relaxed text-ink-soft">
                      <Inline text={LENS_FIELD_NOTES[field.name] ?? ""} />
                    </p>
                  </div>
                  <span className="sr-only">field {index + 1}</span>
                </div>
              ))}
            </div>
            <p className="rule-t mt-0 pt-4 text-sm text-ink-faint">
              <span className="text-stamp">*</span> required. The schema also cross-checks the fields against each
              other: every fact type’s section must have a heading, the fallback type must be one of your own types,
              prompt fields must be a subset of routing fields, ask ids must be unique, and an ask may only answer with
              types that exist.
            </p>
          </section>

          <Section clause="02" title="The charter">
            <p className="measure text-ink-soft">
              The charter is the one field that is prose rather than structure. It travels with every extraction, and
              it is where a lens says what it cares about and — more usefully — what it must never record. The engine
              has no opinion about its content; it only guarantees the model sees it.
            </p>
            <pre className="mt-6 overflow-x-auto border border-rule border-l-2 border-l-stamp bg-paper-sunken p-5 code text-[0.8125rem] leading-relaxed">
              {fixtureLens.charter}
            </pre>
            <p className="mt-4 text-sm text-ink-faint">
              The charter of the fixture lens, above, read straight out of{" "}
              <code className="code">@popjoker/knew/testing</code>.
            </p>
          </Section>

          <Section clause="03" title="A worked example">
            <p className="measure text-ink-soft">
              The smallest real lens there is: the fixture the package tests itself against. It has{" "}
              {Object.keys(fixtureLens.factTypes).length} fact types across {fixtureLens.briefSections.length} sections,
              two routing fields and two asks — one of which only applies to some people.
            </p>

            <h3 className="display mt-10 text-xl">Fact types</h3>
            <div className="mt-4">
              {Object.entries(fixtureLens.factTypes).map(([key, spec]) => (
                <div key={key} className="ledger-row">
                  <span className="code text-[0.6875rem] tracking-[0.12em] text-stamp">
                    {key}
                  </span>
                  <span className="text-[0.9375rem] leading-snug">
                    {spec.description}
                    {spec.attributes?.length ? (
                      <span className="text-ink-faint">
                        {" "}
                        {spec.attributes
                          .map((a) => `${a.name}: ${a.kind === "enum" ? (a.values ?? []).join(" | ") : a.kind}`)
                          .join(", ")}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-[0.6875rem] italic text-ink-faint">
                    {[spec.pinned ? "pinned" : null, spec.enduring ? "enduring" : null].filter(Boolean).join(" · ") ||
                      spec.section}
                  </span>
                </div>
              ))}
            </div>

            <h3 className="display mt-10 text-xl">Asks</h3>
            <div className="mt-4">
              {(fixtureLens.asks ?? []).map((ask) => (
                <div key={ask.id} className="rule-t py-4">
                  <p className="code text-[0.6875rem] tracking-[0.12em] text-derived">
                    {ask.id}
                  </p>
                  <p className="mt-1.5 text-[0.9375rem]">{ask.question}</p>
                  <p className="mt-1.5 text-sm text-ink-faint">
                    Answered by {ask.answeredBy.join(" or ")}
                    {ask.when?.length
                      ? `, and only asked when ${ask.when
                          .map((w) => `${w.field} is ${w.equals.join(" or ")}`)
                          .join(" and ")}`
                      : ", of everyone"}
                    .
                  </p>
                </div>
              ))}
            </div>

            <p className="rule-t mt-10 pt-6 text-sm text-ink-faint">
              A client’s own lens is richer than this one. knewpeople’s{" "}
              <code className="code">relationships</code> lens carries fifteen fact
              types and five asks — but that is the client’s content, not the engine’s, so it does not ship here.
              The front page shows what this lens does with one episode.
            </p>
          </Section>
        </div>
      </DocBody>
    </>
  );
}

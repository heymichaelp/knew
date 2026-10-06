import { Inline } from "@/components/site/inline";
import type { DefinitionField } from "@/lib/engine";

/**
 * A definition's fields, generated from its schema, each beside the one line
 * of prose the schema cannot carry. A field that holds objects — a record of
 * fact types, a list of asks — lists the fields inside them beneath it.
 */
export function FieldTable({
  fields,
  notes,
  nested,
  nestedNotes,
}: {
  readonly fields: DefinitionField[];
  readonly notes: Record<string, string>;
  readonly nested: Record<string, DefinitionField[]>;
  readonly nestedNotes: Record<string, Record<string, string>>;
}) {
  return (
    <div className="mt-8 space-y-0">
      {fields.map((field) => {
        const path = [`${field.name}.*`, `${field.name}[]`].find((candidate) => candidate in nested);
        const inner = path ? nested[path]! : [];
        return (
          <div key={field.name} className="rule-t grid gap-x-6 gap-y-2 py-5 lg:grid-cols-[13rem_minmax(0,1fr)]">
            <div>
              <p className="code text-sm text-ink">
                {field.name}
                {field.required ? <span className="text-stamp">*</span> : null}
              </p>
              <p className="label mt-1.5 normal-case tracking-normal">{field.required ? "required" : "optional"}</p>
            </div>
            <div className="min-w-0">
              <p className="overflow-x-auto code text-[0.8125rem] text-derived">{field.type}</p>
              {field.constraint ? <p className="mt-1 code text-[0.75rem] text-ink-faint">{field.constraint}</p> : null}
              <p className="mt-2.5 text-[0.9375rem] leading-relaxed text-ink-soft">
                <Inline text={notes[field.name] ?? ""} />
              </p>
              {inner.length > 0 ? (
                <div className="mt-4 border-l-2 border-rule pl-4">
                  {inner.map((child) => (
                    <div key={child.name} className="py-2">
                      <p className="code text-[0.8125rem] text-ink">
                        {child.name}
                        {child.required ? <span className="text-stamp">*</span> : null}
                        <span className="text-ink-faint"> {child.type}</span>
                      </p>
                      <p className="mt-1 text-sm leading-relaxed text-ink-soft">
                        <Inline text={nestedNotes[path!]?.[child.name] ?? ""} />
                      </p>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

import { dayOf } from "./dates.ts";
import { whoLabel, type Lens } from "./lens.ts";
import type { Fact, RosterEntry } from "./types.ts";

/**
 * What the two model calls are shown — pure, so what the model sees is
 * testable without a model. The lens supplies the source labels and which of
 * a person's fields are shown beside their name; everything else is the
 * engine's one wording.
 */

export function extractInput(
  lens: Lens,
  input: {
    content: string;
    /** What the phone read off the turn's photographs, when it carried any. */
    observed?: string | null;
    source: string;
    referenceAt: Date;
    roster: RosterEntry[];
    hints: readonly string[];
  },
): string {
  const roster =
    input.roster.length === 0
      ? "(none yet — every person mentioned is unresolved)"
      : input.roster
          .map((entry) => {
            const parts = [`id: ${entry.id}`, `name: ${entry.name}`];
            for (const field of lens.promptFields) {
              const value = entry.fields[field];
              if (typeof value === "string" && value.trim() !== "") parts.push(`${field}: ${value}`);
            }
            if (entry.aliases.length > 0) parts.push(`also called: ${entry.aliases.join(", ")}`);
            const hinted = input.hints.includes(entry.id) ? " (recorded about them)" : "";
            return `- ${parts.join(" | ")}${hinted}`;
          })
          .join("\n");
  return [
    `Today (when this was said): ${dayOf(input.referenceAt)}`,
    `Where it came from: ${lens.sourceLabels[input.source] ?? input.source}`,
    `People (attach facts only to these ids):\n${roster}`,
    `What was said:\n"""\n${input.content}\n"""`,
    // WHAT THEIR PHONE SAW, when the turn carried photographs — labelled as
    // such and quoted apart, because it is not testimony. The two halves are
    // different evidence and the instruction says so: what a text recogniser
    // READ off the photograph is as hard as evidence from a picture gets; the
    // description is a small model's impression and is soft. Named by its
    // CLAUSE, not its punctuation, because the description is free prose that
    // may wear quotation marks of its own.
    ...(input.observed
      ? [
          "Their phone read their photographs as the following. It is a machine's description " +
            "of a picture, not something they said — take what is plainly IN it and nothing " +
            `it implies:\n"""\n${input.observed}\n"""\n` +
            'If a clause there begins "Words I can read in them:" or "the words I can read:", ' +
            "everything quoted in THAT clause was read off the photograph itself by a text " +
            "recogniser — a book spine, a label, a stamp — so it is what the object SAYS. " +
            "Treat those as reliably present, and every other part of the reading as an " +
            "impression that may be wrong. Seeing a title on a shelf is evidence they own " +
            "that book, not that they have read it or liked it.",
        ]
      : []),
  ].join("\n\n");
}

export interface NewFactForReconcile {
  type: string;
  fact: string;
  validAt: Date | null;
  invalidAt: Date | null;
}

export function reconcileInput(
  lens: Lens,
  input: {
    person: { name: string; fields: Record<string, string | null> };
    referenceAt: Date;
    current: Fact[];
    incoming: NewFactForReconcile[];
    summary: string;
  },
): string {
  const when = (fact: { validAt: Date | null; invalidAt: Date | null }) =>
    [fact.validAt ? `true since ${dayOf(fact.validAt)}` : null, fact.invalidAt ? `until ${dayOf(fact.invalidAt)}` : null]
      .filter(Boolean)
      .join(", ");
  const current =
    input.current.length === 0
      ? "(nothing yet)"
      : input.current
          .map((fact) => {
            const dates = [when(fact), `told us ${dayOf(fact.createdAt)}`].filter(Boolean).join("; ");
            return `- ${fact.id} | ${fact.type} | ${fact.fact} | ${dates}`;
          })
          .join("\n");
  const incoming = input.incoming
    .map((fact, index) => {
      const dates = when(fact);
      return `- ${index} | ${fact.type} | ${fact.fact}${dates ? ` | ${dates}` : ""}`;
    })
    .join("\n");
  return [
    `Person: ${whoLabel(lens, input.person)}`,
    `Today (when the new facts were said): ${dayOf(input.referenceAt)}`,
    `Current facts (id | type | fact | dates):\n${current}`,
    `New facts (index | type | fact | dates):\n${incoming}`,
    `Current summary:\n"""\n${input.summary || "(none yet)"}\n"""`,
  ].join("\n\n");
}

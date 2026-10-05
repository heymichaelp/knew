import { endedByDate } from "./brief.ts";
import type { AskSpec, Lens } from "./lens.ts";
import type { Fact, Gap } from "./types.ts";

/**
 * GAPS — the forward-looking half. A lens declares the questions worth
 * answering about a person (`asks`); this says which of them the ledger does
 * not yet answer, so a client knows what to learn next and a reader knows
 * what the page is missing. Pure and deterministic: an ask applies when its
 * `when` clauses match the person's routing fields, and is answered when a
 * current fact of one of its `answeredBy` types exists.
 */

function applies(ask: AskSpec, fields: Readonly<Record<string, string | null>>): boolean {
  return (ask.when ?? []).every((clause) => {
    const value = fields[clause.field];
    if (typeof value !== "string") return false;
    const normalised = value.trim().toLowerCase();
    return clause.equals.some((candidate) => candidate.trim().toLowerCase() === normalised);
  });
}

export function gapsFor(
  lens: Lens,
  person: { fields: Readonly<Record<string, string | null>> },
  facts: Fact[],
  at: Date = new Date(),
): Gap[] {
  const live = new Set(facts.filter((fact) => !fact.expiredAt && !endedByDate(fact, at)).map((fact) => fact.type));
  return lens.asks
    .filter((ask) => applies(ask, person.fields) && !ask.answeredBy.some((type) => live.has(type)))
    .map((ask) => ({ id: ask.id, question: ask.question, answeredBy: [...ask.answeredBy] }));
}

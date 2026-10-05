import { parseLooseDate } from "./dates.ts";
import { isEnduringFactType, type Lens } from "./lens.ts";
import type { Fact, NewFact, ReconciliationPlan } from "./types.ts";

/**
 * The reconciliation PLAN: given what we currently believe about one person,
 * the facts just extracted, and the model's decisions about each, decide what
 * happens to every row — and nothing else. Pure, so the service applies it in
 * a transaction and a client applies it to its own store, from the same
 * decisions.
 *
 * The rules, each a bug first:
 *  - a fact the model forgot to decide about is kept (an add): losing
 *    something the person said is worse than a near-duplicate;
 *  - an id the model was never shown downgrades the decision to an add, and
 *    is reported — a wrongly retired fact is lost from the page;
 *  - an ENDURING fact replaced by a different KIND of fact is not a
 *    correction; both are true, so the new one is added beside it;
 *  - a fact already superseded in this batch is not superseded twice.
 */

/** What the reconcile model answers, as the plan reads it. */
export interface ReconcileDecisions {
  decisions: Array<{
    newIndex: number;
    action: "add" | "merge" | "supersede" | "drop";
    factId: string | null;
    invalidAt: string | null;
  }>;
  summary: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const trimTo = (text: string, max: number) => text.trim().slice(0, max);

export const SUMMARY_MAX_CHARS = 1_500;
export const FACT_MAX_CHARS = 500;

export function planReconciliation(input: {
  lens: Lens;
  personId: string;
  current: Fact[];
  incoming: NewFact[];
  reconciliation: ReconcileDecisions;
  knownAt: Date;
  summaryVersion: string;
  aliases?: string[];
}): ReconciliationPlan {
  const { lens, current, incoming, reconciliation } = input;
  const currentIds = new Set(current.map((fact) => fact.id));
  const typeOf = new Map(current.map((fact) => [fact.id, fact.type]));
  const superseded = new Set<string>();
  const unknownFactIds: string[] = [];
  const plan: ReconciliationPlan = {
    personId: input.personId,
    adds: [],
    merges: [],
    supersessions: [],
    retractions: [],
    dropped: 0,
    unknownFactIds,
    summary: null,
    summaryVersion: input.summaryVersion,
    knownAt: input.knownAt,
    aliases: input.aliases ?? [],
  };

  // A cited id must be a CURRENT fact of this person. The ids come from a
  // model; the owner scope comes from the caller, who passed only this
  // person's facts.
  const citedCurrent = (id: string | null): string | null => {
    if (!id) return null;
    if (UUID_RE.test(id) && currentIds.has(id)) return id;
    unknownFactIds.push(id);
    return null;
  };

  incoming.forEach((fact, index) => {
    const decision = reconciliation.decisions.find((d) => d.newIndex === index) ?? {
      action: "add" as const,
      factId: null,
      invalidAt: null,
    };
    switch (decision.action) {
      case "drop":
        plan.dropped += 1;
        return;
      case "merge": {
        const cited = citedCurrent(decision.factId);
        if (cited) plan.merges.push({ factId: cited });
        else plan.adds.push(fact);
        return;
      }
      case "supersede": {
        const cited = citedCurrent(decision.factId);
        if (cited && isEnduringFactType(lens, typeOf.get(cited)!) && typeOf.get(cited) !== fact.type) {
          plan.adds.push(fact);
        } else if (cited && !superseded.has(cited)) {
          superseded.add(cited);
          plan.supersessions.push({ factId: cited, replacement: fact, invalidAt: parseLooseDate(decision.invalidAt) });
        } else {
          plan.adds.push(fact);
        }
        return;
      }
      default:
        plan.adds.push(fact);
    }
  });

  const summary = trimTo(reconciliation.summary, SUMMARY_MAX_CHARS);
  plan.summary = summary === "" ? null : summary;
  return plan;
}

/**
 * The facts extraction proposed, kept only for people on the roster and
 * grouped by person. Attribution is checked here, not trusted: a fact naming
 * an id that is not on THIS subject's roster is dropped, whatever the model
 * meant.
 */
export function attributeFacts(
  facts: Array<{
    personId: string;
    type: string;
    fact: string;
    attributes: Record<string, unknown> | null;
    validAt: string | null;
    invalidAt: string | null;
  }>,
  onRoster: ReadonlySet<string>,
): { byPerson: Map<string, NewFact[]>; offRoster: number } {
  const byPerson = new Map<string, NewFact[]>();
  let offRoster = 0;
  for (const fact of facts) {
    if (!onRoster.has(fact.personId)) {
      offRoster += 1;
      continue;
    }
    const list = byPerson.get(fact.personId) ?? [];
    list.push({
      type: fact.type,
      fact: trimTo(fact.fact, FACT_MAX_CHARS),
      // Nulls are "not said"; the type's own schema keeps what it defines.
      attributes: Object.fromEntries(Object.entries(fact.attributes ?? {}).filter(([, value]) => value != null)),
      validAt: parseLooseDate(fact.validAt),
      invalidAt: parseLooseDate(fact.invalidAt),
    });
    byPerson.set(fact.personId, list);
  }
  return { byPerson, offRoster };
}

/** Hinted people first, then the most-discussed; past the cap, dropped and
 *  counted rather than silently lost. */
export function orderSubjects(
  byPerson: Map<string, NewFact[]>,
  hints: readonly string[],
  cap: number,
): { kept: string[]; droppedForCap: number } {
  const subjects = [...byPerson.keys()].sort((a, b) => {
    const hinted = Number(hints.includes(b)) - Number(hints.includes(a));
    return hinted || byPerson.get(b)!.length - byPerson.get(a)!.length;
  });
  const kept = subjects.slice(0, cap);
  const droppedForCap = subjects.slice(cap).reduce((sum, id) => sum + byPerson.get(id)!.length, 0);
  return { kept, droppedForCap };
}

/** Proposals as the sweep keeps them: trimmed, deduplicated, on-roster only,
 *  and a field update only for a field the lens routes. */
export function cleanProposals(
  extraction: {
    unresolvedNames: string[];
    fieldUpdates: Array<{ personId: string; field: string; value: string }>;
    aliases: Array<{ personId: string; alias: string }>;
  },
  onRoster: ReadonlySet<string>,
  routingFields: readonly string[] = [],
): {
  unresolvedNames: string[];
  fieldUpdates: Array<{ personId: string; field: string; value: string }>;
  aliases: Array<{ personId: string; alias: string }>;
} {
  return {
    unresolvedNames: [...new Set(extraction.unresolvedNames.map((name) => trimTo(name, 100)).filter(Boolean))].slice(0, 20),
    fieldUpdates: extraction.fieldUpdates
      .filter((update) => onRoster.has(update.personId) && routingFields.includes(update.field))
      .map((update) => ({ ...update, value: trimTo(update.value, 200) })),
    aliases: extraction.aliases
      .filter((alias) => onRoster.has(alias.personId))
      .map((alias) => ({ ...alias, alias: trimTo(alias.alias, 100) }))
      .filter((alias) => alias.alias !== ""),
  };
}

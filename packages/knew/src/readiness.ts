import { endedByDate, lastSaidOf } from "./brief.ts";
import { ENGINE_DEFAULTS } from "./defaults.ts";
import type { CompiledNeed, Lens } from "./lens.ts";
import type { DimensionEvidence, Direction, Fact, Gap, NeedStanding, Readiness, Subject } from "./types.ts";
import { factType, type Vocabulary } from "./vocabulary.ts";

/**
 * READINESS: what is understood about an entity, what the lens's objective
 * still needs, and the most valuable direction to take that understanding.
 *
 *  - CURRENT UNDERSTANDING belongs to the vocabulary and needs no objective:
 *    per dimension, how many current facts there are, how many are due for a
 *    revisit, and when any was last said. A dimension is about the entity,
 *    the relationship with it (both kept on the entity), or the knower (kept
 *    on the knower, and the same beside every entity).
 *  - MISSING UNDERSTANDING belongs to the lens: per need, a strength against
 *    its `enough` and a state.
 *  - THE NEXT DIRECTIONS, in order of value: a need to learn more about, or
 *    understanding gone stale to revisit. knew names the direction; the
 *    client decides what to do with it.
 *
 * Weights order directions; they never weigh what is believed. The page stays
 * dated and unweighted, and a fact due for a revisit is still on it exactly
 * as before.
 *
 * Pure and deterministic. Strength, value and overall are worked out exactly
 * and rounded to three places only on the way out, so every driver answers the
 * same JSON and a tie is a tie.
 */

const DAY_MS = 86_400_000;

const round = (value: number): number => Math.round(value * 1000) / 1000;

function applies(need: CompiledNeed, fields: Readonly<Record<string, string | null>>): boolean {
  return need.when.every((clause) => {
    const value = fields[clause.field];
    if (typeof value !== "string") return false;
    const normalised = value.trim().toLowerCase();
    return clause.equals.some((candidate) => candidate.trim().toLowerCase() === normalised);
  });
}

/** Whether a fact is due for a revisit at `at`: its type has a revisit window,
 *  and that long has passed since it was last said — on the day itself, as an
 *  end date ends a fact on its day. */
export function isDueForRevisit(vocabulary: Vocabulary, fact: Fact, at: Date): boolean {
  const days = factType(vocabulary, fact.type).revisitAfterDays;
  return days !== null && at.getTime() - lastSaidOf(fact).getTime() >= days * DAY_MS;
}

/** A need of a dimension counts every type in it, a retired type reading as
 *  the fallback; a need that names its types counts exactly those. */
function counts(vocabulary: Vocabulary, need: CompiledNeed, fact: Fact): boolean {
  return need.dimension !== null ? factType(vocabulary, fact.type).dimension === need.dimension : need.types.includes(fact.type);
}

const newestSaidFirst = (a: Fact, b: Fact): number => lastSaidOf(b).getTime() - lastSaidOf(a).getTime() || a.id.localeCompare(b.id);
const oldestSaidFirst = (a: Fact, b: Fact): number => lastSaidOf(a).getTime() - lastSaidOf(b).getTime() || a.id.localeCompare(b.id);

/**
 * What is known about one entity through one lens, at `at`.
 *
 * `facts` are the facts believed at `at` (`factsKnownAt`); a fact whose own
 * end date has passed by `at` is over and counts for nothing, as on the page.
 * The entity's facts hold what is known about it and about the relationship
 * with it; `knower` holds what is known about the knower. Each need counts the
 * set its subject is kept in, so a need about the knower is met for every
 * entity at once, and the directions rank all three together.
 *
 * For a need with n current facts, d of them due for a revisit and f fresh:
 *
 *  - strength is 1 when f meets `enough`; otherwise
 *    (f + dueCredit · min(d, enough − f)) / enough — a fact due for a revisit
 *    counts for something, and never for enough;
 *  - it is `met` when f ≥ enough; `waiting` while an applicable need it comes
 *    `after` is not yet met (n ≥ enough, fresh or not; a need whose `when`
 *    does not match this entity counts as met); `due` when n ≥ enough;
 *    `thin` when n > 0; and `open` otherwise.
 *
 * An open or thin need is a direction of kind "learn", built on its own facts,
 * newest said first, or, when it has none, on the facts of the needs it comes
 * after. A due need is a direction of kind "revisit" carrying the facts due,
 * oldest said first. A direction's value is weight · (1 − strength);
 * directions run from the highest value, ties in the lens's order, or, for a
 * lens whose `order` is `listed`, in the lens's order alone.
 */
export function readinessFor(
  lens: Lens,
  entity: { fields: Readonly<Record<string, string | null>> },
  facts: Fact[],
  at: Date = new Date(),
  knower: Fact[] = [],
): Readiness {
  const vocabulary = lens.vocabulary;
  // One row per fact id, however the caller assembled the ledger; what is current at `at`.
  const currentOf = (ledger: Fact[]) => [...new Map(ledger.map((fact) => [fact.id, fact])).values()].filter((fact) => !fact.expiredAt && !endedByDate(fact, at));
  const ofEntity = currentOf(facts);
  const ofKnower = currentOf(knower);
  const pool = (about: Subject) => (about === "knower" ? ofKnower : ofEntity);
  const due = (fact: Fact) => isDueForRevisit(vocabulary, fact, at);

  const dimensions: DimensionEvidence[] = vocabulary.dimensions.map((dimension) => {
    const held = pool(dimension.about).filter((fact) => factType(vocabulary, fact.type).dimension === dimension.id).sort(newestSaidFirst);
    return {
      id: dimension.id,
      label: dimension.label,
      about: dimension.about,
      facts: held.length,
      due: held.filter(due).length,
      lastSaidAt: held.length > 0 ? lastSaidOf(held[0]!) : null,
      factIds: held.map((fact) => fact.id),
    };
  });

  const applicable = lens.needs.filter((need) => applies(need, entity.fields));
  const heard = new Map(
    applicable.map((need) => {
      const held = pool(need.about).filter((fact) => counts(vocabulary, need, fact)).sort(newestSaidFirst);
      return [need.id, { held, due: held.filter(due) }] as const;
    }),
  );
  // A need that does not apply to this entity never holds another back.
  const met = (id: string): boolean => {
    const need = applicable.find((candidate) => candidate.id === id);
    return !need || heard.get(id)!.held.length >= need.enough;
  };

  // The exact strength of each need: rounding happens once, on the way out.
  const exact = new Map<string, number>();
  const needs: NeedStanding[] = applicable.map((need) => {
    const { held, due: dueFacts } = heard.get(need.id)!;
    const n = held.length;
    const d = dueFacts.length;
    const f = n - d;
    const raw = f >= need.enough ? 1 : (f + ENGINE_DEFAULTS.dueCredit * Math.min(d, need.enough - f)) / need.enough;
    exact.set(need.id, raw);
    const strength = round(raw);
    const waitingOn = f >= need.enough ? [] : need.after.filter((id) => !met(id));
    const state = f >= need.enough ? "met" : waitingOn.length > 0 ? "waiting" : n >= need.enough ? "due" : n > 0 ? "thin" : "open";
    return {
      id: need.id,
      label: need.label,
      about: need.about,
      dimension: need.dimension,
      types: [...need.types],
      weight: need.weight,
      enough: need.enough,
      facts: n,
      due: d,
      strength,
      state,
      waitingOn,
      factIds: held.map((fact) => fact.id),
    };
  });

  const order = new Map(lens.needs.map((need, index) => [need.id, index]));
  const next: Direction[] = needs
    .filter((standing) => standing.state === "open" || standing.state === "thin" || standing.state === "due")
    .map((standing): Direction => {
      const value = round(standing.weight * (1 - exact.get(standing.id)!));
      const about = { need: standing.id, label: standing.label, about: standing.about, dimension: standing.dimension, types: [...standing.types], value };
      if (standing.state === "due") {
        const dueFacts = [...heard.get(standing.id)!.due].sort(oldestSaidFirst);
        return { kind: "revisit", ...about, factIds: dueFacts.map((fact) => fact.id) };
      }
      let builtOn = standing.factIds;
      if (builtOn.length === 0) {
        const need = applicable.find((candidate) => candidate.id === standing.id)!;
        const before = need.after.flatMap((id) => heard.get(id)?.held ?? []);
        builtOn = [...new Map(before.map((fact) => [fact.id, fact])).values()].sort(newestSaidFirst).map((fact) => fact.id);
      }
      return { kind: "learn", ...about, factIds: builtOn };
    })
    .sort((a, b) => (lens.order === "listed" ? 0 : b.value - a.value) || order.get(a.need)! - order.get(b.need)!);

  const totalWeight = needs.reduce((sum, standing) => sum + standing.weight, 0);
  return {
    lens: lens.id,
    objective: lens.objective,
    at,
    overall: needs.length > 0 ? round(needs.reduce((sum, standing) => sum + standing.weight * exact.get(standing.id)!, 0) / totalWeight) : null,
    dimensions,
    needs,
    next,
  };
}

/**
 * The gaps: the missing understanding, in order of value — the "learn"
 * directions of `readinessFor`. A need waiting on another, one met, and one
 * whose facts are only due for a revisit are not gaps.
 */
export function gapsFor(
  lens: Lens,
  entity: { fields: Readonly<Record<string, string | null>> },
  facts: Fact[],
  at: Date = new Date(),
  knower: Fact[] = [],
): Gap[] {
  return readinessFor(lens, entity, facts, at, knower)
    .next.filter((direction) => direction.kind === "learn")
    .map(({ need, label, about, dimension, types }) => ({ need, label, about, dimension, types }));
}

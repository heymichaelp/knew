import { endedByDate, lastSaidOf } from "./brief.ts";
import { ENGINE_DEFAULTS } from "./defaults.ts";
import type { CompiledAsk, Lens } from "./lens.ts";
import type { AskStanding, DimensionEvidence, Fact, Gap, NextStep, Readiness } from "./types.ts";
import { factType, type Vocabulary } from "./vocabulary.ts";

/**
 * READINESS — the forward-looking half. What is known about an entity, how
 * strongly, and what to learn next to reach the lens's objective. Two kinds of
 * strength, kept apart on purpose:
 *
 *  - EVIDENCE belongs to the vocabulary and needs no objective: per
 *    dimension, how many current facts there are, how many are due for a
 *    revisit, and when any was last said. A single strength per dimension would
 *    smuggle an objective in, because "known how well?" only has an answer to
 *    "enough for what?".
 *  - SUFFICIENCY belongs to the lens: per ask, a strength against its
 *    `enough`, a state, its weight; the overall readiness; and the next steps,
 *    in order — the top one is the next question.
 *
 * Weights order what to LEARN; they never weigh what is BELIEVED. The page
 * stays dated and unweighted, a revisit is a question rather than a judgment
 * that a fact stopped being true, and a fact due for a revisit is still on
 * the page exactly as before. With no `weight`, `enough`, `after` or
 * `revisitAfterDays` declared, the gaps are exactly what they always were:
 * every applicable ask with no current fact, in the lens's order.
 *
 * Pure and deterministic. Strength, value and overall are worked out exactly
 * and rounded to three places only on the way out, so every driver answers the
 * same JSON and a tie is a tie.
 */

const DAY_MS = 86_400_000;

const round = (value: number): number => Math.round(value * 1000) / 1000;

function applies(ask: CompiledAsk, fields: Readonly<Record<string, string | null>>): boolean {
  return ask.when.every((clause) => {
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

/** A dimension ask hears every type in its dimension, a retired type reading as
 *  the fallback; an ask that names its types hears exactly those, as the gaps
 *  always matched them. */
function answers(vocabulary: Vocabulary, ask: CompiledAsk, fact: Fact): boolean {
  return ask.dimension !== null ? factType(vocabulary, fact.type).dimension === ask.dimension : ask.answeredBy.includes(fact.type);
}

const newestSaidFirst = (a: Fact, b: Fact): number => lastSaidOf(b).getTime() - lastSaidOf(a).getTime() || a.id.localeCompare(b.id);
const oldestSaidFirst = (a: Fact, b: Fact): number => lastSaidOf(a).getTime() - lastSaidOf(b).getTime() || a.id.localeCompare(b.id);

/**
 * What is known about one entity through one lens, at `at`.
 *
 * `facts` are the facts believed at `at` (`factsKnownAt`); a fact whose own
 * end date has passed by `at` is over and counts for nothing, as on the page.
 * For an ask with n current facts, d of them due for a revisit and f fresh:
 *
 *  - strength is 1 when f meets `enough`; otherwise
 *    (f + dueCredit · min(d, enough − f)) / enough — a fact due for a revisit
 *    counts for something, and never for enough;
 *  - it is `met` when f ≥ enough; `waiting` while an applicable ask it comes
 *    `after` is not yet answered (n ≥ enough, fresh or not; an ask whose `when`
 *    does not match this entity counts as answered); `due` when n ≥ enough;
 *    `thin` when n > 0; and `open` otherwise.
 *
 * An open or thin ask is a step of kind "ask", anchored on its own facts,
 * newest said first — or, when it has none, on the facts of the asks it came
 * after, so a client can go one notch finer from something known. A due ask
 * is a step of kind "revisit" carrying the facts due, oldest said first. A
 * step's value is weight · (1 − strength); steps run from the highest value,
 * ties in the lens's order.
 */
export function readinessFor(
  lens: Lens,
  entity: { fields: Readonly<Record<string, string | null>> },
  facts: Fact[],
  at: Date = new Date(),
): Readiness {
  const vocabulary = lens.vocabulary;
  // One row per fact id, however the caller assembled the ledger.
  const unique = [...new Map(facts.map((fact) => [fact.id, fact])).values()];
  const current = unique.filter((fact) => !fact.expiredAt && !endedByDate(fact, at));
  const due = (fact: Fact) => isDueForRevisit(vocabulary, fact, at);

  const dimensions: DimensionEvidence[] = vocabulary.dimensions.map((dimension) => {
    const held = current.filter((fact) => factType(vocabulary, fact.type).dimension === dimension.id).sort(newestSaidFirst);
    return {
      id: dimension.id,
      label: dimension.label,
      facts: held.length,
      due: held.filter(due).length,
      lastSaidAt: held.length > 0 ? lastSaidOf(held[0]!) : null,
      factIds: held.map((fact) => fact.id),
    };
  });

  const applicable = lens.asks.filter((ask) => applies(ask, entity.fields));
  const heard = new Map(
    applicable.map((ask) => {
      const held = current.filter((fact) => answers(vocabulary, ask, fact)).sort(newestSaidFirst);
      return [ask.id, { held, due: held.filter(due) }] as const;
    }),
  );
  // An ask that does not apply to this entity never holds another back.
  const answered = (id: string): boolean => {
    const ask = applicable.find((candidate) => candidate.id === id);
    return !ask || heard.get(id)!.held.length >= ask.enough;
  };

  // The exact strength of each ask: rounding happens once, on the way out.
  const exact = new Map<string, number>();
  const asks: AskStanding[] = applicable.map((ask) => {
    const { held, due: dueFacts } = heard.get(ask.id)!;
    const n = held.length;
    const d = dueFacts.length;
    const f = n - d;
    const raw = f >= ask.enough ? 1 : (f + ENGINE_DEFAULTS.dueCredit * Math.min(d, ask.enough - f)) / ask.enough;
    exact.set(ask.id, raw);
    const strength = round(raw);
    const waitingOn = f >= ask.enough ? [] : ask.after.filter((id) => !answered(id));
    const state = f >= ask.enough ? "met" : waitingOn.length > 0 ? "waiting" : n >= ask.enough ? "due" : n > 0 ? "thin" : "open";
    return {
      id: ask.id,
      question: ask.question,
      dimension: ask.dimension,
      answeredBy: [...ask.answeredBy],
      weight: ask.weight,
      enough: ask.enough,
      facts: n,
      due: d,
      strength,
      state,
      waitingOn,
      factIds: held.map((fact) => fact.id),
    };
  });

  const order = new Map(lens.asks.map((ask, index) => [ask.id, index]));
  const next: NextStep[] = asks
    .filter((standing) => standing.state === "open" || standing.state === "thin" || standing.state === "due")
    .map((standing): NextStep => {
      const value = round(standing.weight * (1 - exact.get(standing.id)!));
      if (standing.state === "due") {
        const dueFacts = [...heard.get(standing.id)!.due].sort(oldestSaidFirst);
        return { kind: "revisit", ask: standing.id, question: standing.question, value, factIds: dueFacts.map((fact) => fact.id) };
      }
      let anchors = standing.factIds;
      if (anchors.length === 0) {
        const ask = applicable.find((candidate) => candidate.id === standing.id)!;
        const before = ask.after.flatMap((id) => heard.get(id)?.held ?? []);
        anchors = [...new Map(before.map((fact) => [fact.id, fact])).values()].sort(newestSaidFirst).map((fact) => fact.id);
      }
      return { kind: "ask", ask: standing.id, question: standing.question, value, factIds: anchors };
    })
    .sort((a, b) => b.value - a.value || order.get(a.ask)! - order.get(b.ask)!);

  const totalWeight = asks.reduce((sum, standing) => sum + standing.weight, 0);
  return {
    lens: lens.id,
    objective: lens.objective,
    at,
    overall: asks.length > 0 ? round(asks.reduce((sum, standing) => sum + standing.weight * exact.get(standing.id)!, 0) / totalWeight) : null,
    dimensions,
    asks,
    next,
  };
}

/**
 * The gaps: the asks still worth asking, in the order to ask them — the "ask"
 * steps of `readinessFor`. An ask waiting on another, one met, and one whose
 * facts are only due for a revisit are not gaps.
 */
export function gapsFor(
  lens: Lens,
  entity: { fields: Readonly<Record<string, string | null>> },
  facts: Fact[],
  at: Date = new Date(),
): Gap[] {
  const byId = new Map(lens.asks.map((ask) => [ask.id, ask]));
  return readinessFor(lens, entity, facts, at)
    .next.filter((step) => step.kind === "ask")
    .map((step) => {
      const ask = byId.get(step.ask)!;
      return { id: ask.id, question: ask.question, dimension: ask.dimension, answeredBy: [...ask.answeredBy] };
    });
}

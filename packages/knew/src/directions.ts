import { ENGINE_DEFAULTS } from "./defaults.ts";
import type { NextAnswer } from "./schemas.ts";
import type { DirectionPlan, Fact, Grounded, NewDirection, ProposedDirection } from "./types.ts";
import type { Vocabulary } from "./vocabulary.ts";

/**
 * DIRECTIONS: what to learn next about an entity, proposed by the model's
 * `next` call inside the vocabulary's dimensions, from what is known. A
 * direction is a topic, never a question, and never evidence: the page, the
 * facts and the summary are untouched by it.
 *
 * Everything here is pure. `planDirections` is the planner: given what the
 * model answered and what the entity holds, it decides which rows stand and
 * counts the rest as refused, the way `planReconciliation` treats a fact id the
 * model was never shown. A driver or a stateless app applies the plan to its
 * own store with `applyDirectionPlan`; `readinessFor` ranks what is live.
 */

/** A label longer than this is a paragraph, not a direction. */
export const DIRECTION_MAX_CHARS = 200;

const DAY_MS = 86_400_000;

/** A label as a repeat is judged: trimmed and case-folded. */
const keyOf = (label: string): string => label.trim().toLowerCase();

/** Whether a direction has lapsed at `at`: nobody acted on it for the
 *  vocabulary's window, counted from the day it was proposed and due on the
 *  day itself, as a revisit window is. */
export function isLapsed(direction: ProposedDirection, lapseAfterDays: number, at: Date): boolean {
  return at.getTime() - direction.proposedAt.getTime() >= lapseAfterDays * DAY_MS;
}

/** The directions live at `at`: proposed by then, not resolved by then (one
 *  answered or dismissed later was, at `at`, still open), and not lapsed. */
export function liveDirectionsAt(directions: ProposedDirection[], at: Date, lapseAfterDays: number): ProposedDirection[] {
  return directions.filter(
    (direction) => direction.proposedAt <= at && (direction.resolvedAt === null || direction.resolvedAt > at) && !isLapsed(direction, lapseAfterDays, at),
  );
}

/**
 * The plan for one `next` answer. Closures come first, so an answer can close
 * one direction and propose another in its place: a row is refused when it
 * names a direction that is not open, cites a fact that is not current, puts
 * a proposal in a dimension not offered, writes a label that is empty, a
 * question, too long, or a repeat of one open or one the knower dismissed, or
 * proposes past the room its dimension has left. Room counts what is live
 * once the closures are applied: a lapsed direction takes none, and is still
 * open to be answered or withdrawn.
 */
export function planDirections(input: {
  vocabulary: Vocabulary;
  /** The entity's facts; only the current ones ground anything. */
  facts: Fact[];
  /** The entity's directions, every status. */
  directions: ProposedDirection[];
  answer: NextAnswer;
  at: Date;
}): DirectionPlan {
  const { vocabulary, answer, at } = input;
  const settings = vocabulary.directions ?? { perDimension: ENGINE_DEFAULTS.directionsPerDimension, lapseAfterDays: ENGINE_DEFAULTS.directionLapseDays };
  const current = new Set(input.facts.filter((fact) => !fact.expiredAt).map((fact) => fact.id));
  const open = new Map(input.directions.filter((direction) => direction.status === "open").map((direction) => [direction.id, direction]));
  const resolved = new Set<string>();
  let rejected = 0;

  const answered: DirectionPlan["answered"] = [];
  for (const row of answer.answered) {
    if (!open.has(row.directionId) || resolved.has(row.directionId) || !current.has(row.factId)) {
      rejected += 1;
      continue;
    }
    resolved.add(row.directionId);
    answered.push({ id: row.directionId, factId: row.factId });
  }
  const withdrawn: string[] = [];
  for (const id of answer.withdrawn) {
    if (!open.has(id) || resolved.has(id)) {
      rejected += 1;
      continue;
    }
    resolved.add(id);
    withdrawn.push(id);
  }

  const standing = liveDirectionsAt(
    [...open.values()].filter((direction) => !resolved.has(direction.id)),
    at,
    settings.lapseAfterDays,
  );
  const room = new Map<string, number>();
  for (const dimension of vocabulary.dimensions) {
    room.set(dimension.id, settings.perDimension - standing.filter((direction) => direction.dimension === dimension.id).length);
  }
  const taken = new Set(input.directions.filter((direction) => direction.status === "open" || direction.status === "dismissed").map((direction) => keyOf(direction.label)));
  const proposed: NewDirection[] = [];
  for (const row of answer.proposed) {
    const dimension = vocabulary.dimensions.find((candidate) => candidate.id === row.dimension);
    const label = row.label.trim();
    const factIds = [...new Set(row.factIds)];
    if (
      !dimension ||
      dimension.about === "knower" ||
      label === "" ||
      label.endsWith("?") ||
      label.length > DIRECTION_MAX_CHARS ||
      taken.has(keyOf(label)) ||
      !factIds.every((id) => current.has(id)) ||
      (room.get(dimension.id) ?? 0) <= 0
    ) {
      rejected += 1;
      continue;
    }
    taken.add(keyOf(label));
    room.set(dimension.id, room.get(dimension.id)! - 1);
    proposed.push({ dimension: dimension.id, label, factIds });
  }
  return { answered, withdrawn, proposed, rejected };
}

/** Apply a plan to an entity's directions, in place: the answered and the
 *  withdrawn close, dated `at`, and the proposed are minted. Returns the new
 *  records. */
export function applyDirectionPlan(
  directions: ProposedDirection[],
  plan: DirectionPlan,
  context: { entityId: string; at: Date; episodeId: string | null; newId: () => string },
): ProposedDirection[] {
  const byId = new Map(directions.map((direction) => [direction.id, direction]));
  for (const { id, factId } of plan.answered) {
    const direction = byId.get(id);
    if (direction && direction.status === "open") {
      direction.status = "answered";
      direction.answeredBy = factId;
      direction.resolvedAt = context.at;
    }
  }
  for (const id of plan.withdrawn) {
    const direction = byId.get(id);
    if (direction && direction.status === "open") {
      direction.status = "withdrawn";
      direction.resolvedAt = context.at;
    }
  }
  const minted = plan.proposed.map(
    (row): ProposedDirection => ({
      id: context.newId(),
      entityId: context.entityId,
      dimension: row.dimension,
      label: row.label,
      factIds: [...row.factIds],
      episodeId: context.episodeId,
      proposedAt: context.at,
      status: "open",
      answeredBy: null,
      resolvedAt: null,
    }),
  );
  directions.push(...minted);
  return minted;
}

/** A fact superseded: every direction or move that grew from it grows from its replacement now. */
export function regroundDirections(grounded: Grounded[], from: string, to: string): void {
  for (const item of grounded) {
    if (item.factIds.includes(from)) item.factIds = [...new Set(item.factIds.map((id) => (id === from ? to : id)))];
  }
}

/** An open direction or move whose every ground is gone is withdrawn: nothing
 *  it grew from is believed any more. One that grew from nothing stands.
 *  Returns the ids withdrawn. */
export function withdrawUngrounded(grounded: Grounded[], isCurrent: (factId: string) => boolean, at: Date): string[] {
  const withdrawn: string[] = [];
  for (const item of grounded) {
    if (item.status === "open" && item.factIds.length > 0 && !item.factIds.some(isCurrent)) {
      item.status = "withdrawn";
      item.resolvedAt = at;
      withdrawn.push(item.id);
    }
  }
  return withdrawn;
}

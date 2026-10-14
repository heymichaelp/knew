import type { Adapter } from "./adapter.ts";
import { dayOf, parseLooseDate } from "./dates.ts";
import type { MoveAnswer } from "./schemas.ts";
import type { Fact, Move, MovePlan, NewMove } from "./types.ts";
import { factType } from "./vocabulary.ts";

/**
 * MOVES: what an adapter's kind calls for about an entity, proposed by the
 * model's `move` call from what is known. A move is a proposal the app acts
 * on, never evidence: the page, the facts and the summary are untouched by it.
 *
 * Everything here is pure. `planMoves` is the planner: given what the model
 * answered under one adapter and what the entity holds, it decides which rows
 * stand and counts the rest as refused, as `planDirections` does. A driver or
 * a stateless app applies the plan to its own store with `applyMovePlan`.
 */

/** A label or a field longer than this is a paragraph, not a move. */
export const MOVE_MAX_CHARS = 200;

const DAY_MS = 86_400_000;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A whole day, `YYYY-MM-DD`, that exists: "2026-02-30" is not one, whatever
 *  the runtime's parser makes of it. */
function strictDay(value: string | null | undefined): Date | null {
  if (!value || !DAY_RE.test(value)) return null;
  const date = parseLooseDate(value);
  return date && dayOf(date) === value ? date : null;
}

/** The day a move's date field names, when the adapter names one and the move has it. */
export function dayOfMove(move: Move, adapter: Adapter): Date | null {
  return adapter.lapse.field ? strictDay(move.fields[adapter.lapse.field]) : null;
}

/** Whether a move has lapsed at `at`: its own day has passed, or, with none,
 *  the adapter's window since it was proposed. On the day itself a move with a
 *  day still stands; it lapses the day after. */
export function isMoveLapsed(move: Move, adapter: Adapter, at: Date): boolean {
  const day = dayOfMove(move, adapter);
  if (day) return at.getTime() >= day.getTime() + DAY_MS;
  return at.getTime() - move.proposedAt.getTime() >= adapter.lapse.afterDays * DAY_MS;
}

/** The moves live at `at`: proposed by then, not resolved by then (one closed
 *  later was, at `at`, still open), and not lapsed. */
export function liveMovesAt(moves: Move[], adapter: Adapter, at: Date): Move[] {
  return moves.filter((move) => move.proposedAt <= at && (move.resolvedAt === null || move.resolvedAt > at) && !isMoveLapsed(move, adapter, at));
}

/** A label as a repeat is judged: trimmed and case-folded, with the day it is for when the adapter keeps one. */
const keyOf = (adapter: Adapter, label: string, fields: Record<string, string | null>): string =>
  `${label.trim().toLowerCase()}\u0000${adapter.lapse.field ? (fields[adapter.lapse.field] ?? "") : ""}`;

/** A proposal's fields as the adapter defines them: text trimmed, a date
 *  strict, an enum one of its values; anything else, or anything too long, is
 *  null rather than a reason to lose the move. */
function fieldsOf(adapter: Adapter, raw: Record<string, string | null | undefined>): Record<string, string | null> {
  const fields: Record<string, string | null> = {};
  for (const field of adapter.fields) {
    const value = raw[field.name];
    const text = typeof value === "string" ? value.trim() : "";
    if (text === "" || text.length > MOVE_MAX_CHARS) fields[field.name] = null;
    else if (field.kind === "date") fields[field.name] = strictDay(text) ? text : null;
    else if (field.kind === "enum") fields[field.name] = field.values!.includes(text) ? text : null;
    else fields[field.name] = text;
  }
  return fields;
}

const CLOSED_AS = { done: "done", answered: "answered", stale: "withdrawn" } as const;

/**
 * The plan for one `move` answer under one adapter. Closures come first, so an
 * answer can close one move and propose another in its place. A row is
 * refused when it names a move that is not open; proposes nothing to rest on,
 * or rests on a fact that is not current, is pinned, or is outside the
 * adapter's dimensions; writes a label that is empty, a question, too long, or
 * a repeat (the same label for the same day) of one open or one the knower
 * dismissed; or proposes past the room its kind has left. Room counts what is
 * live once the closures are applied: a lapsed move takes none, and is still
 * open to be closed.
 */
export function planMoves(input: { adapter: Adapter; facts: Fact[]; moves: Move[]; answer: MoveAnswer; at: Date }): MovePlan {
  const { adapter, answer, at } = input;
  const vocabulary = adapter.vocabulary;
  const current = new Map(input.facts.filter((fact) => !fact.expiredAt).map((fact) => [fact.id, fact]));
  const dimensions = new Set(adapter.dimensions);
  const grounds = (id: string): boolean => {
    const fact = current.get(id);
    if (!fact) return false;
    const type = factType(vocabulary, fact.type);
    return !type.pinned && dimensions.has(type.dimension);
  };
  const open = new Map(input.moves.filter((move) => move.status === "open").map((move) => [move.id, move]));
  const resolved = new Set<string>();
  let rejected = 0;

  const closed: MovePlan["closed"] = [];
  for (const row of answer.closed) {
    if (!open.has(row.moveId) || resolved.has(row.moveId)) {
      rejected += 1;
      continue;
    }
    resolved.add(row.moveId);
    closed.push({ id: row.moveId, status: CLOSED_AS[row.reason] });
  }

  const standing = liveMovesAt(
    [...open.values()].filter((move) => !resolved.has(move.id)),
    adapter,
    at,
  );
  let room = adapter.perEntity - standing.length;
  const taken = new Set(input.moves.filter((move) => move.status === "open" || move.status === "dismissed").map((move) => keyOf(adapter, move.label, move.fields)));
  const proposed: NewMove[] = [];
  for (const row of answer.proposed) {
    const label = row.label.trim();
    const factIds = [...new Set(row.factIds)];
    const fields = fieldsOf(adapter, row.fields ?? {});
    if (
      label === "" ||
      label.endsWith("?") ||
      label.length > MOVE_MAX_CHARS ||
      factIds.length === 0 ||
      !factIds.every(grounds) ||
      taken.has(keyOf(adapter, label, fields)) ||
      room <= 0
    ) {
      rejected += 1;
      continue;
    }
    taken.add(keyOf(adapter, label, fields));
    room -= 1;
    proposed.push({ label, fields, factIds });
  }
  return { closed, proposed, rejected };
}

/** Apply a plan to an entity's moves under one adapter, in place: the closed
 *  take their status, dated `at`, and the proposed are minted. Returns the
 *  new records. */
export function applyMovePlan(
  moves: Move[],
  plan: MovePlan,
  context: { adapter: string; entityId: string; at: Date; episodeId: string; newId: () => string },
): Move[] {
  const byId = new Map(moves.map((move) => [move.id, move]));
  for (const { id, status } of plan.closed) {
    const move = byId.get(id);
    if (move && move.status === "open") {
      move.status = status;
      move.resolvedAt = context.at;
    }
  }
  const minted = plan.proposed.map(
    (row): Move => ({
      id: context.newId(),
      entityId: context.entityId,
      adapter: context.adapter,
      label: row.label,
      fields: { ...row.fields },
      factIds: [...row.factIds],
      episodeId: context.episodeId,
      proposedAt: context.at,
      status: "open",
      resolvedAt: null,
    }),
  );
  moves.push(...minted);
  return minted;
}

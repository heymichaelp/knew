import type { Reader } from "./model.ts";
import { attributeFacts, cleanProposals, orderEntities, planReconciliation } from "./reconcile.ts";
import type { Fact, ModelCall, ReconciliationPlan, RosterEntry } from "./types.ts";
import { KNOWER_ID, subjectOf, type Vocabulary } from "./vocabulary.ts";

/**
 * One note, read: what it says and what it is about, attributed to the
 * entries it concerns — the knower on `self`, an entity or the relationship
 * with it on that entity — then each entry's facts reconciled against what is
 * believed about it, into a plan per entry. The one implementation every
 * in-process reader shares: the local driver, stateless mode and the fake.
 * Nothing is applied here; the caller applies the plans to its own store.
 */

/** Entries one note may update, the knower's own included: each is a reconcile call. */
export const ENTITIES_PER_NOTE = 3;

/** What the knower is called until the client names them. */
export const KNOWER_NAME = "the person writing";

export interface NoteToRead {
  content: string;
  observed?: string | null;
  inReplyTo?: string | null;
  source: string;
  referenceAt: Date;
  entityHints?: readonly string[];
}

export interface NoteRead {
  plans: ReconciliationPlan[];
  unresolvedNames: string[];
  fieldUpdates: Array<{ entityId: string; field: string; value: string }>;
  /** Other names the knower used, for entries that got no plan of their own. */
  aliases: Array<{ entityId: string; alias: string }>;
  offRoster: number;
  misattributed: number;
  droppedForCap: number;
  calls: ModelCall[];
}

export async function readNote(
  reader: Reader,
  input: {
    vocabulary: Vocabulary;
    /** The active roster as the model is shown it; the knower is added when it is missing. */
    roster: RosterEntry[];
    /** What is believed about each entry now: its summary and its current facts. */
    known: (entityId: string) => { summary: string; facts: Fact[] };
    note: NoteToRead;
    cap?: number;
    signal?: AbortSignal;
  },
): Promise<NoteRead> {
  const calls: ModelCall[] = [];
  try {
    return await read(reader, input, calls);
  } catch (error) {
    // The calls made before the failure were still made, and may still have cost something.
    if (error !== null && typeof error === "object") Object.assign(error, { calls });
    throw error;
  }
}

async function read(reader: Reader, input: Parameters<typeof readNote>[1], calls: ModelCall[]): Promise<NoteRead> {
  const { vocabulary, note } = input;
  const hints = note.entityHints ?? [];
  const roster = input.roster.some((entry) => entry.id === KNOWER_ID)
    ? input.roster
    : [{ id: KNOWER_ID, name: KNOWER_NAME, fields: {}, aliases: [] }, ...input.roster];
  const onRoster = new Set(roster.map((entry) => entry.id));
  const extraction = await reader.extract(
    {
      content: note.content,
      observed: note.observed ?? null,
      inReplyTo: note.inReplyTo ?? null,
      source: note.source,
      referenceAt: note.referenceAt,
      roster,
      hints,
    },
    calls,
    input.signal,
  );
  const { byEntity, offRoster, misattributed } = attributeFacts(extraction.facts, onRoster, (type) => subjectOf(vocabulary, type));
  const { kept, droppedForCap } = orderEntities(byEntity, hints, input.cap ?? ENTITIES_PER_NOTE);
  const proposals = cleanProposals(extraction, onRoster, vocabulary.fields);

  const plans: ReconciliationPlan[] = [];
  for (const entityId of kept) {
    const entry = roster.find((candidate) => candidate.id === entityId)!;
    const known = input.known(entityId);
    const current = known.facts.filter((fact) => !fact.expiredAt);
    const incoming = byEntity.get(entityId)!;
    const reconciliation = await reader.reconcile(
      {
        entity: { name: entry.name, fields: entry.fields },
        referenceAt: note.referenceAt,
        current,
        incoming: incoming.map((fact) => ({ type: fact.type, fact: fact.fact, validAt: fact.validAt ?? null, invalidAt: fact.invalidAt ?? null })),
        summary: known.summary,
      },
      calls,
      input.signal,
    );
    plans.push(
      planReconciliation({
        vocabulary,
        entityId,
        current,
        incoming,
        reconciliation,
        knownAt: note.referenceAt,
        summaryVersion: reader.refs.reconcile,
        aliases: proposals.aliases.filter((alias) => alias.entityId === entityId).map((alias) => alias.alias),
      }),
    );
  }
  return {
    plans,
    unresolvedNames: proposals.unresolvedNames,
    fieldUpdates: proposals.fieldUpdates,
    aliases: proposals.aliases.filter((alias) => !plans.some((plan) => plan.entityId === alias.entityId)),
    offRoster,
    misattributed,
    droppedForCap,
    calls,
  };
}

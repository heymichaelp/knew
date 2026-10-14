import type { Adapter } from "./adapter.ts";
import { factsKnownAt, lastSaidOf, mustHonorFrom, renderBrief } from "./brief.ts";
import { ENGINE_DEFAULTS } from "./defaults.ts";
import { applyDirectionPlan, planDirections, regroundDirections, withdrawUngrounded } from "./directions.ts";
import type { Lens } from "./lens.ts";
import { readerFor, type Model, type Reader } from "./model.ts";
import { applyMovePlan, isMoveLapsed, planMoves, type LapseRule } from "./moves.ts";
import { ENTITIES_PER_NOTE, KNOWER_NAME, readNote } from "./read.ts";
import { gapsFor, readinessFor } from "./readiness.ts";
import type { MoveAnswer, NextAnswer } from "./schemas.ts";
import {
  emptyState,
  fromScopeRecord,
  memoryStore,
  toScopeRecord,
  type LocalStore,
  type RosterRecord,
  type ScopeState,
  type StoredEntity,
  type StoredEpisode,
} from "./store.ts";
import { deadlineSignal, randomId } from "./timers.ts";
import type {
  DirectionPlan,
  Entity,
  EpisodeOutcome,
  ExtractNowOutcome,
  Fact,
  Intelligence,
  IntelligenceScope,
  ModelCall,
  Move,
  MovePlan,
  NewFact,
  ProposedDirection,
  ReconciliationPlan,
  RosterEntry,
} from "./types.ts";
import { KNOWER_ID, parseFactAttributes, type Vocabulary } from "./vocabulary.ts";

/**
 * THE ENGINE IN YOUR PROCESS. `localIntelligence` is a driver of the
 * contract that keeps a knower's notebook in a store the app chooses and
 * reads notes with the app's own model: its key with a provider
 * (`@popjoker/knew/anthropic`), a model on the device (`@popjoker/knew/apple`),
 * or any `Model` function. Nothing leaves the process but the model calls the
 * app's own `Model` makes. It passes the same contract suite as the hosted
 * service, and `fakeIntelligence` is this driver with a script in place of a
 * model.
 *
 * Extraction follows the service's rules: a knower's episodes are read one
 * at a time, earliest said first; a read that fails counts an attempt, unless
 * the caller's own deadline caused it, and an episode that fails
 * `maxAttempts` times is set aside (`gave-up:`) so the ones after it are not
 * held hostage; no lock is held across a model call, so reads answer while a
 * note is being read.
 *
 * Once a note's plan is applied to an entity, the model is asked what to
 * learn about it next (`next`), and the directions it proposes are kept on
 * the entity; then, under each adapter the app registered, what that kind of
 * move calls for now (`move`), and the moves it proposes are kept the same
 * way. Those calls are best effort: the facts are already in, so one that
 * fails costs nothing but what it would have proposed, and the next note
 * about the entity asks again.
 */

/** One entity the model is asked about once a note changed it, as it stood when the note was applied. */
interface DirectTarget {
  entityId: string;
  episodeId: string | null;
  at: Date;
  entity: { name: string; fields: Readonly<Record<string, string | null>> };
  facts: Fact[];
  knower: Fact[];
  learned: string[];
  directions: ProposedDirection[];
  moves: Move[];
}

export interface LocalIntelligenceOptions {
  /** The lenses it reads through, all over one vocabulary — the one it writes in. The first is the default. */
  lenses: Lens[];
  /** The lens a read without one uses. Default: the first. */
  defaultLens?: string;
  /** The adapters it proposes moves under, each over the same vocabulary, each asked in this order once a note changes an entity. Default none. */
  adapters?: Adapter[];
  /** What answers the calls. */
  model: Model;
  /** Where each knower's notebook is kept. Default: in memory. */
  store?: LocalStore;
  /** Read episodes in the background after `addEpisode`, `hintEpisodes` and `requestExtract`. Default true; false leaves it to `extractNow`. */
  background?: boolean;
  /** Entries one note may update, the knower's own included. Default 3. */
  entitiesPerEpisode?: number;
  /** Failed reads before an episode is set aside. Default 3. */
  maxAttempts?: number;
  /** How a new id is made. Default: a random UUID. */
  newId?: () => string;
  /** Directions: whether someone newly added gets first directions in the
   *  background, one `next` call each (`onAdd`, default true; off for a bulk
   *  import). Only in background mode, and only when the vocabulary proposes
   *  directions. */
  directions?: { onAdd?: boolean };
}

export interface LocalIntelligence extends Intelligence {
  /** Resolves when no background read, and no background `next`, is running. */
  settled(): Promise<void>;
}

/** Where the driver loads and saves a scope's working state. */
export interface StateStore {
  load(scope: IntelligenceScope): Promise<ScopeState>;
  save(scope: IntelligenceScope, state: ScopeState): Promise<void>;
  remove(scope: IntelligenceScope): Promise<void>;
}

/** A store of records, read into working state and written back. */
function recordStates(store: LocalStore): StateStore {
  return {
    async load(scope) {
      const record = await store.get(scope);
      return record ? fromScopeRecord(record) : emptyState();
    },
    save: (scope, state) => store.put(scope, toScopeRecord(state)),
    remove: (scope) => store.delete(scope),
  };
}

/** The driver's internals, for the fake: its own reader and state store in place of a model and a record store. */
export interface DriverInternals {
  reader: Reader;
  states: StateStore;
}

export const DEFAULT_MAX_ATTEMPTS = 3;

const keyOf = (scope: IntelligenceScope) => `${scope.clientId}\u0000${scope.subjectId}`;

export function localIntelligence(options: LocalIntelligenceOptions): LocalIntelligence {
  const lenses = checkedLenses(options.lenses, options.defaultLens);
  return createDriver(options, {
    reader: readerFor(lenses.vocabulary, options.model),
    states: recordStates(options.store ?? memoryStore()),
  });
}

function checkedLenses(lenses: Lens[], defaultLens?: string) {
  if (lenses.length === 0) throw new Error("it needs at least one lens");
  const vocabulary = lenses[0]!.vocabulary;
  for (const lens of lenses) {
    if (lens.vocabulary.id !== vocabulary.id) {
      throw new Error(`every lens reads one vocabulary, and ${lens.id} reads ${lens.vocabulary.id}, not ${vocabulary.id}`);
    }
  }
  const byId = new Map(lenses.map((lens) => [lens.id, lens]));
  const fallback = defaultLens ?? lenses[0]!.id;
  if (!byId.has(fallback)) throw new Error(`no lens ${fallback} to default to`);
  return {
    vocabulary,
    lensFor(id: string | undefined): Lens {
      const lens = byId.get(id ?? fallback);
      if (!lens) throw new Error(`no lens ${id} is registered`);
      return lens;
    },
  };
}

function checkedAdapters(adapters: Adapter[], vocabulary: Vocabulary): Adapter[] {
  const seen = new Set<string>();
  for (const adapter of adapters) {
    if (adapter.vocabulary.id !== vocabulary.id) {
      throw new Error(`every adapter reads the one vocabulary, and ${adapter.id} reads ${adapter.vocabulary.id}, not ${vocabulary.id}`);
    }
    if (seen.has(adapter.id)) throw new Error(`two adapters named ${adapter.id}`);
    seen.add(adapter.id);
  }
  return adapters;
}

/** The driver over any reader and state store: `localIntelligence` with a model, the fake with a script. */
export function createDriver(
  options: Omit<LocalIntelligenceOptions, "model" | "store">,
  internals: DriverInternals,
): LocalIntelligence {
  const { vocabulary, lensFor } = checkedLenses(options.lenses, options.defaultLens);
  const adapters = checkedAdapters(options.adapters ?? [], vocabulary);
  const adapterById = new Map(adapters.map((adapter) => [adapter.id, adapter]));
  // A move under an adapter no longer registered lapses by the engine's defaults.
  const lapseOf = (adapterId: string): LapseRule => adapterById.get(adapterId) ?? { lapse: { afterDays: ENGINE_DEFAULTS.moveLapseDays, field: null } };
  const { reader, states } = internals;
  const newId = options.newId ?? randomId;
  const background = options.background ?? true;
  const cap = options.entitiesPerEpisode ?? ENTITIES_PER_NOTE;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const extractionVersion = `${vocabulary.id}@${vocabulary.version}:${reader.refs.extract}`;

  // One thing at a time per knower: a load, a change, a save.
  const locks = new Map<string, Promise<unknown>>();
  function exclusive<T>(scope: IntelligenceScope, work: () => Promise<T>): Promise<T> {
    const key = keyOf(scope);
    const run = (locks.get(key) ?? Promise.resolve()).then(work);
    const tail = run.catch(() => undefined);
    locks.set(key, tail);
    void tail.then(() => {
      if (locks.get(key) === tail) locks.delete(key);
    });
    return run;
  }
  function withState<T>(scope: IntelligenceScope, change: (state: ScopeState) => T | Promise<T>, write = true): Promise<T> {
    return exclusive(scope, async () => {
      const state = await states.load(scope);
      const result = await change(state);
      if (write) await states.save(scope, state);
      return result;
    });
  }
  const read = <T>(scope: IntelligenceScope, look: (state: ScopeState) => T | Promise<T>) => withState(scope, look, false);

  /** The knower, named or not, is on every roster. */
  const recordOf = (s: ScopeState, entityId: string): RosterRecord | undefined =>
    s.roster.get(entityId) ?? (entityId === KNOWER_ID ? { id: KNOWER_ID, kind: "knower", name: KNOWER_NAME, fields: {}, active: true } : undefined);
  const knowerFacts = (s: ScopeState, asOf?: Date) => factsKnownAt(s.entities.get(KNOWER_ID)?.facts ?? [], asOf);
  const entityFor = (s: ScopeState, entityId: string) => {
    const record = recordOf(s, entityId);
    if (!record) return null;
    let entity = s.entities.get(entityId);
    if (!entity) {
      entity = { id: entityId, kind: record.kind, name: record.name, aliases: [], summary: "", summaryUpdatedAt: null, facts: [], directions: [], directionsAt: null, moves: [] };
      s.entities.set(entityId, entity);
    }
    return entity;
  };
  /** Whether a fact of the entity is still believed: what a direction or a move may rest on. */
  const isCurrentOn = (entity: StoredEntity) => (id: string) => entity.facts.some((f) => f.id === id && !f.expiredAt);
  const currentOf = (facts: Fact[]) => facts.filter((fact) => !fact.expiredAt);
  /** The most a call may take: the caller's deadline, its call timeout, or the smaller. */
  const boundFor = (deadlineAt: number | null, callTimeoutMs: number | null): number | null => {
    const left = deadlineAt === null ? null : deadlineAt - Date.now();
    return left === null ? callTimeoutMs : callTimeoutMs === null ? left : Math.min(left, callTimeoutMs);
  };
  const claimable = (s: ScopeState) =>
    s.episodes.filter((e) => !e.ingestedAt && !(e.held && e.entityHints.length === 0)).sort((a, b) => a.referenceAt.getTime() - b.referenceAt.getTime());
  const rosterFor = (s: ScopeState): RosterEntry[] =>
    [...s.roster.values()]
      .filter((record) => record.active)
      .map((record) => ({ id: record.id, name: record.name, fields: record.fields, aliases: s.entities.get(record.id)?.aliases ?? [] }));

  /** A plan applied, the way the service's `applyPlan` applies it. */
  const applyPlan = (entity: StoredEntity, episodeId: string, plan: ReconciliationPlan, changed: { added: number; merged: number; superseded: number }) => {
    const insert = (fact: NewFact): Fact => {
      const type = fact.type in vocabulary.factTypes ? fact.type : vocabulary.fallbackType;
      const row: Fact = {
        id: newId(),
        entityId: entity.id,
        objectId: null,
        type,
        fact: fact.fact,
        attributes: parseFactAttributes(vocabulary, type, fact.attributes),
        validAt: fact.validAt ?? null,
        invalidAt: fact.invalidAt ?? null,
        createdAt: plan.knownAt,
        lastSaidAt: plan.knownAt,
        expiredAt: null,
        supersededById: null,
        episodeIds: [episodeId],
      };
      entity.facts.push(row);
      return row;
    };
    const retire = (factId: string, invalidAt: Date, supersededById: string | null) => {
      const fact = entity.facts.find((f) => f.id === factId && !f.expiredAt);
      if (!fact) return;
      fact.expiredAt = plan.knownAt;
      // An end date the fact already carried is kept: it was said first.
      fact.invalidAt ??= invalidAt;
      fact.supersededById = supersededById;
    };
    for (const fact of plan.adds) {
      insert(fact);
      changed.added += 1;
    }
    for (const merge of plan.merges) {
      const fact = entity.facts.find((f) => f.id === merge.factId && !f.expiredAt);
      if (!fact) continue;
      if (!fact.episodeIds.includes(episodeId)) fact.episodeIds.push(episodeId);
      // A retelling moves when it was last said — forward only, because a
      // back-dated import is read after the newer episodes that said it.
      if (plan.knownAt > lastSaidOf(fact)) fact.lastSaidAt = plan.knownAt;
      changed.merged += 1;
    }
    for (const supersession of plan.supersessions) {
      const replacement = insert(supersession.replacement);
      retire(supersession.factId, supersession.invalidAt ?? supersession.replacement.validAt ?? plan.knownAt, replacement.id);
      // A direction or a move that grew from the old fact grows from its replacement now.
      regroundDirections(entity.directions, supersession.factId, replacement.id);
      regroundDirections(entity.moves, supersession.factId, replacement.id);
      changed.superseded += 1;
    }
    for (const retraction of plan.retractions) retire(retraction.factId, retraction.invalidAt ?? plan.knownAt, null);
    if (plan.retractions.length > 0) {
      withdrawUngrounded(entity.directions, isCurrentOn(entity), plan.knownAt);
      withdrawUngrounded(entity.moves, isCurrentOn(entity), plan.knownAt);
    }
    if (plan.summary != null) {
      entity.summary = plan.summary;
      entity.summaryUpdatedAt = new Date();
    }
    addAliases(entity, plan.aliases);
  };
  const addAliases = (entity: Entity, aliases: string[]) => {
    const known = new Set([entity.name, ...entity.aliases].map((alias) => alias.toLowerCase()));
    for (const alias of aliases) {
      if (!known.has(alias.toLowerCase())) {
        entity.aliases.push(alias);
        known.add(alias.toLowerCase());
      }
    }
  };

  // --------------------------------------------------- directions and moves

  /** What the `next` and `move` calls are shown about an entity, taken under the lock. */
  const targetFor = (s: ScopeState, entity: StoredEntity, episodeId: string | null, at: Date): DirectTarget => {
    const record = recordOf(s, entity.id);
    return {
      entityId: entity.id,
      episodeId,
      at,
      entity: { name: record?.name ?? entity.name, fields: record?.fields ?? {} },
      facts: currentOf(entity.facts),
      knower: currentOf(s.entities.get(KNOWER_ID)?.facts ?? []),
      learned: episodeId === null ? [] : currentOf(entity.facts).filter((fact) => fact.episodeIds.includes(episodeId)).map((fact) => fact.id),
      directions: [...entity.directions],
      moves: [...entity.moves],
    };
  };

  /**
   * Ask the model what to learn next about one entity, and keep what it may:
   * best effort, with no lock held across the call. The plan is made against
   * the entity as it stands when the answer arrives, so a note or a dismissal
   * that landed meanwhile is honoured, and the rows that no longer fit count
   * as rejected. A call that fails leaves the directions as they were.
   */
  async function direct(scope: IntelligenceScope, target: DirectTarget, calls: ModelCall[], signal?: AbortSignal): Promise<DirectionPlan | null> {
    const settings = vocabulary.directions;
    if (!settings) return null;
    let answer: NextAnswer;
    try {
      answer = await reader.next(
        {
          entity: target.entity,
          referenceAt: target.at,
          facts: target.facts,
          knower: target.knower,
          learned: target.learned,
          directions: target.directions,
          perDimension: settings.perDimension,
          lapseAfterDays: settings.lapseAfterDays,
        },
        calls,
        signal,
      );
    } catch {
      return null;
    }
    return withState(scope, (s) => {
      const entity = s.entities.get(target.entityId);
      if (!entity) return null; // removed while the model was answering
      const plan = planDirections({ vocabulary, facts: entity.facts, directions: entity.directions, answer, at: target.at });
      applyDirectionPlan(entity.directions, plan, { entityId: entity.id, at: target.at, episodeId: target.episodeId, newId });
      entity.directionsAt = new Date();
      return plan;
    });
  }

  /**
   * Ask the model what one adapter's kind of move calls for about one entity,
   * and keep what it may: best effort, like `direct`, with the plan made
   * against the entity as it stands when the answer arrives. The model sees
   * and the planner judges only the moves under this adapter; the minted ones
   * join the entity's moves under every adapter.
   */
  async function move(scope: IntelligenceScope, target: DirectTarget, adapter: Adapter, calls: ModelCall[], signal?: AbortSignal): Promise<MovePlan | null> {
    const episodeId = target.episodeId;
    if (episodeId === null) return null; // a move rests on facts a note brought; nothing is proposed on add
    let answer: MoveAnswer;
    try {
      answer = await reader.move(
        adapter,
        {
          entity: target.entity,
          referenceAt: target.at,
          facts: target.facts,
          knower: target.knower,
          learned: target.learned,
          moves: target.moves.filter((item) => item.adapter === adapter.id),
        },
        calls,
        signal,
      );
    } catch {
      return null;
    }
    return withState(scope, (s) => {
      const entity = s.entities.get(target.entityId);
      if (!entity) return null; // removed while the model was answering
      const plan = planMoves({ adapter, facts: entity.facts, moves: entity.moves.filter((item) => item.adapter === adapter.id), answer, at: target.at });
      applyMovePlan(entity.moves, plan, { adapter: adapter.id, entityId: entity.id, at: target.at, episodeId, newId });
      return plan;
    });
  }

  /** The `next` call, then one `move` call per adapter, for each target in turn, until the deadline; what the calls did, in all. */
  async function askAll(scope: IntelligenceScope, targets: DirectTarget[], calls: ModelCall[], deadlineAt: number | null, callTimeoutMs: number | null) {
    const directions = { proposed: 0, answered: 0, withdrawn: 0, rejected: 0 };
    const moves = { proposed: 0, closed: 0, rejected: 0 };
    // Past the deadline the facts are in, and what to learn or do next waits for the next read.
    const inTime = () => deadlineAt === null || Date.now() < deadlineAt;
    const under = async <T>(ask: (signal: AbortSignal) => Promise<T | null>): Promise<T | null> => {
      const timer = deadlineSignal(boundFor(deadlineAt, callTimeoutMs));
      try {
        return await ask(timer.signal);
      } finally {
        timer.release();
      }
    };
    for (const target of targets) {
      if (vocabulary.directions && inTime()) {
        const plan = await under((signal) => direct(scope, target, calls, signal));
        if (plan) {
          directions.proposed += plan.proposed.length;
          directions.answered += plan.answered.length;
          directions.withdrawn += plan.withdrawn.length;
          directions.rejected += plan.rejected;
        }
      }
      for (const adapter of adapters) {
        if (!inTime()) break;
        const plan = await under((signal) => move(scope, target, adapter, calls, signal));
        if (plan) {
          moves.proposed += plan.proposed.length;
          moves.closed += plan.closed.length;
          moves.rejected += plan.rejected;
        }
      }
    }
    return { directions, moves };
  }

  /** Entities just added and not yet asked about, per knower, and the runs draining them. */
  const pendingDirections = new Map<string, Set<string>>();
  const directing = new Map<string, Promise<void>>();

  /** First directions for someone just added, in the background, one knower at a time. */
  function directSoon(scope: IntelligenceScope, entityId: string): void {
    if (!background || !vocabulary.directions || options.directions?.onAdd === false) return;
    const key = keyOf(scope);
    const pending = pendingDirections.get(key) ?? new Set<string>();
    pending.add(entityId);
    pendingDirections.set(key, pending);
    if (directing.has(key)) return;
    const run = (async () => {
      await Promise.resolve();
      for (let next = pending.values().next(); !next.done; next = pending.values().next()) {
        pending.delete(next.value);
        try {
          const target = await withState(scope, (s) => {
            const record = s.roster.get(next.value);
            // Gone, archived, the knower, or already asked about by a note that landed first: nothing to ask.
            if (!record || !record.active || next.value === KNOWER_ID) return null;
            const entity = entityFor(s, next.value)!;
            return entity.directionsAt === null ? targetFor(s, entity, null, new Date()) : null;
          });
          if (target) await direct(scope, target, []);
        } catch {
          // Best effort: nothing throws out of the background, and the entity's first note asks again.
        }
      }
    })().finally(() => {
      directing.delete(key);
      pendingDirections.delete(key);
    });
    directing.set(key, run);
  }

  // ---------------------------------------------------------------- reading

  /** Knowers with a read running, and those asked for again while it ran. */
  const sweeping = new Map<string, Promise<void>>();
  const again = new Set<string>();

  /** One episode: claimed under the lock, read with none held, applied under the lock. */
  async function readOne(scope: IntelligenceScope, deadlineAt: number | null, callTimeoutMs: number | null): Promise<EpisodeOutcome | "none"> {
    const claim = await withState(scope, (s) => {
      const episode = claimable(s)[0];
      if (!episode) return null;
      if (episode.attempts >= maxAttempts) {
        // Set aside, not deleted: `resetForReplay` brings it back under a later vocabulary or prompt.
        episode.ingestedAt = new Date();
        episode.extractionVersion = `gave-up:${extractionVersion}`;
        return { gaveUp: { episodeId: episode.id, status: "gave-up" as const, attempts: episode.attempts } };
      }
      const known = new Map([...s.entities.values()].map((entity) => [entity.id, { summary: entity.summary, facts: entity.facts.filter((f) => !f.expiredAt) }]));
      const knower = s.roster.get(KNOWER_ID);
      return {
        episode: { ...episode, entityHints: [...episode.entityHints] },
        roster: [{ id: KNOWER_ID, name: knower?.name ?? KNOWER_NAME, fields: knower?.fields ?? {}, aliases: s.entities.get(KNOWER_ID)?.aliases ?? [] }, ...rosterFor(s).filter((entry) => entry.id !== KNOWER_ID)],
        known,
      };
    });
    if (!claim) return "none";
    if ("gaveUp" in claim) return claim.gaveUp!;
    const { episode } = claim;

    const timer = deadlineSignal(boundFor(deadlineAt, callTimeoutMs));
    let note: Awaited<ReturnType<typeof readNote>>;
    try {
      note = await readNote(reader, {
        vocabulary,
        roster: claim.roster,
        known: (entityId) => claim.known.get(entityId) ?? { summary: "", facts: [] },
        note: { content: episode.content, observed: episode.observed, inReplyTo: episode.inReplyTo, source: episode.source, referenceAt: episode.referenceAt, entityHints: episode.entityHints },
        cap,
        signal: timer.signal,
      });
    } catch (error) {
      const calls = (error as { calls?: ModelCall[] }).calls ?? [];
      // A failure the caller's deadline caused says nothing about the episode: no attempt is counted.
      const ranOut = deadlineAt !== null && Date.now() >= deadlineAt;
      if (!ranOut) {
        await withState(scope, (s) => {
          const stored = s.episodes.find((e) => e.id === episode.id);
          if (stored) stored.attempts += 1;
        });
      }
      return {
        episodeId: episode.id,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        calls: calls.length,
        costUsd: costOf(calls),
      };
    } finally {
      timer.release();
    }

    const applied = await withState(scope, (s) => {
      const stored = s.episodes.find((e) => e.id === episode.id);
      // Deleted or read by someone else while the model was answering: nothing to apply.
      if (!stored || stored.ingestedAt) return "none" as const;
      const changed = { added: 0, merged: 0, superseded: 0 };
      let entities = 0;
      // The entities this note changed something about, the knower aside, are asked about next: what to learn, and under each adapter what to do.
      const touched: Array<{ entity: StoredEntity; at: Date }> = [];
      for (const plan of note.plans) {
        const entity = entityFor(s, plan.entityId);
        if (!entity) continue; // removed from the roster since it was read
        const before = changed.added + changed.merged + changed.superseded;
        applyPlan(entity, stored.id, plan, changed);
        entities += 1;
        if (entity.id !== KNOWER_ID && changed.added + changed.merged + changed.superseded > before) touched.push({ entity, at: plan.knownAt });
      }
      for (const { entityId, alias } of note.aliases) {
        const entity = entityFor(s, entityId);
        if (entity) addAliases(entity, [alias]);
      }
      const now = new Date();
      for (const name of note.unresolvedNames) {
        s.proposals.push({ id: newId(), episodeId: stored.id, kind: "unresolved_name", name, entityId: null, field: null, value: null, status: "pending", createdAt: now, resolvedAt: null });
      }
      for (const update of note.fieldUpdates) {
        s.proposals.push({ id: newId(), episodeId: stored.id, kind: "field_update", name: null, entityId: update.entityId, field: update.field, value: update.value, status: "pending", createdAt: now, resolvedAt: null });
      }
      stored.ingestedAt = now;
      stored.held = false;
      stored.extractionVersion = extractionVersion;
      return {
        report: {
          episodeId: stored.id,
          status: "ingested" as const,
          facts: changed,
          entities,
          unresolvedNames: note.unresolvedNames,
          offRoster: note.offRoster,
          misattributed: note.misattributed,
          droppedForCap: note.droppedForCap,
        },
        targets: vocabulary.directions || adapters.length > 0 ? touched.map(({ entity, at }) => targetFor(s, entity, stored.id, at)) : [],
      };
    });
    if (applied === "none") return "none";
    const calls = [...note.calls];
    const { directions, moves } = await askAll(scope, applied.targets, calls, deadlineAt, callTimeoutMs);
    const outcome: EpisodeOutcome & { modelCalls: ModelCall[] } = { ...applied.report, directions, moves, calls: calls.length, costUsd: costOf(calls), modelCalls: calls };
    return outcome;
  }

  /** Read what is waiting, up to `max`, until the deadline. */
  async function sweep(scope: IntelligenceScope, max: number, deadlineAt: number | null, callTimeoutMs: number | null) {
    const episodes: EpisodeOutcome[] = [];
    const calls: ModelCall[] = [];
    let stopped: "none" | "limit" | "deadline" | "failed" = "limit";
    while (episodes.length < max) {
      if (deadlineAt !== null && Date.now() >= deadlineAt) {
        stopped = "deadline";
        break;
      }
      if (reader.ready && !reader.ready()) {
        stopped = "none";
        break;
      }
      const outcome = await readOne(scope, deadlineAt, callTimeoutMs);
      if (outcome === "none") {
        stopped = "none";
        break;
      }
      const { modelCalls, ...reported } = outcome as EpisodeOutcome & { modelCalls?: ModelCall[] };
      episodes.push(reported as EpisodeOutcome);
      calls.push(...(modelCalls ?? []));
      if (outcome.status === "failed") {
        stopped = deadlineAt !== null && Date.now() >= deadlineAt ? "deadline" : "failed";
        break;
      }
    }
    return { episodes, calls, stopped };
  }

  /** A read in the background, one per knower at a time; asked again while running, it runs once more. */
  function readSoon(scope: IntelligenceScope): void {
    if (!background) return;
    const key = keyOf(scope);
    if (sweeping.has(key)) {
      again.add(key);
      return;
    }
    const run = (async () => {
      await Promise.resolve();
      do {
        again.delete(key);
        try {
          const { stopped } = await sweep(scope, Number.POSITIVE_INFINITY, null, null);
          // A failure waits for the next ask, rather than retrying hot.
          if (stopped === "failed") again.delete(key);
        } catch {
          // Nothing throws out of a background read; the episode stays pending.
        }
      } while (again.has(key));
    })().finally(() => sweeping.delete(key));
    sweeping.set(key, run);
  }

  // --------------------------------------------------------------- the door

  const driver: LocalIntelligence = {
    async upsertEntity(scope, input) {
      const kind = input.id === KNOWER_ID ? "knower" : vocabulary.kind;
      if (input.kind !== undefined && input.kind !== kind) {
        throw new Error(`${input.id} is a ${input.kind}, and ${input.id === KNOWER_ID ? `${KNOWER_ID} is the knower` : `this vocabulary describes a ${vocabulary.kind}`}`);
      }
      const added = await withState(scope, (s) => {
        const existing = s.roster.get(input.id);
        s.roster.set(input.id, {
          id: input.id,
          kind,
          name: input.name,
          fields: { ...(existing?.fields ?? {}), ...(input.fields ?? {}) },
          // The knower is never archived: what they say about themselves always has somewhere to go.
          active: input.id === KNOWER_ID ? true : (input.active ?? existing?.active ?? true),
        });
        return existing === undefined && input.id !== KNOWER_ID && input.active !== false;
      });
      if (added) directSoon(scope, input.id);
    },
    async deleteEntity(scope, entityId) {
      return withState(scope, (s) => {
        if (!s.roster.has(entityId) && !(entityId === KNOWER_ID && s.entities.has(KNOWER_ID))) return { episodesRemoved: 0 };
        // Gone means gone: the episodes hinted at it, and every episode its facts cite.
        const cited = new Set(s.entities.get(entityId)?.facts.flatMap((f) => f.episodeIds) ?? []);
        s.roster.delete(entityId);
        s.entities.delete(entityId);
        const before = s.episodes.length;
        s.episodes = s.episodes.filter((e) => !e.entityHints.includes(entityId) && !cited.has(e.id));
        return { episodesRemoved: before - s.episodes.length };
      });
    },
    async addEpisode(scope, input) {
      const result = await withState(scope, (s) => {
        const existing = input.sourceRef ? s.episodes.find((e) => e.source === input.source && e.sourceRef === input.sourceRef) : null;
        if (existing) return { kind: "existing" as const, episodeId: existing.id };
        const entityHints = [...(input.entityHints ?? [])];
        const episode: StoredEpisode = {
          id: newId(),
          source: input.source,
          sourceRef: input.sourceRef ?? null,
          content: input.content,
          observed: input.observed ?? null,
          inReplyTo: input.inReplyTo ?? null,
          entityHints,
          referenceAt: input.referenceAt ?? new Date(),
          ingestedAt: null,
          held: input.hold === "until-hinted" && entityHints.length === 0,
          attempts: 0,
          extractionVersion: null,
        };
        s.episodes.push(episode);
        return { kind: "recorded" as const, episodeId: episode.id };
      });
      if (result.kind === "recorded" && input.extract !== "inline") readSoon(scope);
      return result;
    },
    async hintEpisodes(scope, { sourceRefs, entityId }) {
      const hinted = await withState(scope, (s) => {
        let count = 0;
        for (const episode of s.episodes) {
          if (episode.sourceRef && sourceRefs.includes(episode.sourceRef) && !episode.entityHints.includes(entityId)) {
            episode.entityHints.push(entityId);
            episode.held = false;
            count += 1;
          }
        }
        return count;
      });
      if (hinted > 0) readSoon(scope);
      return { hinted };
    },
    async requestExtract(scope) {
      readSoon(scope);
    },
    async extractNow(scope, extractOptions) {
      const key = keyOf(scope);
      const asked = extractOptions.askedSourceRef;
      const askedIngested = async () =>
        asked ? read(scope, (s) => s.episodes.find((e) => e.sourceRef === asked)?.ingestedAt != null) : null;
      // Another read holds this knower: order means we wait, as the service does.
      if (sweeping.has(key)) {
        const remaining = await read(scope, (s) => claimable(s).length);
        return { outcome: "busy", episodes: [], remaining, askedIngested: await askedIngested(), calls: [] };
      }
      const deadlineAt = extractOptions.deadlineMs !== undefined ? Date.now() + extractOptions.deadlineMs : null;
      let finish!: () => void;
      sweeping.set(key, new Promise<void>((resolve) => (finish = resolve)));
      try {
        const { episodes, calls, stopped } = await sweep(scope, extractOptions.maxEpisodes, deadlineAt, extractOptions.callTimeoutMs ?? null);
        const outcome: ExtractNowOutcome["outcome"] =
          stopped === "deadline" ? "budget" : stopped === "failed" ? "failed" : episodes.length > 0 ? "extracted" : "none";
        return {
          outcome,
          episodes,
          remaining: await read(scope, (s) => claimable(s).length),
          askedIngested: await askedIngested(),
          calls,
        };
      } finally {
        sweeping.delete(key);
        finish();
      }
    },
    async getEntity(scope, entityId, readOptions = {}) {
      const lens = readOptions.includeBrief && entityId !== KNOWER_ID ? lensFor(readOptions.lens) : null;
      return read(scope, (s) => {
        // On the roster with nothing known yet is an entity with no facts; off the roster is nothing.
        const record = recordOf(s, entityId);
        if (!record) return null;
        const entity = s.entities.get(entityId);
        const facts = factsKnownAt(entity?.facts ?? [], readOptions.asOf);
        // The roster has the name as the client last gave it.
        const view = {
          id: entityId,
          kind: entity?.kind ?? record.kind,
          name: record.name,
          aliases: [...(entity?.aliases ?? [])],
          summary: entity?.summary ?? "",
          summaryUpdatedAt: entity?.summaryUpdatedAt ?? null,
          facts,
        };
        if (!lens) return view;
        const at = readOptions.asOf ?? new Date();
        const knower = knowerFacts(s, readOptions.asOf);
        const text = renderBrief(lens, {
          entity: record,
          summary: readOptions.asOf ? "" : view.summary,
          facts,
          knower,
          at,
          ...(readOptions.maxChars !== undefined ? { maxChars: readOptions.maxChars } : {}),
        });
        return {
          ...view,
          brief: text ? { text, mustHonor: mustHonorFrom(lens, facts, at, knower), gaps: gapsFor(lens, record, facts, at, knower, entity?.directions ?? []) } : null,
        };
      });
    },
    async brief(scope, entityId, briefOptions = {}) {
      const view = await driver.getEntity(scope, entityId, { ...briefOptions, includeBrief: true });
      return view?.brief ?? null;
    },
    async gaps(scope, entityId, readOptions = {}) {
      const lens = lensFor(readOptions.lens);
      return read(scope, (s) => {
        const record = s.roster.get(entityId);
        // The knower is read beside every entity, never through a lens of their own.
        if (!record || entityId === KNOWER_ID) return null;
        const at = readOptions.asOf ?? new Date();
        const entity = s.entities.get(entityId);
        return gapsFor(lens, record, factsKnownAt(entity?.facts ?? [], readOptions.asOf), at, knowerFacts(s, readOptions.asOf), entity?.directions ?? []);
      });
    },
    async readiness(scope, entityId, readOptions = {}) {
      const lens = lensFor(readOptions.lens);
      return read(scope, (s) => {
        const record = s.roster.get(entityId);
        if (!record || entityId === KNOWER_ID) return null;
        const at = readOptions.asOf ?? new Date();
        const entity = s.entities.get(entityId);
        return readinessFor(lens, record, factsKnownAt(entity?.facts ?? [], readOptions.asOf), at, knowerFacts(s, readOptions.asOf), entity?.directions ?? []);
      });
    },
    async searchFacts(scope, query, searchOptions = {}) {
      return read(scope, (s) => {
        const words = query.toLowerCase().split(/\s+/).filter(Boolean);
        return [...s.entities.values()]
          .filter((e) => !searchOptions.entityId || e.id === searchOptions.entityId)
          .flatMap((e) => factsKnownAt(e.facts, searchOptions.asOf))
          .filter((f) => !searchOptions.types || searchOptions.types.includes(f.type))
          .filter((f) => words.every((w) => f.fact.toLowerCase().includes(w)))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .slice(0, searchOptions.limit ?? 20);
      });
    },
    async factsLearnedBy(scope, sourceRefs) {
      return read(scope, (s) => {
        const learned: Record<string, string[]> = {};
        for (const ref of sourceRefs) {
          const episode = s.episodes.find((e) => e.sourceRef === ref);
          if (!episode) continue;
          const facts = [...s.entities.values()].flatMap((e) => e.facts).filter((f) => !f.expiredAt && f.episodeIds.includes(episode.id));
          if (facts.length > 0) learned[ref] = [...new Set(facts.map((f) => f.fact))];
        }
        return learned;
      });
    },
    async invalidateFact(scope, factId, invalidateOptions = {}) {
      await withState(scope, (s) => {
        for (const entity of s.entities.values()) {
          const fact = entity.facts.find((f) => f.id === factId);
          if (fact && !fact.expiredAt) {
            fact.expiredAt = invalidateOptions.at ?? new Date();
            fact.invalidAt ??= fact.expiredAt;
            // A direction or a move that grew only from what was just retracted has no ground left.
            withdrawUngrounded(entity.directions, isCurrentOn(entity), fact.expiredAt);
            withdrawUngrounded(entity.moves, isCurrentOn(entity), fact.expiredAt);
          }
        }
      });
    },
    async episodes(scope, listOptions = {}) {
      return read(scope, (s) =>
        s.episodes
          .filter((e) => !listOptions.entityId || e.entityHints.includes(listOptions.entityId))
          .filter((e) => !listOptions.sourceRefs || (e.sourceRef !== null && listOptions.sourceRefs.includes(e.sourceRef)))
          .filter((e) => !listOptions.before || e.referenceAt < listOptions.before)
          .sort((a, b) => b.referenceAt.getTime() - a.referenceAt.getTime())
          .slice(0, listOptions.limit ?? 50)
          .map(({ observed: _o, held: _h, attempts: _a, extractionVersion: _v, ...episode }) => ({ ...episode, entityHints: [...episode.entityHints] })),
      );
    },
    async listProposals(scope, listOptions = {}) {
      return read(scope, (s) =>
        s.proposals
          .filter((p) => (!listOptions.entityId || p.entityId === listOptions.entityId) && (!listOptions.status || p.status === listOptions.status))
          .map((p) => ({ ...p })),
      );
    },
    async resolveProposal(scope, proposalId, resolution) {
      await withState(scope, (s) => {
        const proposal = s.proposals.find((p) => p.id === proposalId);
        if (proposal) {
          proposal.status = resolution;
          proposal.resolvedAt = new Date();
        }
      });
    },
    async dismissDirection(scope, directionId, dismissOptions = {}) {
      await withState(scope, (s) => {
        for (const entity of s.entities.values()) {
          const direction = entity.directions.find((d) => d.id === directionId);
          if (direction && direction.status === "open") {
            direction.status = "dismissed";
            direction.resolvedAt = dismissOptions.at ?? new Date();
          }
        }
      });
    },
    async moves(scope, listOptions = {}) {
      return read(scope, (s) => {
        const at = listOptions.asOf ?? new Date();
        const wanted = listOptions.status;
        // As of `at`: proposed by then; open then if not resolved by then, whatever happened since.
        const listed = (item: Move): boolean => {
          if (item.proposedAt > at) return false;
          const openThen = item.resolvedAt === null || item.resolvedAt > at;
          if (wanted === undefined) return openThen && !isMoveLapsed(item, lapseOf(item.adapter), at);
          if (wanted === "open") return openThen;
          return item.status === wanted && !openThen;
        };
        return [...s.entities.values()]
          .filter((entity) => !listOptions.entityId || entity.id === listOptions.entityId)
          .flatMap((entity) => entity.moves)
          .filter((item) => (!listOptions.adapter || item.adapter === listOptions.adapter) && listed(item))
          .sort((a, b) => b.proposedAt.getTime() - a.proposedAt.getTime())
          .map((item) => ({ ...item, fields: { ...item.fields }, factIds: [...item.factIds] }));
      });
    },
    async resolveMove(scope, moveId, resolution, resolveOptions = {}) {
      await withState(scope, (s) => {
        for (const entity of s.entities.values()) {
          const item = entity.moves.find((m) => m.id === moveId);
          if (item && item.status === "open") {
            item.status = resolution;
            item.resolvedAt = resolveOptions.at ?? new Date();
          }
        }
      });
    },
    async exportSubject(scope) {
      return read(scope, (s) => ({
        episodes: [...s.episodes]
          .sort((a, b) => a.referenceAt.getTime() - b.referenceAt.getTime())
          .map((e) => ({ source: e.source, said: e.content, saidAt: e.referenceAt, inReplyTo: e.inReplyTo })),
      }));
    },
    async deleteSubject(scope) {
      await exclusive(scope, () => states.remove(scope));
    },
    async resetForReplay(scope) {
      return withState(scope, (s) => {
        s.entities.clear();
        s.proposals = [];
        for (const episode of s.episodes) {
          episode.ingestedAt = null;
          episode.attempts = 0;
          episode.extractionVersion = null;
        }
        return { episodes: s.episodes.length };
      });
    },
    async settled() {
      while (sweeping.size > 0 || directing.size > 0) await Promise.all([...sweeping.values(), ...directing.values()]);
    },
  };
  return driver;
}

/** What calls cost together: null when any was unpriced, never shown as free. */
function costOf(calls: ModelCall[]): number | null {
  if (calls.length === 0) return 0;
  if (calls.some((call) => call.usage?.costUsd == null)) return null;
  return calls.reduce((sum, call) => sum + (call.usage!.costUsd ?? 0), 0);
}

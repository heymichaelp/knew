import type { Entity, Episode, Fact, IntelligenceScope, Proposal } from "./types.ts";

/**
 * Where the local driver keeps one knower's notebook: the roster, the
 * entities with their facts, the episodes and the proposals, as ONE record
 * per scope. A store is three async calls, so an app keeps the record
 * wherever it keeps things — a SQLite row, AsyncStorage, a file, its own
 * database — and `memoryStore()` keeps it in memory. The record is
 * JSON-safe: dates are ISO strings, nothing else needs converting.
 *
 * Each operation reads and writes the whole record, which is right for a
 * notebook of hundreds or a few thousand facts. A store for more than that
 * would want rows of its own; the record says what they hold.
 */

export interface LocalStore {
  get(scope: IntelligenceScope): Promise<ScopeRecord | null>;
  put(scope: IntelligenceScope, record: ScopeRecord): Promise<void>;
  delete(scope: IntelligenceScope): Promise<void>;
}

/** One entry on the roster, as the client gave it. */
export interface RosterRecord {
  id: string;
  kind: string;
  name: string;
  fields: Record<string, string | null>;
  active: boolean;
}

/** An episode as the driver keeps it: the contract's, plus what extraction needs. */
export interface StoredEpisode extends Episode {
  observed: string | null;
  /** Waiting for a hint before it may be read. */
  held: boolean;
  /** Reads that failed; past the driver's limit the episode is set aside. */
  attempts: number;
  /** What read it, or `gave-up:` and what tried. */
  extractionVersion: string | null;
}

/** The working state of one scope. */
export interface ScopeState {
  roster: Map<string, RosterRecord>;
  entities: Map<string, Entity & { facts: Fact[] }>;
  episodes: StoredEpisode[];
  proposals: Proposal[];
}

type Json<T> = T extends Date
  ? string
  : T extends Date | null
    ? string | null
    : T extends Array<infer U>
      ? Array<Json<U>>
      : T extends object
        ? { [K in keyof T]: Json<T[K]> }
        : T;

/** The stored form: the same shape, every date an ISO string. */
export interface ScopeRecord {
  /** Bumped if the shape ever changes. */
  format: 1;
  roster: RosterRecord[];
  entities: Array<Json<Entity & { facts: Fact[] }>>;
  episodes: Array<Json<StoredEpisode>>;
  proposals: Array<Json<Proposal>>;
}

export function emptyState(): ScopeState {
  return { roster: new Map(), entities: new Map(), episodes: [], proposals: [] };
}

const iso = (date: Date | null): string | null => (date ? date.toISOString() : null);
const day = (value: string | null): Date | null => (value ? new Date(value) : null);
const dayRequired = (value: string): Date => new Date(value);

export function toScopeRecord(state: ScopeState): ScopeRecord {
  return {
    format: 1,
    roster: [...state.roster.values()].map((record) => ({ ...record, fields: { ...record.fields } })),
    entities: [...state.entities.values()].map((entity) => ({
      ...entity,
      aliases: [...entity.aliases],
      summaryUpdatedAt: iso(entity.summaryUpdatedAt),
      facts: entity.facts.map((fact) => ({
        ...fact,
        attributes: { ...fact.attributes },
        episodeIds: [...fact.episodeIds],
        validAt: iso(fact.validAt),
        invalidAt: iso(fact.invalidAt),
        createdAt: fact.createdAt.toISOString(),
        lastSaidAt: iso(fact.lastSaidAt),
        expiredAt: iso(fact.expiredAt),
      })),
    })),
    episodes: state.episodes.map((episode) => ({
      ...episode,
      entityHints: [...episode.entityHints],
      referenceAt: episode.referenceAt.toISOString(),
      ingestedAt: iso(episode.ingestedAt),
    })),
    proposals: state.proposals.map((proposal) => ({
      ...proposal,
      createdAt: proposal.createdAt.toISOString(),
      resolvedAt: iso(proposal.resolvedAt),
    })),
  };
}

export function fromScopeRecord(record: ScopeRecord): ScopeState {
  if (record.format !== 1) throw new Error(`a scope record in format ${String(record.format)} is not one this engine reads`);
  return {
    roster: new Map(record.roster.map((entry) => [entry.id, { ...entry, fields: { ...entry.fields } }])),
    entities: new Map(
      record.entities.map((entity) => [
        entity.id,
        {
          ...entity,
          aliases: [...entity.aliases],
          summaryUpdatedAt: day(entity.summaryUpdatedAt),
          facts: entity.facts.map((fact) => ({
            ...fact,
            attributes: { ...fact.attributes },
            episodeIds: [...fact.episodeIds],
            validAt: day(fact.validAt),
            invalidAt: day(fact.invalidAt),
            createdAt: dayRequired(fact.createdAt),
            lastSaidAt: day(fact.lastSaidAt),
            expiredAt: day(fact.expiredAt),
          })),
        },
      ]),
    ),
    episodes: record.episodes.map((episode) => ({
      ...episode,
      entityHints: [...episode.entityHints],
      referenceAt: dayRequired(episode.referenceAt),
      ingestedAt: day(episode.ingestedAt),
    })),
    proposals: record.proposals.map((proposal) => ({
      ...proposal,
      createdAt: dayRequired(proposal.createdAt),
      resolvedAt: day(proposal.resolvedAt),
    })),
  };
}

const keyOf = (scope: IntelligenceScope) => `${scope.clientId}\u0000${scope.subjectId}`;

/** A store in memory: gone with the process. The record is copied in and out, so nothing outside can change what it holds. */
export function memoryStore(): LocalStore & { scopes(): IntelligenceScope[] } {
  const records = new Map<string, { scope: IntelligenceScope; text: string }>();
  return {
    async get(scope) {
      const found = records.get(keyOf(scope));
      return found ? (JSON.parse(found.text) as ScopeRecord) : null;
    },
    async put(scope, record) {
      records.set(keyOf(scope), { scope: { ...scope }, text: JSON.stringify(record) });
    },
    async delete(scope) {
      records.delete(keyOf(scope));
    },
    scopes: () => [...records.values()].map((entry) => ({ ...entry.scope })),
  };
}

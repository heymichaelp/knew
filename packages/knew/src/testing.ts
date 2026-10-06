import { factsKnownAt, lastSaidOf, mustHonorFrom, renderBrief } from "./brief.ts";
import type { ScriptedTurn } from "./contract.ts";
import { compileLens, type Lens, type LensDefinition } from "./lens.ts";
import { gapsFor, readinessFor } from "./readiness.ts";
import { attributeFacts, cleanProposals, orderEntities, planReconciliation } from "./reconcile.ts";
import type { Entity, Episode, EpisodeOutcome, Fact, Intelligence, IntelligenceScope, NewFact, Proposal, ReconciliationPlan } from "./types.ts";
import { compileVocabulary, parseFactAttributes, type Vocabulary, type VocabularyDefinition } from "./vocabulary.ts";

export * from "./contract.ts";

/**
 * Test doubles for clients of the contract, and the contract suite itself
 * (`contract.ts`). `fakeIntelligence` is an in-memory driver: it keeps what it
 * is given and runs no model. Facts arrive through `seedFacts`, or through
 * `script` — what the next extraction would find — so a client's tests can
 * walk the whole path from a note to the page without a service, a database
 * or a model. It passes the contract suite like the real drivers do.
 */

/** A small vocabulary with one type of every kind, for tests that need any
 *  vocabulary and no particular one. */
export function fixtureVocabularyDefinition(): VocabularyDefinition {
  return {
    id: "fixture",
    version: 1,
    kind: "person",
    factTypes: {
      LINE: { description: "A line never to cross.", dimension: "never-cross", pinned: true, enduring: true },
      HAS: { description: "Something they already have.", dimension: "has", pinned: true },
      SKILL: {
        description: "A pursuit with a depth claim.",
        dimension: "has",
        enduring: true,
        attributes: [{ name: "level", kind: "enum", values: ["beginner", "serious", "expert"] }],
      },
      LIKES: { description: "An interest, with no claim about depth.", dimension: "likes" },
      EVENT: {
        description: "A dated change in circumstance.",
        dimension: "life",
        attributes: [{ name: "kind", kind: "enum", values: ["moved", "new_job", "other"] }],
      },
      CIRCUMSTANCE: { description: "How their life is arranged for now.", dimension: "life", revisitAfterDays: 90 },
      PERSON: { description: "Someone in their life.", dimension: "people" },
      OTHER: { description: "A statement worth keeping that fits no other type.", dimension: "other" },
    },
    dimensions: {
      "never-cross": { label: "Never cross" },
      has: { label: "Already has" },
      likes: { label: "Likes" },
      life: { label: "Life" },
      people: { label: "People", question: "Who is in their life?" },
      other: { label: "Other" },
    },
    fallbackType: "OTHER",
    fields: ["relationship", "city"],
    promptFields: ["relationship"],
    charter: "# Charter\n\nKeep what would change how you treat this person next time.\n",
    sourceLabels: { note: "a note they wrote" },
  };
}

/** The fixture's default lens: two asks, one of which only applies to some
 *  people, and nothing else declared — so its page and its gaps are exactly
 *  what the 0.x fixture lens produced. */
export function fixtureLensDefinition(): LensDefinition {
  return {
    id: "fixture",
    version: 1,
    objective: "Treat them well next time.",
    vocabulary: "fixture",
    header: "What we know about {who}:",
    overHeading: "No longer the case",
    attributeTags: ["level"],
    asks: [
      { id: "what-they-love", question: "What do they love doing, and how deeply?", answeredBy: ["LIKES", "SKILL"] },
      {
        id: "how-the-days-go",
        question: "What do their days allow, living where they do?",
        when: [{ field: "relationship", equals: ["mother", "father"] }],
        answeredBy: ["CIRCUMSTANCE"],
      },
    ],
  };
}

/** A second lens over the same vocabulary, for another objective: its own
 *  sections, header and pinned types, a weighted ask, one that waits for
 *  another and needs two facts, and one asked of a dimension. */
export function fixtureVisitLensDefinition(): LensDefinition {
  return {
    id: "fixture-visit",
    version: 1,
    objective: "Plan a visit: how their days go before what they love.",
    vocabulary: "fixture",
    header: "Before you visit {who}:",
    overHeading: "Over now",
    sections: [
      { heading: "Mind", dimensions: ["never-cross", "life"] },
      { heading: "Know", dimensions: ["has", "likes", "people", "other"] },
    ],
    pinned: ["LINE"],
    asks: [
      {
        id: "how-the-days-go",
        question: "How do their days go right now?",
        when: [{ field: "relationship", equals: ["mother", "father"] }],
        answeredBy: ["CIRCUMSTANCE"],
        weight: 2,
      },
      { id: "what-they-love", question: "What do they love doing, and how deeply?", answeredBy: ["LIKES", "SKILL"], enough: 2, after: ["how-the-days-go"] },
      { id: "people", dimension: "people" },
    ],
  };
}

export function fixtureVocabulary(): Vocabulary {
  return compileVocabulary(fixtureVocabularyDefinition());
}

export function fixtureLens(): Lens {
  return compileLens(fixtureLensDefinition(), fixtureVocabulary());
}

export function fixtureVisitLens(): Lens {
  return compileLens(fixtureVisitLensDefinition(), fixtureVocabulary());
}

/** The service reads at most this many entities' facts out of one episode. */
const ENTITIES_PER_EPISODE = 3;

interface RosterRecord {
  id: string;
  kind: string;
  name: string;
  fields: Record<string, string | null>;
  active: boolean;
}

interface FakeState {
  roster: Map<string, RosterRecord>;
  entities: Map<string, Entity & { facts: Fact[] }>;
  episodes: Episode[];
  /** Episodes recorded `hold: "until-hinted"` and not yet hinted. */
  held: Set<string>;
  proposals: Proposal[];
}

let counter = 0;
const nextId = () => {
  counter += 1;
  return `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`;
};

export interface FakeIntelligence extends Intelligence {
  /** Facts as if extracted, with today's known-at; `seedFacts` for a page without an episode. */
  seedFacts(scope: IntelligenceScope, entityId: string, facts: Array<Partial<Fact> & Pick<Fact, "type" | "fact">>): void;
  setSummary(scope: IntelligenceScope, entityId: string, summary: string): void;
  /** What the next pending episode is read into, when `extractNow` runs: the model, scripted. */
  script(turn: ScriptedTurn): void;
}

export interface FakeIntelligenceOptions {
  /** The lenses it reads through, all over one vocabulary — the one it
   *  writes in. Default: the fixture lens and the fixture visit lens. */
  lenses?: Lens[];
  /** The lens a read without one uses. Default: the first. */
  defaultLens?: string;
}

/**
 * An in-memory `Intelligence`. Briefs, gaps, readiness and searches read
 * through the same pure functions the service uses; an extraction applies the
 * same reconciliation plan the service applies, from a scripted answer in
 * place of a model's.
 */
export function fakeIntelligence(options: FakeIntelligenceOptions = {}): FakeIntelligence {
  const lenses = options.lenses ?? [fixtureLens(), fixtureVisitLens()];
  if (lenses.length === 0) throw new Error("fakeIntelligence: it needs at least one lens");
  const vocabulary = lenses[0]!.vocabulary;
  for (const lens of lenses) {
    if (lens.vocabulary.id !== vocabulary.id) {
      throw new Error(`fakeIntelligence: every lens reads one vocabulary, and ${lens.id} reads ${lens.vocabulary.id}, not ${vocabulary.id}`);
    }
  }
  const byId = new Map(lenses.map((lens) => [lens.id, lens]));
  const defaultLens = options.defaultLens ?? lenses[0]!.id;
  if (!byId.has(defaultLens)) throw new Error(`fakeIntelligence: no lens ${defaultLens} to default to`);
  const lensFor = (id: string | undefined): Lens => {
    const lens = byId.get(id ?? defaultLens);
    if (!lens) throw new Error(`no lens ${id}`);
    return lens;
  };

  const states = new Map<string, FakeState>();
  const turns: ScriptedTurn[] = [];
  const state = (scope: IntelligenceScope): FakeState => {
    const key = `${scope.clientId}/${scope.subjectId}`;
    let found = states.get(key);
    if (!found) {
      found = { roster: new Map(), entities: new Map(), episodes: [], held: new Set(), proposals: [] };
      states.set(key, found);
    }
    return found;
  };
  const entityFor = (s: FakeState, entityId: string) => {
    const record = s.roster.get(entityId);
    if (!record) return null;
    let entity = s.entities.get(entityId);
    if (!entity) {
      entity = { id: entityId, kind: record.kind, name: record.name, aliases: [], summary: "", summaryUpdatedAt: null, facts: [] };
      s.entities.set(entityId, entity);
    }
    return entity;
  };
  const claimable = (s: FakeState) =>
    s.episodes
      .filter((e) => !e.ingestedAt && !(s.held.has(e.id) && e.entityHints.length === 0))
      .sort((a, b) => a.referenceAt.getTime() - b.referenceAt.getTime());

  /** The plan, applied the way the service's `applyPlan` applies it. */
  const applyPlan = (entity: Entity & { facts: Fact[] }, episodeId: string, plan: ReconciliationPlan, changed: { added: number; merged: number; superseded: number }) => {
    const insert = (fact: NewFact): Fact => {
      const type = fact.type in vocabulary.factTypes ? fact.type : vocabulary.fallbackType;
      const row: Fact = {
        id: nextId(),
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
      const fact = entity.facts.find((f) => f.id === merge.factId);
      if (fact && !fact.episodeIds.includes(episodeId)) fact.episodeIds.push(episodeId);
      // A retelling moves when it was last said — forward only, because a
      // back-dated import is swept after the newer episodes that said it.
      if (fact && plan.knownAt > lastSaidOf(fact)) fact.lastSaidAt = plan.knownAt;
      changed.merged += 1;
    }
    for (const supersession of plan.supersessions) {
      const replacement = insert(supersession.replacement);
      retire(supersession.factId, supersession.invalidAt ?? supersession.replacement.validAt ?? plan.knownAt, replacement.id);
      changed.superseded += 1;
    }
    for (const retraction of plan.retractions) retire(retraction.factId, retraction.invalidAt ?? plan.knownAt, null);
    if (plan.summary != null) {
      entity.summary = plan.summary;
      entity.summaryUpdatedAt = new Date();
    }
    for (const alias of plan.aliases) if (!entity.aliases.includes(alias)) entity.aliases.push(alias);
  };

  /** One episode read with one scripted answer: attribution checked, entities capped, proposals kept. */
  const readEpisode = (s: FakeState, episode: Episode, turn: ScriptedTurn): EpisodeOutcome => {
    const roster = new Set([...s.roster.values()].filter((record) => record.active).map((record) => record.id));
    const { byEntity, offRoster } = attributeFacts(turn.extraction.facts, roster);
    const { kept, droppedForCap } = orderEntities(byEntity, episode.entityHints, ENTITIES_PER_EPISODE);
    const proposals = cleanProposals(turn.extraction, roster, vocabulary.fields);
    const changed = { added: 0, merged: 0, superseded: 0 };
    for (const entityId of kept) {
      const record = s.roster.get(entityId)!;
      const entity = entityFor(s, entityId)!;
      const current = entity.facts.filter((f) => !f.expiredAt);
      const incoming = byEntity.get(entityId)!;
      const reconciliation = turn.reconcile?.({ name: record.name, current }, incoming) ?? { decisions: [], summary: `About ${record.name}.` };
      const plan = planReconciliation({
        vocabulary,
        entityId,
        current,
        incoming,
        reconciliation,
        knownAt: episode.referenceAt,
        summaryVersion: "fake",
        aliases: proposals.aliases.filter((alias) => alias.entityId === entityId).map((alias) => alias.alias),
      });
      applyPlan(entity, episode.id, plan, changed);
    }
    const now = new Date();
    for (const name of proposals.unresolvedNames) {
      s.proposals.push({ id: nextId(), episodeId: episode.id, kind: "unresolved_name", name, entityId: null, field: null, value: null, status: "pending", createdAt: now, resolvedAt: null });
    }
    for (const update of proposals.fieldUpdates) {
      s.proposals.push({
        id: nextId(),
        episodeId: episode.id,
        kind: "field_update",
        name: null,
        entityId: update.entityId,
        field: update.field,
        value: update.value,
        status: "pending",
        createdAt: now,
        resolvedAt: null,
      });
    }
    episode.ingestedAt = now;
    s.held.delete(episode.id);
    return {
      episodeId: episode.id,
      status: "ingested",
      facts: changed,
      entities: kept.length,
      unresolvedNames: proposals.unresolvedNames,
      offRoster,
      droppedForCap,
      calls: 0,
      costUsd: null,
    };
  };

  return {
    async upsertEntity(scope, input) {
      if (input.kind !== undefined && input.kind !== vocabulary.kind) {
        throw new Error(`${input.id} is a ${input.kind}, and this vocabulary describes a ${vocabulary.kind}`);
      }
      const s = state(scope);
      const existing = s.roster.get(input.id);
      s.roster.set(input.id, {
        id: input.id,
        kind: vocabulary.kind,
        name: input.name,
        fields: { ...(existing?.fields ?? {}), ...(input.fields ?? {}) },
        active: input.active ?? existing?.active ?? true,
      });
    },
    async deleteEntity(scope, entityId) {
      const s = state(scope);
      if (!s.roster.has(entityId)) return { episodesRemoved: 0 };
      // Gone means gone: the episodes hinted at it, and every episode its facts cite.
      const cited = new Set(s.entities.get(entityId)?.facts.flatMap((f) => f.episodeIds) ?? []);
      s.roster.delete(entityId);
      s.entities.delete(entityId);
      const before = s.episodes.length;
      s.episodes = s.episodes.filter((e) => !e.entityHints.includes(entityId) && !cited.has(e.id));
      return { episodesRemoved: before - s.episodes.length };
    },
    async addEpisode(scope, input) {
      const s = state(scope);
      const existing = input.sourceRef ? s.episodes.find((e) => e.source === input.source && e.sourceRef === input.sourceRef) : null;
      if (existing) return { kind: "existing", episodeId: existing.id };
      const episode: Episode = {
        id: nextId(),
        source: input.source,
        sourceRef: input.sourceRef ?? null,
        content: input.content,
        inReplyTo: input.inReplyTo ?? null,
        entityHints: [...(input.entityHints ?? [])],
        referenceAt: input.referenceAt ?? new Date(),
        ingestedAt: null,
      };
      s.episodes.push(episode);
      if (input.hold === "until-hinted") s.held.add(episode.id);
      return { kind: "recorded", episodeId: episode.id };
    },
    async hintEpisodes(scope, { sourceRefs, entityId }) {
      const s = state(scope);
      let hinted = 0;
      for (const episode of s.episodes) {
        if (episode.sourceRef && sourceRefs.includes(episode.sourceRef) && !episode.entityHints.includes(entityId)) {
          episode.entityHints.push(entityId);
          s.held.delete(episode.id);
          hinted += 1;
        }
      }
      return { hinted };
    },
    async requestExtract() {},
    async extractNow(scope, extractOptions) {
      const s = state(scope);
      const done: EpisodeOutcome[] = [];
      for (const episode of claimable(s).slice(0, extractOptions.maxEpisodes)) {
        const turn = turns.shift();
        if (!turn) break;
        done.push(readEpisode(s, episode, turn));
      }
      const asked = extractOptions.askedSourceRef ? s.episodes.find((e) => e.sourceRef === extractOptions.askedSourceRef) : null;
      return {
        outcome: done.length > 0 ? "extracted" : "none",
        episodes: done,
        remaining: claimable(s).length,
        askedIngested: extractOptions.askedSourceRef ? asked?.ingestedAt != null : null,
        calls: [],
      };
    },
    async getEntity(scope, entityId, readOptions = {}) {
      const lens = readOptions.includeBrief ? lensFor(readOptions.lens) : null;
      const s = state(scope);
      const entity = s.entities.get(entityId);
      if (!entity) return null;
      const facts = factsKnownAt(entity.facts, readOptions.asOf);
      const { facts: _all, ...rest } = entity;
      const view = { ...rest, facts };
      if (!lens) return view;
      const record = s.roster.get(entityId)!;
      const at = readOptions.asOf ?? new Date();
      const text = renderBrief(lens, {
        entity: record,
        summary: readOptions.asOf ? "" : entity.summary,
        facts,
        at,
        ...(readOptions.maxChars !== undefined ? { maxChars: readOptions.maxChars } : {}),
      });
      return {
        ...view,
        brief: text ? { text, mustHonor: mustHonorFrom(lens, facts, at), gaps: gapsFor(lens, record, facts, at) } : null,
      };
    },
    async brief(scope, entityId, briefOptions = {}) {
      const view = await this.getEntity(scope, entityId, { ...briefOptions, includeBrief: true });
      return view?.brief ?? null;
    },
    async gaps(scope, entityId, readOptions = {}) {
      const lens = lensFor(readOptions.lens);
      const s = state(scope);
      const record = s.roster.get(entityId);
      if (!record) return null;
      return gapsFor(lens, record, factsKnownAt(s.entities.get(entityId)?.facts ?? [], readOptions.asOf), readOptions.asOf ?? new Date());
    },
    async readiness(scope, entityId, readOptions = {}) {
      const lens = lensFor(readOptions.lens);
      const s = state(scope);
      const record = s.roster.get(entityId);
      if (!record) return null;
      return readinessFor(lens, record, factsKnownAt(s.entities.get(entityId)?.facts ?? [], readOptions.asOf), readOptions.asOf ?? new Date());
    },
    async searchFacts(scope, query, searchOptions = {}) {
      const s = state(scope);
      const words = query.toLowerCase().split(/\s+/).filter(Boolean);
      const facts = [...s.entities.values()]
        .filter((e) => !searchOptions.entityId || e.id === searchOptions.entityId)
        .flatMap((e) => factsKnownAt(e.facts, searchOptions.asOf))
        .filter((f) => !searchOptions.types || searchOptions.types.includes(f.type))
        .filter((f) => words.every((w) => f.fact.toLowerCase().includes(w)));
      return facts.slice(0, searchOptions.limit ?? 20);
    },
    async factsLearnedBy(scope, sourceRefs) {
      const s = state(scope);
      const learned: Record<string, string[]> = {};
      for (const ref of sourceRefs) {
        const episode = s.episodes.find((e) => e.sourceRef === ref);
        if (!episode) continue;
        const facts = [...s.entities.values()].flatMap((e) => e.facts).filter((f) => !f.expiredAt && f.episodeIds.includes(episode.id));
        if (facts.length > 0) learned[ref] = facts.map((f) => f.fact);
      }
      return learned;
    },
    async invalidateFact(scope, factId, invalidateOptions = {}) {
      for (const entity of state(scope).entities.values()) {
        const fact = entity.facts.find((f) => f.id === factId);
        if (fact && !fact.expiredAt) {
          fact.expiredAt = invalidateOptions.at ?? new Date();
          fact.invalidAt ??= fact.expiredAt;
        }
      }
    },
    async episodes(scope, listOptions = {}) {
      return state(scope)
        .episodes.filter((e) => !listOptions.entityId || e.entityHints.includes(listOptions.entityId))
        .filter((e) => !listOptions.sourceRefs || (e.sourceRef !== null && listOptions.sourceRefs.includes(e.sourceRef)))
        .filter((e) => !listOptions.before || e.referenceAt < listOptions.before)
        .sort((a, b) => b.referenceAt.getTime() - a.referenceAt.getTime())
        .slice(0, listOptions.limit ?? 50);
    },
    async listProposals(scope, listOptions = {}) {
      return state(scope).proposals.filter(
        (p) => (!listOptions.entityId || p.entityId === listOptions.entityId) && (!listOptions.status || p.status === listOptions.status),
      );
    },
    async resolveProposal(scope, proposalId, resolution) {
      const proposal = state(scope).proposals.find((p) => p.id === proposalId);
      if (proposal) {
        proposal.status = resolution;
        proposal.resolvedAt = new Date();
      }
    },
    async exportSubject(scope) {
      return {
        episodes: state(scope).episodes.map((e) => ({ source: e.source, said: e.content, saidAt: e.referenceAt, inReplyTo: e.inReplyTo })),
      };
    },
    async deleteSubject(scope) {
      states.delete(`${scope.clientId}/${scope.subjectId}`);
    },
    async resetForReplay(scope) {
      const s = state(scope);
      s.entities.clear();
      s.proposals = [];
      for (const episode of s.episodes) episode.ingestedAt = null;
      return { episodes: s.episodes.length };
    },
    seedFacts(scope, entityId, facts) {
      const entity = entityFor(state(scope), entityId);
      if (!entity) throw new Error(`fakeIntelligence: no entity ${entityId} on the roster`);
      for (const fact of facts) {
        entity.facts.push({
          id: fact.id ?? nextId(),
          entityId,
          objectId: null,
          attributes: {},
          validAt: null,
          invalidAt: null,
          createdAt: new Date(),
          lastSaidAt: null,
          expiredAt: null,
          supersededById: null,
          episodeIds: [],
          ...fact,
        });
      }
    },
    setSummary(scope, entityId, summary) {
      const entity = entityFor(state(scope), entityId);
      if (!entity) throw new Error(`fakeIntelligence: no entity ${entityId} on the roster`);
      entity.summary = summary;
      entity.summaryUpdatedAt = new Date();
    },
    script(turn) {
      turns.push(turn);
    },
  };
}

import { factsKnownAt, mustHonorFrom, renderBrief } from "./brief.ts";
import type { ScriptedTurn } from "./contract.ts";
import { gapsFor } from "./gaps.ts";
import { compileLens, parseFactAttributes, type Lens, type LensDefinition } from "./lens.ts";
import { attributeFacts, cleanProposals, orderSubjects, planReconciliation } from "./reconcile.ts";
import type {
  Entity,
  Episode,
  EpisodeOutcome,
  Fact,
  IntelligenceScope,
  NewFact,
  PeopleIntelligence,
  Person,
  Proposal,
  ReconciliationPlan,
} from "./types.ts";

export * from "./contract.ts";

/**
 * Test doubles for clients of the contract, and the contract suite itself
 * (`contract.ts`). `fakeIntelligence` is an in-memory driver: it keeps what it
 * is given and runs no model. Facts arrive through `seedFacts`, or through
 * `script` — what the next extraction would find — so a client's tests can
 * walk the whole path from a note to the page without a service, a database
 * or a model. It passes the contract suite like the real drivers do.
 */

/** A small lens with one type of every kind and two asks, for tests that
 *  need any lens and no particular one. */
export function fixtureLensDefinition(): LensDefinition {
  return {
    id: "fixture",
    version: 1,
    factTypes: {
      LINE: { description: "A line never to cross.", section: "never-cross", pinned: true, enduring: true },
      HAS: { description: "Something they already have.", section: "has", pinned: true },
      SKILL: {
        description: "A pursuit with a depth claim.",
        section: "has",
        enduring: true,
        attributes: [{ name: "level", kind: "enum", values: ["beginner", "serious", "expert"] }],
      },
      LIKES: { description: "An interest, with no claim about depth.", section: "likes" },
      EVENT: {
        description: "A dated change in circumstance.",
        section: "life",
        attributes: [{ name: "kind", kind: "enum", values: ["moved", "new_job", "other"] }],
      },
      CIRCUMSTANCE: { description: "How their life is arranged for now.", section: "life" },
      PERSON: { description: "Someone in their life.", section: "people" },
      OTHER: { description: "A statement worth keeping that fits no other type.", section: "other" },
    },
    briefSections: [
      { section: "never-cross", heading: "Never cross" },
      { section: "has", heading: "Already has" },
      { section: "likes", heading: "Likes" },
      { section: "life", heading: "Life" },
      { section: "people", heading: "People" },
      { section: "other", heading: "Other" },
    ],
    briefHeader: "What we know about {who}:",
    overHeading: "No longer the case",
    fallbackType: "OTHER",
    sourceLabels: { note: "a note they wrote" },
    routingFields: ["relationship", "city"],
    promptFields: ["relationship"],
    briefAttributeTags: ["level"],
    charter: "# Charter\n\nKeep what would change how you treat this person next time.\n",
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

export function fixtureLens(): Lens {
  return compileLens(fixtureLensDefinition());
}

/** The service reads at most this many people's facts out of one episode. */
const SUBJECTS_PER_EPISODE = 3;

interface FakeState {
  people: Map<string, Person>;
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

export interface FakeIntelligence extends PeopleIntelligence {
  /** Facts as if extracted, with today's known-at; `seedFacts` for a page without an episode. */
  seedFacts(scope: IntelligenceScope, personId: string, facts: Array<Partial<Fact> & Pick<Fact, "type" | "fact">>): void;
  setSummary(scope: IntelligenceScope, personId: string, summary: string): void;
  /** What the next pending episode is read into, when `extractNow` runs: the model, scripted. */
  script(turn: ScriptedTurn): void;
}

/**
 * An in-memory `PeopleIntelligence`. Briefs, gaps and searches read through
 * the same pure functions the service uses; an extraction applies the same
 * reconciliation plan the service applies, from a scripted answer in place
 * of a model's.
 */
export function fakeIntelligence(lens: Lens = fixtureLens()): FakeIntelligence {
  const states = new Map<string, FakeState>();
  const turns: ScriptedTurn[] = [];
  const state = (scope: IntelligenceScope): FakeState => {
    const key = `${scope.clientId}/${scope.subjectId}`;
    let found = states.get(key);
    if (!found) {
      found = { people: new Map(), entities: new Map(), episodes: [], held: new Set(), proposals: [] };
      states.set(key, found);
    }
    return found;
  };
  const entityFor = (s: FakeState, personId: string) => {
    const person = s.people.get(personId);
    if (!person) return null;
    let entity = s.entities.get(personId);
    if (!entity) {
      entity = { id: nextId(), personId, kind: "person", name: person.name, aliases: [], summary: "", summaryUpdatedAt: null, facts: [] };
      s.entities.set(personId, entity);
    }
    return entity;
  };
  const claimable = (s: FakeState) =>
    s.episodes
      .filter((e) => !e.ingestedAt && !(s.held.has(e.id) && e.personHints.length === 0))
      .sort((a, b) => a.referenceAt.getTime() - b.referenceAt.getTime());

  /** The plan, applied the way the service's `applyPlan` applies it. */
  const applyPlan = (entity: Entity & { facts: Fact[] }, episodeId: string, plan: ReconciliationPlan, changed: { added: number; merged: number; superseded: number }) => {
    const insert = (fact: NewFact): Fact => {
      const type = fact.type in lens.factTypes ? fact.type : lens.fallbackType;
      const row: Fact = {
        id: nextId(),
        subjectId: entity.id,
        objectId: null,
        type,
        fact: fact.fact,
        attributes: parseFactAttributes(lens, type, fact.attributes),
        validAt: fact.validAt ?? null,
        invalidAt: fact.invalidAt ?? null,
        createdAt: plan.knownAt,
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

  /** One episode read with one scripted answer: attribution checked, people capped, proposals kept. */
  const readEpisode = (s: FakeState, episode: Episode, turn: ScriptedTurn): EpisodeOutcome => {
    const roster = new Set([...s.people.values()].filter((p) => p.active).map((p) => p.id));
    const { byPerson, offRoster } = attributeFacts(turn.extraction.facts, roster);
    const { kept, droppedForCap } = orderSubjects(byPerson, episode.personHints, SUBJECTS_PER_EPISODE);
    const proposals = cleanProposals(turn.extraction, roster);
    const changed = { added: 0, merged: 0, superseded: 0 };
    for (const personId of kept) {
      const person = s.people.get(personId)!;
      const entity = entityFor(s, personId)!;
      const current = entity.facts.filter((f) => !f.expiredAt);
      const incoming = byPerson.get(personId)!;
      const reconciliation = turn.reconcile?.({ name: person.name, current }, incoming) ?? { decisions: [], summary: `About ${person.name}.` };
      const plan = planReconciliation({
        lens,
        personId,
        current,
        incoming,
        reconciliation,
        knownAt: episode.referenceAt,
        summaryVersion: "fake",
        aliases: proposals.aliases.filter((alias) => alias.personId === personId).map((alias) => alias.alias),
      });
      applyPlan(entity, episode.id, plan, changed);
    }
    const now = new Date();
    for (const name of proposals.unresolvedNames) {
      s.proposals.push({ id: nextId(), episodeId: episode.id, kind: "unresolved_name", name, personId: null, field: null, value: null, status: "pending", createdAt: now, resolvedAt: null });
    }
    for (const update of proposals.fieldUpdates) {
      s.proposals.push({
        id: nextId(),
        episodeId: episode.id,
        kind: "field_update",
        name: null,
        personId: update.personId,
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
      people: kept.length,
      unresolvedNames: proposals.unresolvedNames,
      offRoster,
      droppedForCap,
      calls: 0,
      costUsd: null,
    };
  };

  return {
    async upsertPerson(scope, person) {
      const s = state(scope);
      const existing = s.people.get(person.id);
      s.people.set(person.id, {
        id: person.id,
        name: person.name,
        fields: { ...(existing?.fields ?? {}), ...(person.fields ?? {}) },
        active: person.active ?? existing?.active ?? true,
      });
    },
    async deletePerson(scope, personId) {
      const s = state(scope);
      if (!s.people.has(personId)) return { episodesRemoved: 0 };
      // Gone means gone: the episodes hinted at them, and every episode their facts cite.
      const cited = new Set(s.entities.get(personId)?.facts.flatMap((f) => f.episodeIds) ?? []);
      s.people.delete(personId);
      s.entities.delete(personId);
      const before = s.episodes.length;
      s.episodes = s.episodes.filter((e) => !e.personHints.includes(personId) && !cited.has(e.id));
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
        personHints: [...(input.personHints ?? [])],
        referenceAt: input.referenceAt ?? new Date(),
        ingestedAt: null,
      };
      s.episodes.push(episode);
      if (input.hold === "until-hinted") s.held.add(episode.id);
      return { kind: "recorded", episodeId: episode.id };
    },
    async hintEpisodes(scope, { sourceRefs, personId }) {
      const s = state(scope);
      let hinted = 0;
      for (const episode of s.episodes) {
        if (episode.sourceRef && sourceRefs.includes(episode.sourceRef) && !episode.personHints.includes(personId)) {
          episode.personHints.push(personId);
          s.held.delete(episode.id);
          hinted += 1;
        }
      }
      return { hinted };
    },
    async requestExtract() {},
    async extractNow(scope, options) {
      const s = state(scope);
      const done: EpisodeOutcome[] = [];
      for (const episode of claimable(s).slice(0, options.maxEpisodes)) {
        const turn = turns.shift();
        if (!turn) break;
        done.push(readEpisode(s, episode, turn));
      }
      const asked = options.askedSourceRef ? s.episodes.find((e) => e.sourceRef === options.askedSourceRef) : null;
      return {
        outcome: done.length > 0 ? "extracted" : "none",
        episodes: done,
        remaining: claimable(s).length,
        askedIngested: options.askedSourceRef ? asked?.ingestedAt != null : null,
        calls: [],
      };
    },
    async getEntity(scope, personId, options = {}) {
      const s = state(scope);
      const entity = s.entities.get(personId);
      if (!entity) return null;
      const facts = factsKnownAt(entity.facts, options.asOf);
      const { facts: _all, ...rest } = entity;
      const view = { ...rest, facts };
      if (!options.includeBrief) return view;
      const person = s.people.get(personId)!;
      const at = options.asOf ?? new Date();
      const text = renderBrief(lens, {
        person,
        summary: options.asOf ? "" : entity.summary,
        facts,
        at,
        ...(options.maxChars !== undefined ? { maxChars: options.maxChars } : {}),
      });
      return {
        ...view,
        brief: text ? { text, mustHonor: mustHonorFrom(lens, facts, at), gaps: gapsFor(lens, person, facts, at) } : null,
      };
    },
    async brief(scope, personId, options = {}) {
      const view = await this.getEntity(scope, personId, { ...options, includeBrief: true });
      return view?.brief ?? null;
    },
    async gaps(scope, personId) {
      const s = state(scope);
      const person = s.people.get(personId);
      if (!person) return null;
      return gapsFor(lens, person, factsKnownAt(s.entities.get(personId)?.facts ?? []));
    },
    async searchFacts(scope, query, options = {}) {
      const s = state(scope);
      const words = query.toLowerCase().split(/\s+/).filter(Boolean);
      const facts = [...s.entities.values()]
        .filter((e) => !options.personId || e.personId === options.personId)
        .flatMap((e) => factsKnownAt(e.facts, options.asOf))
        .filter((f) => !options.types || options.types.includes(f.type))
        .filter((f) => words.every((w) => f.fact.toLowerCase().includes(w)));
      return facts.slice(0, options.limit ?? 20);
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
    async invalidateFact(scope, factId, options = {}) {
      for (const entity of state(scope).entities.values()) {
        const fact = entity.facts.find((f) => f.id === factId);
        if (fact && !fact.expiredAt) {
          fact.expiredAt = options.at ?? new Date();
          fact.invalidAt ??= fact.expiredAt;
        }
      }
    },
    async episodes(scope, options = {}) {
      return state(scope)
        .episodes.filter((e) => !options.personId || e.personHints.includes(options.personId))
        .filter((e) => !options.sourceRefs || (e.sourceRef !== null && options.sourceRefs.includes(e.sourceRef)))
        .filter((e) => !options.before || e.referenceAt < options.before)
        .sort((a, b) => b.referenceAt.getTime() - a.referenceAt.getTime())
        .slice(0, options.limit ?? 50);
    },
    async listProposals(scope, options = {}) {
      return state(scope).proposals.filter(
        (p) => (!options.personId || p.personId === options.personId) && (!options.status || p.status === options.status),
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
        episodes: state(scope).episodes.map((e) => ({ source: e.source, said: e.content, saidAt: e.referenceAt })),
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
    seedFacts(scope, personId, facts) {
      const entity = entityFor(state(scope), personId);
      if (!entity) throw new Error(`fakeIntelligence: no person ${personId} on the roster`);
      for (const fact of facts) {
        entity.facts.push({
          id: fact.id ?? nextId(),
          subjectId: entity.id,
          objectId: null,
          attributes: {},
          validAt: null,
          invalidAt: null,
          createdAt: new Date(),
          expiredAt: null,
          supersededById: null,
          episodeIds: [],
          ...fact,
        });
      }
    },
    setSummary(scope, personId, summary) {
      const entity = entityFor(state(scope), personId);
      if (!entity) throw new Error(`fakeIntelligence: no person ${personId} on the roster`);
      entity.summary = summary;
      entity.summaryUpdatedAt = new Date();
    },
    script(turn) {
      turns.push(turn);
    },
  };
}

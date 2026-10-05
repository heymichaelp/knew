import { factsKnownAt, mustHonorFrom, renderBrief } from "./brief.ts";
import { gapsFor } from "./gaps.ts";
import { compileLens, type Lens, type LensDefinition } from "./lens.ts";
import type { Entity, Episode, Fact, IntelligenceScope, PeopleIntelligence, Person, Proposal } from "./types.ts";

/**
 * Test doubles for clients of the contract. Nothing here is a real engine:
 * `fakeIntelligence` stores what it is given and extracts nothing, so a
 * client's tests can run without a service, a database or a model.
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

interface FakeState {
  people: Map<string, Person>;
  entities: Map<string, Entity & { facts: Fact[] }>;
  episodes: Episode[];
  proposals: Proposal[];
}

let counter = 0;
const nextId = () => {
  counter += 1;
  return `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`;
};

/**
 * An in-memory `PeopleIntelligence`. Facts are added through `seedFacts`,
 * since no model runs; briefs, gaps and searches read them through the same
 * pure functions the service uses.
 */
export function fakeIntelligence(lens: Lens = fixtureLens()): PeopleIntelligence & {
  seedFacts(scope: IntelligenceScope, personId: string, facts: Array<Partial<Fact> & Pick<Fact, "type" | "fact">>): void;
  setSummary(scope: IntelligenceScope, personId: string, summary: string): void;
} {
  const states = new Map<string, FakeState>();
  const state = (scope: IntelligenceScope): FakeState => {
    const key = `${scope.clientId}/${scope.subjectId}`;
    let found = states.get(key);
    if (!found) {
      found = { people: new Map(), entities: new Map(), episodes: [], proposals: [] };
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
      s.people.delete(personId);
      s.entities.delete(personId);
      const before = s.episodes.length;
      s.episodes = s.episodes.filter((e) => !e.personHints.includes(personId));
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
        personHints: input.personHints ?? [],
        referenceAt: input.referenceAt ?? new Date(),
        ingestedAt: null,
      };
      s.episodes.push(episode);
      return { kind: "recorded", episodeId: episode.id };
    },
    async hintEpisodes(scope, { sourceRefs, personId }) {
      let hinted = 0;
      for (const episode of state(scope).episodes) {
        if (episode.sourceRef && sourceRefs.includes(episode.sourceRef) && !episode.personHints.includes(personId)) {
          episode.personHints.push(personId);
          hinted += 1;
        }
      }
      return { hinted };
    },
    async requestExtract() {},
    async extractNow(scope, options) {
      const pending = state(scope).episodes.filter((e) => !e.ingestedAt);
      return {
        outcome: "none",
        episodes: [],
        remaining: pending.length,
        askedIngested: options.askedSourceRef ? false : null,
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
      return gapsFor(lens, person, s.entities.get(personId)?.facts ?? []);
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
      for (const entity of s.entities.values()) {
        entity.facts = [];
        entity.summary = "";
      }
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
  };
}

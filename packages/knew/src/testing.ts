import type { ScriptedTurn } from "./contract.ts";
import { compileLens, type Lens, type LensDefinition } from "./lens.ts";
import { createDriver, type LocalIntelligence, type StateStore } from "./local.ts";
import type { Reader } from "./model.ts";
import { KNOWER_NAME } from "./read.ts";
import { emptyState, type ScopeState } from "./store.ts";
import type { Fact, IntelligenceScope } from "./types.ts";
import { compileVocabulary, KNOWER_ID, type Vocabulary, type VocabularyDefinition } from "./vocabulary.ts";

export * from "./contract.ts";

/**
 * Test doubles for clients of the contract, and the contract suite itself
 * (`contract.ts`). `fakeIntelligence` is the local driver (`local.ts`) with a
 * script in place of a model: it keeps what it is given in memory and calls
 * nothing. Facts arrive through `seedFacts`, or through `script` — what the
 * next extraction would find — so a client's tests can walk the whole path
 * from a note to the page without a service, a database or a model. It passes
 * the contract suite like the real drivers do, and runs the same code as
 * `localIntelligence`.
 */

/** A small vocabulary with one type of every kind, for tests that need any
 *  vocabulary and no particular one: about the person, about the relationship
 *  with them (HISTORY), and about the knower (MEANS). */
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
      HISTORY: { description: "How the knower and they know each other.", dimension: "between", enduring: true },
      MEANS: { description: "What the knower can spend or give.", dimension: "means" },
      OTHER: { description: "A statement worth keeping that fits no other type.", dimension: "other" },
    },
    dimensions: {
      "never-cross": { label: "Never cross" },
      has: { label: "Already has" },
      likes: { label: "Likes" },
      life: { label: "Life" },
      people: { label: "People" },
      between: { label: "Between you", about: "relationship" },
      means: { label: "Your means", about: "knower" },
      other: { label: "Other" },
    },
    fallbackType: "OTHER",
    fields: ["relationship", "city"],
    promptFields: ["relationship"],
    charter: "# Charter\n\nKeep what would change how you treat this person next time.\n",
    sourceLabels: { note: "a note they wrote" },
  };
}

/** The fixture's default lens: two needs, one of which only applies to some
 *  people, and nothing else declared. */
export function fixtureLensDefinition(): LensDefinition {
  return {
    id: "fixture",
    version: 1,
    objective: "Treat them well next time.",
    vocabulary: "fixture",
    header: "What we know about {who}:",
    overHeading: "No longer the case",
    attributeTags: ["level"],
    needs: [
      { id: "what-they-love", label: "What they love", types: ["LIKES", "SKILL"] },
      {
        id: "how-the-days-go",
        label: "How their days go",
        when: [{ field: "relationship", equals: ["mother", "father"] }],
        types: ["CIRCUMSTANCE"],
      },
    ],
  };
}

/** A second lens over the same vocabulary, for another objective: its own
 *  sections, header and pinned types, a weighted need, one that waits for
 *  another and needs two facts, and one of a dimension. */
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
      { heading: "Know", dimensions: ["has", "likes", "people", "between", "other"] },
    ],
    pinned: ["LINE"],
    needs: [
      {
        id: "how-the-days-go",
        label: "How their days go",
        when: [{ field: "relationship", equals: ["mother", "father"] }],
        types: ["CIRCUMSTANCE"],
        weight: 2,
      },
      { id: "what-they-love", label: "What they love", types: ["LIKES", "SKILL"], enough: 2, after: ["how-the-days-go"] },
      { id: "people", dimension: "people" },
    ],
  };
}

/** A third lens, for an objective that needs all three subjects: what they
 *  love (the person), how the two of you know each other (the relationship),
 *  and what the knower can spend (the knower), whose section it prints. */
export function fixtureGiftLensDefinition(): LensDefinition {
  return {
    id: "fixture-gift",
    version: 1,
    objective: "Choose a gift.",
    vocabulary: "fixture",
    header: "A gift for {who}:",
    overHeading: "Over now",
    sections: [
      { heading: "Them", dimensions: ["never-cross", "has", "likes", "life", "people", "other"] },
      { heading: "Between you", dimensions: ["between"] },
      { heading: "You", dimensions: ["means"] },
    ],
    needs: [
      { id: "what-they-love", label: "What they love", types: ["LIKES"], weight: 3 },
      { id: "how-you-know-them", dimension: "between", weight: 2, after: ["what-you-can-spend"] },
      { id: "what-you-can-spend", dimension: "means" },
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

export function fixtureGiftLens(): Lens {
  return compileLens(fixtureGiftLensDefinition(), fixtureVocabulary());
}

let counter = 0;
const nextId = () => {
  counter += 1;
  return `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`;
};

export interface FakeIntelligence extends LocalIntelligence {
  /** Facts as if extracted, with today's known-at; `seedFacts` for a page without an episode. */
  seedFacts(scope: IntelligenceScope, entityId: string, facts: Array<Partial<Fact> & Pick<Fact, "type" | "fact">>): void;
  setSummary(scope: IntelligenceScope, entityId: string, summary: string): void;
  /** What the next pending episode is read into, when `extractNow` runs: the model, scripted. */
  script(turn: ScriptedTurn): void;
}

export interface FakeIntelligenceOptions {
  /** The lenses it reads through, all over one vocabulary — the one it
   *  writes in. Default: the fixture lens, the fixture visit lens and the fixture gift lens. */
  lenses?: Lens[];
  /** The lens a read without one uses. Default: the first. */
  defaultLens?: string;
}

/**
 * An in-memory `Intelligence` that reads with a script. The queue is shared
 * across scopes: each episode read takes the next turn, earliest said first,
 * and an episode with no turn left stays pending. Nothing is read in the
 * background; `extractNow` reads.
 */
export function fakeIntelligence(options: FakeIntelligenceOptions = {}): FakeIntelligence {
  const lenses = options.lenses ?? [fixtureLens(), fixtureVisitLens(), fixtureGiftLens()];
  const turns: ScriptedTurn[] = [];
  let current: ScriptedTurn | undefined;
  const reader: Reader = {
    refs: { extract: "fake", reconcile: "fake" },
    ready: () => turns.length > 0,
    async extract() {
      current = turns.shift();
      if (!current) throw new Error("fakeIntelligence: nothing scripted for this episode");
      return current.extraction;
    },
    async reconcile(args) {
      return current?.reconcile?.({ name: args.entity.name, current: args.current }, args.incoming) ?? { decisions: [], summary: `About ${args.entity.name}.` };
    },
  };

  // The states themselves, in memory, so a test can seed one without waiting.
  const states = new Map<string, ScopeState>();
  const stateOf = (scope: IntelligenceScope): ScopeState => {
    const key = `${scope.clientId}/${scope.subjectId}`;
    let found = states.get(key);
    if (!found) {
      found = emptyState();
      states.set(key, found);
    }
    return found;
  };
  const store: StateStore = {
    load: async (scope) => stateOf(scope),
    save: async () => {},
    remove: async (scope) => {
      states.delete(`${scope.clientId}/${scope.subjectId}`);
    },
  };
  const driver = createDriver({ lenses, ...(options.defaultLens ? { defaultLens: options.defaultLens } : {}), background: false, newId: nextId }, { reader, states: store });

  const entityFor = (scope: IntelligenceScope, entityId: string) => {
    const s = stateOf(scope);
    const record = s.roster.get(entityId) ?? (entityId === KNOWER_ID ? { kind: "knower", name: KNOWER_NAME } : undefined);
    if (!record) throw new Error(`fakeIntelligence: no entity ${entityId} on the roster`);
    let entity = s.entities.get(entityId);
    if (!entity) {
      entity = { id: entityId, kind: record.kind, name: record.name, aliases: [], summary: "", summaryUpdatedAt: null, facts: [] };
      s.entities.set(entityId, entity);
    }
    return entity;
  };

  return Object.assign(driver, {
    seedFacts(scope: IntelligenceScope, entityId: string, facts: Array<Partial<Fact> & Pick<Fact, "type" | "fact">>) {
      const entity = entityFor(scope, entityId);
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
    setSummary(scope: IntelligenceScope, entityId: string, summary: string) {
      const entity = entityFor(scope, entityId);
      entity.summary = summary;
      entity.summaryUpdatedAt = new Date();
    },
    script(turn: ScriptedTurn) {
      turns.push(turn);
    },
  });
}

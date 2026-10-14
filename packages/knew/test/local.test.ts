import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compileAdapter,
  compileLens,
  compileVocabulary,
  KNOWER_ID,
  localIntelligence,
  memoryStore,
  type LocalStore,
  type Model,
  type ModelRequest,
  type ScopeRecord,
} from "../src/index.ts";
import {
  extracted,
  extraction,
  fixtureAdapter,
  fixtureAdapterDefinition,
  fixtureGiftLens,
  fixtureLens,
  fixtureLensDefinition,
  fixtureVocabularyDefinition,
} from "../src/testing.ts";

/**
 * The engine in your process: a note read with the app's own model function,
 * kept in the app's own store. The model here answers from a script, by task,
 * and records what it was asked.
 */

type Answer = unknown | Error | ((request: ModelRequest) => unknown);

const NOTHING_NEXT = { answered: [], withdrawn: [], proposed: [] };
const NO_MOVE = { closed: [], proposed: [] };

function cannedModel(answers: Partial<Record<ModelRequest["task"], Answer[]>>, usage = { inputTokens: 1_000, outputTokens: 100, costUsd: 0.01 }) {
  const asked: ModelRequest[] = [];
  const model: Model = async (request) => {
    asked.push(request);
    const next = answers[request.task]?.shift();
    if (next === undefined) {
      // What to learn next, and what each adapter calls for, is asked after every note; a test that says nothing about them has nothing proposed.
      if (request.task === "next") return { output: NOTHING_NEXT, model: "canned", usage };
      if (request.task === "move") return { output: NO_MOVE, model: "canned", usage };
      throw new Error(`unscripted ${request.task}`);
    }
    if (next instanceof Error) throw next;
    return { output: typeof next === "function" ? (next as (r: ModelRequest) => unknown)(request) : next, model: "canned", usage };
  };
  return { model, asked };
}

const scope = { clientId: "app", subjectId: "ana" };
const said = new Date("2026-10-01T09:00:00Z");

describe("Scenario: A note is read with the app's own model and kept in its own store", () => {
  it("asks the model with the vocabulary's prompts and the schemas, checks the answers, and keeps the facts, the summary and the cost", async () => {
    const { model, asked } = cannedModel({
      extract: [extraction([extracted("linda", "LIKES", "Gardening"), extracted(KNOWER_ID, "MEANS", "Can spend about £40")])],
      reconcile: [{ decisions: [], summary: "Linda gardens." }, { decisions: [], summary: "Ana budgets." }],
    });
    const knew = localIntelligence({ lenses: [fixtureLens(), fixtureGiftLens()], model, background: false });
    await knew.upsertEntity(scope, { id: "linda", name: "Linda" });
    await knew.addEpisode(scope, { source: "note", content: "Mom loves gardening; I can spend about £40.", entityHints: ["linda"], referenceAt: said });
    const now = await knew.extractNow(scope, { maxEpisodes: 5 });

    assert.equal(now.outcome, "extracted");
    assert.deepEqual(now.calls.map((call) => [call.method, call.model, call.usage?.costUsd]), [
      ["extract", "canned", 0.01],
      ["reconcile", "canned", 0.01],
      ["reconcile", "canned", 0.01],
      ["next", "canned", 0.01],
    ]);
    const done = now.episodes[0]!;
    assert.equal(done.status, "ingested");
    if (done.status === "ingested") assert.equal(done.costUsd, 0.04);

    const [extract] = asked;
    assert.match(extract!.system, /# Charter/, "the charter rides with the task");
    assert.match(extract!.prompt, /- id: self \| name: the person writing/, "the knower is on the roster the model sees");
    assert.deepEqual((extract!.schema as { required: string[] }).required, ["facts", "aliases", "unresolvedNames", "fieldUpdates"]);
    assert.equal("$schema" in extract!.schema, false);

    assert.deepEqual((await knew.getEntity(scope, "linda"))!.facts.map((f) => [f.fact, f.createdAt.getTime()]), [["Gardening", said.getTime()]]);
    assert.equal((await knew.getEntity(scope, "linda"))!.summary, "Linda gardens.");
    assert.deepEqual((await knew.getEntity(scope, KNOWER_ID))!.facts.map((f) => f.fact), ["Can spend about £40"]);
    const gift = (await knew.readiness(scope, "linda", { lens: "fixture-gift" }))!;
    assert.deepEqual(gift.needs.map((need) => [need.id, need.state]), [["what-they-love", "met"], ["how-you-know-them", "open"], ["what-you-can-spend", "met"]]);
  });

  it("takes an answer as JSON text in a code fence, and refuses one that is not the schema's, counting the attempt", async () => {
    const { model } = cannedModel({
      extract: ["```json\n" + JSON.stringify(extraction([extracted("linda", "LIKES", "Gardening")])) + "\n```", { facts: "nope" }],
      reconcile: [{ decisions: [], summary: "" }],
    });
    const knew = localIntelligence({ lenses: [fixtureLens()], model, background: false });
    await knew.upsertEntity(scope, { id: "linda", name: "Linda" });
    await knew.addEpisode(scope, { source: "note", content: "Gardening", entityHints: ["linda"], referenceAt: said });
    assert.equal((await knew.extractNow(scope, { maxEpisodes: 1 })).outcome, "extracted");
    await knew.addEpisode(scope, { source: "note", content: "Something else", referenceAt: new Date("2026-10-02T00:00:00Z") });
    const bad = await knew.extractNow(scope, { maxEpisodes: 1 });
    assert.equal(bad.outcome, "failed");
    const failed = bad.episodes[0]!;
    assert.equal(failed.status, "failed");
    if (failed.status === "failed") {
      assert.match(failed.error, /the model's extract answer is not usable: facts:/);
      assert.equal(failed.calls, 1, "the call was made, and is counted, though its answer was refused");
    }
    assert.equal(bad.remaining, 1, "the episode waits to be read again");
  });

  it("sets an episode aside after it fails three times, and reads the ones after it", async () => {
    const boom = () => new Error("provider down");
    const { model } = cannedModel({
      extract: [boom(), boom(), boom(), extraction([extracted("linda", "LIKES", "Gardening")])],
      reconcile: [{ decisions: [], summary: "" }],
    });
    const knew = localIntelligence({ lenses: [fixtureLens()], model, background: false });
    await knew.upsertEntity(scope, { id: "linda", name: "Linda" });
    await knew.addEpisode(scope, { source: "note", sourceRef: "poison", content: "x", referenceAt: new Date("2026-01-01T00:00:00Z") });
    await knew.addEpisode(scope, { source: "note", sourceRef: "fine", content: "Mom gardens", entityHints: ["linda"], referenceAt: new Date("2026-02-01T00:00:00Z") });
    for (let i = 0; i < 3; i += 1) assert.equal((await knew.extractNow(scope, { maxEpisodes: 5 })).outcome, "failed");
    const after = await knew.extractNow(scope, { maxEpisodes: 5 });
    assert.deepEqual(after.episodes.map((e) => e.status), ["gave-up", "ingested"]);
    assert.deepEqual(await knew.factsLearnedBy(scope, ["poison", "fine"]), { fine: ["Gardening"] });
  });

  it("gives the attempt back when the caller's own deadline cut the read short", async () => {
    const slow: Model = (request) =>
      new Promise((_, reject) => request.signal?.addEventListener("abort", () => reject(request.signal!.reason), { once: true }));
    const knew = localIntelligence({ lenses: [fixtureLens()], model: slow, background: false, maxAttempts: 1 });
    await knew.addEpisode(scope, { source: "note", content: "x" });
    for (let i = 0; i < 2; i += 1) {
      const cut = await knew.extractNow(scope, { maxEpisodes: 1, deadlineMs: 20 });
      assert.equal(cut.outcome, "budget");
      assert.equal(cut.episodes[0]!.status, "failed", "never set aside: a deadline says nothing about the episode");
    }
  });

  it("reads in the background after a note is added, one read at a time, and settles", async () => {
    const { model } = cannedModel({
      extract: [extraction([extracted("linda", "LIKES", "Gardening")]), extraction([extracted("linda", "LIKES", "Birds")])],
      reconcile: [{ decisions: [], summary: "" }, { decisions: [], summary: "" }],
    });
    const knew = localIntelligence({ lenses: [fixtureLens()], model });
    await knew.upsertEntity(scope, { id: "linda", name: "Linda" });
    await knew.addEpisode(scope, { source: "note", content: "Mom gardens", entityHints: ["linda"], referenceAt: new Date("2026-01-01T00:00:00Z") });
    await knew.addEpisode(scope, { source: "note", content: "And watches birds", entityHints: ["linda"], referenceAt: new Date("2026-01-02T00:00:00Z") });
    await knew.settled();
    assert.deepEqual((await knew.getEntity(scope, "linda"))!.facts.map((f) => f.fact), ["Gardening", "Birds"]);
    assert.equal((await knew.extractNow(scope, { maxEpisodes: 1 })).outcome, "none");
  });

  it("keeps each knower's notebook as one JSON record in the app's store, and reads it back in a new process", async () => {
    const saved = new Map<string, string>();
    const jsonStore: LocalStore = {
      get: async (s) => (saved.has(s.subjectId) ? (JSON.parse(saved.get(s.subjectId)!) as ScopeRecord) : null),
      put: async (s, record) => void saved.set(s.subjectId, JSON.stringify(record)),
      delete: async (s) => void saved.delete(s.subjectId),
    };
    const { model } = cannedModel({
      extract: [extraction([extracted("linda", "LIKES", "Gardening")])],
      reconcile: [{ decisions: [], summary: "Gardens." }],
      next: [{ answered: [], withdrawn: [], proposed: [{ dimension: "likes", label: "Whether she sells what she grows", factIds: [] }] }],
    });
    const first = localIntelligence({ lenses: [fixtureLens()], model, store: jsonStore, background: false });
    await first.upsertEntity(scope, { id: "linda", name: "Linda" });
    await first.addEpisode(scope, { source: "note", sourceRef: "n-1", content: "Mom gardens", entityHints: ["linda"], referenceAt: said });
    await first.extractNow(scope, { maxEpisodes: 1 });

    const second = localIntelligence({ lenses: [fixtureLens()], model: cannedModel({ extract: [], reconcile: [] }).model, store: jsonStore, background: false });
    const view = (await second.getEntity(scope, "linda"))!;
    assert.deepEqual([view.summary, view.facts.map((f) => f.fact), view.facts[0]!.createdAt.getTime()], ["Gardens.", ["Gardening"], said.getTime()]);
    assert.equal((await second.episodes(scope))[0]!.ingestedAt instanceof Date, true);
    const direction = (await second.readiness(scope, "linda"))!.next.find((d) => d.id !== null)!;
    assert.deepEqual([direction.label, direction.proposedAt?.getTime()], ["Whether she sells what she grows", said.getTime()], "a direction travels in the record with its dates");
    assert.equal(JSON.parse(saved.get("ana")!).format, 1);

    await second.deleteSubject(scope);
    assert.equal(saved.has("ana"), false);
    assert.equal(await second.getEntity(scope, "linda"), null);
  });

  it("keeps two knowers apart in one store", async () => {
    const store = memoryStore();
    const knew = localIntelligence({ lenses: [fixtureLens()], model: cannedModel({ extract: [], reconcile: [] }).model, store, background: false });
    await knew.upsertEntity({ clientId: "app", subjectId: "a" }, { id: "linda", name: "Linda" });
    assert.equal(await knew.getEntity({ clientId: "app", subjectId: "b" }, "linda"), null);
    assert.deepEqual(store.scopes(), [{ clientId: "app", subjectId: "a" }]);
  });
});

describe("Scenario: Once a note is folded in, the model is asked what to learn next", () => {
  const gardening = () => extraction([extracted("linda", "LIKES", "Gardening")]);

  it("asks with the dimensions, shows what was just learned and the writer, keeps what it proposed, counts what it refused, and never asks about the knower", async () => {
    const { model, asked } = cannedModel({
      extract: [extraction([extracted("linda", "LIKES", "Gardening"), extracted(KNOWER_ID, "MEANS", "Can spend about £40")])],
      reconcile: [{ decisions: [], summary: "Linda gardens." }, { decisions: [], summary: "Ana budgets." }],
      next: [
        (request: ModelRequest) => {
          const learned = /^- (\S+) \| LIKES \| Gardening/m.exec(request.prompt)![1]!;
          return {
            answered: [],
            withdrawn: [],
            proposed: [
              { dimension: "likes", label: "Whether she sells what she grows", factIds: [learned] },
              { dimension: "likes", label: "Does she keep bees?", factIds: [] },
            ],
          };
        },
      ],
    });
    const knew = localIntelligence({ lenses: [fixtureLens(), fixtureGiftLens()], model, background: false });
    await knew.upsertEntity(scope, { id: "linda", name: "Linda", fields: { relationship: "mother" } });
    await knew.addEpisode(scope, { source: "note", content: "Mom loves gardening; I can spend about £40.", entityHints: ["linda"], referenceAt: said });
    const now = await knew.extractNow(scope, { maxEpisodes: 1 });
    assert.deepEqual(now.calls.map((call) => call.method), ["extract", "reconcile", "reconcile", "next"], "one next call, for Linda; none for the knower");
    const done = now.episodes[0]!;
    assert.equal(done.status, "ingested");
    if (done.status === "ingested") assert.deepEqual([done.directions, done.calls, done.costUsd], [{ proposed: 1, answered: 0, withdrawn: 0, rejected: 1 }, 4, 0.04]);

    const next = asked.find((request) => request.task === "next")!;
    assert.match(next.system, /# Task: Name what to learn next/);
    assert.match(next.system, /## Dimensions\n\n- never-cross: Never cross \(about the entry\)\. Informed by: LINE\./);
    assert.ok(next.prompt.startsWith("Directions for this person: Linda (mother)\n\nToday (when this was learned): 2026-10-01"));
    assert.match(next.prompt, /Just learned \(id \| type \| fact \| dates\):\n- \S+ \| LIKES \| Gardening \| told us 2026-10-01\n\nAlso known \(id \| type \| fact \| dates\):\n\(nothing else\)/);
    assert.match(next.prompt, /About the writer \(id \| type \| fact \| dates\):\n- \S+ \| MEANS \| Can spend about £40/);
    assert.match(next.prompt, /Open directions \(id \| dimension \| label \| grew from\):\n\(none yet\)\n\nRoom for new directions/);
    assert.deepEqual((next.schema as { required: string[] }).required, ["answered", "withdrawn", "proposed"]);

    const fact = (await knew.searchFacts(scope, "gardening"))[0]!;
    const readiness = (await knew.readiness(scope, "linda"))!;
    assert.deepEqual(
      readiness.next.map((d) => [d.id === null ? "the need" : "proposed", d.need, d.label, d.value, d.factIds, d.proposedAt?.getTime() ?? null]),
      [
        ["the need", "how-the-days-go", "How their days go", 1, [], null],
        ["proposed", "what-they-love", "Whether she sells what she grows", 0.5, [fact.id], said.getTime()],
      ],
    );
  });

  it("keeps the facts when the next call fails, and counts the call: thrown, it leaves the note unpriced; answered wrongly, it is priced", async () => {
    const thrown = cannedModel({ extract: [gardening()], reconcile: [{ decisions: [], summary: "" }], next: [new Error("provider down")] });
    const knew = localIntelligence({ lenses: [fixtureLens()], model: thrown.model, background: false });
    await knew.upsertEntity(scope, { id: "linda", name: "Linda" });
    await knew.addEpisode(scope, { source: "note", content: "Mom gardens", entityHints: ["linda"], referenceAt: said });
    const now = await knew.extractNow(scope, { maxEpisodes: 1 });
    assert.equal(now.outcome, "extracted", "a failed next never fails the note");
    const done = now.episodes[0]!;
    assert.equal(done.status, "ingested");
    if (done.status === "ingested") assert.deepEqual([done.calls, done.costUsd, done.directions], [3, null, { proposed: 0, answered: 0, withdrawn: 0, rejected: 0 }]);
    assert.deepEqual((await knew.getEntity(scope, "linda"))!.facts.map((f) => f.fact), ["Gardening"]);
    assert.deepEqual((await knew.readiness(scope, "linda"))!.next, [], "the one need that applies is met, and nothing was proposed in it");

    const wrong = cannedModel({ extract: [gardening()], reconcile: [{ decisions: [], summary: "" }], next: [{ proposed: "nope" }] });
    const other = localIntelligence({ lenses: [fixtureLens()], model: wrong.model, background: false });
    await other.upsertEntity(scope, { id: "linda", name: "Linda" });
    await other.addEpisode(scope, { source: "note", content: "Mom gardens", entityHints: ["linda"], referenceAt: said });
    const priced = (await other.extractNow(scope, { maxEpisodes: 1 })).episodes[0]!;
    assert.equal(priced.status, "ingested");
    if (priced.status === "ingested") assert.deepEqual([priced.calls, priced.costUsd, priced.directions.proposed], [3, 0.03, 0]);
  });

  it("asks once about someone just added, in the background, from the dimensions alone, and settles", async () => {
    const { model, asked } = cannedModel({
      next: [{ answered: [], withdrawn: [], proposed: [{ dimension: "likes", label: "What she does with her weekends", factIds: [] }] }],
    });
    const knew = localIntelligence({ lenses: [fixtureLens()], model });
    await knew.upsertEntity(scope, { id: "linda", name: "Linda", fields: { relationship: "mother" } });
    await knew.settled();
    assert.deepEqual(asked.map((request) => request.task), ["next"]);
    assert.match(asked[0]!.prompt, /Just learned \(id \| type \| fact \| dates\):\n\(nothing yet: this entry was just added\)/);
    const first = (await knew.readiness(scope, "linda"))!.next[0]!;
    assert.deepEqual([first.label, first.need, first.value, first.factIds, first.proposedAt instanceof Date], ["What she does with her weekends", "what-they-love", 1, [], true]);

    await knew.upsertEntity(scope, { id: "linda", name: "Linda", fields: { city: "Leeds" } });
    await knew.upsertEntity(scope, { id: KNOWER_ID, name: "Ana" });
    await knew.upsertEntity(scope, { id: "old", name: "An old friend", active: false });
    await knew.settled();
    assert.equal(asked.length, 1, "asked once: not again for a change to her fields, never for the knower, never for someone archived");
  });

  it("asks about nobody on add when told not to, as for a bulk import", async () => {
    const { model, asked } = cannedModel({});
    const knew = localIntelligence({ lenses: [fixtureLens()], model, directions: { onAdd: false } });
    await knew.upsertEntity(scope, { id: "linda", name: "Linda" });
    await knew.settled();
    assert.deepEqual(asked, []);
  });

  it("makes no next call for a vocabulary that proposes no directions", async () => {
    const quiet = compileLens(fixtureLensDefinition(), compileVocabulary({ ...fixtureVocabularyDefinition(), directions: false }));
    const { model, asked } = cannedModel({ extract: [gardening()], reconcile: [{ decisions: [], summary: "" }] });
    const knew = localIntelligence({ lenses: [quiet], model, background: false });
    await knew.upsertEntity(scope, { id: "linda", name: "Linda" });
    await knew.addEpisode(scope, { source: "note", content: "Mom gardens", entityHints: ["linda"], referenceAt: said });
    const done = (await knew.extractNow(scope, { maxEpisodes: 1 })).episodes[0]!;
    assert.deepEqual(asked.map((request) => request.task), ["extract", "reconcile"]);
    if (done.status === "ingested") assert.deepEqual(done.directions, { proposed: 0, answered: 0, withdrawn: 0, rejected: 0 });
  });
});

describe("Scenario: Once a note is folded in, each adapter is asked what its kind of move calls for", () => {
  const entering = () => extraction([extracted("linda", "LIKES", "Gardening"), extracted("linda", "EVENT", "Entering the village show on 4 October", { validAt: "2026-10-04" })]);
  /** The model, under the fixture adapter: a moment for the show, and a question, which is refused. */
  const proposes = (request: ModelRequest) => {
    const show = /^- (\S+) \| EVENT \| Entering the village show/m.exec(request.prompt)![1]!;
    return {
      closed: [],
      proposed: [
        { label: "Wish her luck at the village show", factIds: [show], fields: { when: "2026-10-04", why: "She is entering" } },
        { label: "Is she entering the show again?", factIds: [show], fields: { when: null, why: null } },
      ],
    };
  };
  const movesOf = (record: ScopeRecord, entityId: string) => record.entities.find((entity) => entity.id === entityId)!.moves;

  it("asks under the adapter after next, with its instructions, its dimensions, the kind's fields and the room; keeps what it proposed under the adapter, and counts what it refused", async () => {
    const { model, asked } = cannedModel({ extract: [entering()], reconcile: [{ decisions: [], summary: "Linda gardens." }], move: [proposes] });
    const store = memoryStore();
    const knew = localIntelligence({ lenses: [fixtureLens()], adapters: [fixtureAdapter()], model, store, background: false });
    await knew.upsertEntity(scope, { id: "linda", name: "Linda", fields: { relationship: "mother" } });
    await knew.addEpisode(scope, { source: "note", content: "Mom gardens, and is entering the village show on 4 October", entityHints: ["linda"], referenceAt: said });
    const now = await knew.extractNow(scope, { maxEpisodes: 1 });
    assert.deepEqual(now.calls.map((call) => call.method), ["extract", "reconcile", "next", "move"]);
    const done = now.episodes[0]!;
    assert.equal(done.status, "ingested");
    if (done.status === "ingested") assert.deepEqual([done.moves, done.calls, done.costUsd], [{ proposed: 1, closed: 0, rejected: 1 }, 4, 0.04]);

    const move = asked.find((request) => request.task === "move")!;
    assert.match(move.system, /^# Task: Propose moves/);
    assert.match(move.system, /\n\n---\n\n## This kind of move\n\n\*\*A moment\*\* is a small thing to do for them/);
    assert.match(move.system, /\n\n---\n\n# Charter\n/);
    assert.match(move.system, /## Dimensions\n\n- has: Already has \(about the entry\)\. Informed by: HAS, SKILL\.\n- likes: .*\n- life: .*\n- people: .*$/);
    assert.doesNotMatch(move.system, /- never-cross:/, "only the dimensions the adapter names");
    assert.ok(move.prompt.startsWith("Moves of kind fixture-moment for this person: Linda (mother)\n\nToday (when this was learned): 2026-10-01"));
    assert.match(move.prompt, /Just learned \(id \| type \| fact \| dates\):\n- \S+ \| LIKES \| Gardening \| told us 2026-10-01\n- \S+ \| EVENT \| Entering the village show on 4 October \| true since 2026-10-04; told us 2026-10-01\n\nAlso known/);
    assert.match(move.prompt, /Fields \(name \| kind \| description\):\n- when \| date \| The day it is for/);
    assert.match(move.prompt, /Open moves \(id \| label \| fields \| grew from\):\n\(none yet\)\n\nRoom for new moves: 2$/);
    assert.deepEqual((move.schema as { required: string[] }).required, ["closed", "proposed"]);
    assert.ok(asked.indexOf(asked.find((request) => request.task === "next")!) < asked.indexOf(move), "what to learn is asked before what to do");

    // Kept under the adapter, in the app's own store, dated when the note was said.
    const record = (await store.get(scope))!;
    const show = record.entities.find((entity) => entity.id === "linda")!.facts.find((fact) => fact.type === "EVENT")!;
    assert.deepEqual(
      movesOf(record, "linda").map((item) => [item.adapter, item.label, item.fields, item.factIds, item.status, item.proposedAt, item.resolvedAt, item.episodeId === done.episodeId]),
      [["fixture-moment", "Wish her luck at the village show", { when: "2026-10-04", why: "She is entering" }, [show.id], "open", said.toISOString(), null, true]],
    );
  });

  it("keeps the facts when a move call fails, and counts the call: thrown, it leaves the note unpriced", async () => {
    const { model } = cannedModel({ extract: [entering()], reconcile: [{ decisions: [], summary: "" }], move: [new Error("provider down")] });
    const store = memoryStore();
    const knew = localIntelligence({ lenses: [fixtureLens()], adapters: [fixtureAdapter()], model, store, background: false });
    await knew.upsertEntity(scope, { id: "linda", name: "Linda" });
    await knew.addEpisode(scope, { source: "note", content: "Mom gardens", entityHints: ["linda"], referenceAt: said });
    const now = await knew.extractNow(scope, { maxEpisodes: 1 });
    assert.equal(now.outcome, "extracted", "a failed move never fails the note");
    const done = now.episodes[0]!;
    assert.equal(done.status, "ingested");
    if (done.status === "ingested") assert.deepEqual([done.calls, done.costUsd, done.moves], [4, null, { proposed: 0, closed: 0, rejected: 0 }]);
    assert.equal((await knew.getEntity(scope, "linda"))!.facts.length, 2);
    assert.deepEqual(movesOf((await store.get(scope))!, "linda"), []);
  });

  it("asks under every adapter, in the order given, for each entity the note changed and never the knower, whether or not the vocabulary proposes directions", async () => {
    const quiet = compileLens(fixtureLensDefinition(), compileVocabulary({ ...fixtureVocabularyDefinition(), directions: false }));
    const moments = compileAdapter(fixtureAdapterDefinition(), quiet.vocabulary);
    const nudges = compileAdapter({ id: "nudges", version: 1, vocabulary: "fixture", noun: "nudge", instructions: "**A nudge** is a word in season." }, quiet.vocabulary);
    const { model, asked } = cannedModel({
      extract: [extraction([extracted("linda", "LIKES", "Gardening"), extracted(KNOWER_ID, "MEANS", "Can spend about £40")])],
      reconcile: [{ decisions: [], summary: "" }, { decisions: [], summary: "" }],
    });
    const knew = localIntelligence({ lenses: [quiet], adapters: [moments, nudges], model, background: false });
    await knew.upsertEntity(scope, { id: "linda", name: "Linda" });
    await knew.addEpisode(scope, { source: "note", content: "Mom gardens; I can spend about £40.", entityHints: ["linda"], referenceAt: said });
    const done = (await knew.extractNow(scope, { maxEpisodes: 1 })).episodes[0]!;
    assert.deepEqual(asked.map((request) => request.task), ["extract", "reconcile", "reconcile", "move", "move"], "no next for a vocabulary without directions, and no move for the knower");
    assert.deepEqual(
      asked.filter((request) => request.task === "move").map((request) => request.prompt.split("\n")[0]),
      ["Moves of kind fixture-moment for this person: Linda", "Moves of kind nudges for this person: Linda"],
    );
    assert.equal((asked[4]!.schema as { properties: { proposed: { items: { required: string[] } } } }).properties.proposed.items.required.join(), "label,factIds", "an adapter with no fields asks for none");
    assert.equal(done.status, "ingested");
    if (done.status === "ingested") assert.deepEqual([done.directions, done.moves], [{ proposed: 0, answered: 0, withdrawn: 0, rejected: 0 }, { proposed: 0, closed: 0, rejected: 0 }]);
  });

  it("proposes no move for someone just added: a move rests on facts a note brought, and there are none yet", async () => {
    const { model, asked } = cannedModel({});
    const knew = localIntelligence({ lenses: [fixtureLens()], adapters: [fixtureAdapter()], model });
    await knew.upsertEntity(scope, { id: "linda", name: "Linda" });
    await knew.settled();
    assert.deepEqual(asked.map((request) => request.task), ["next"]);
  });

  it("closes what a later note settles, follows a correction to its replacement, withdraws a move whose ground is retracted, and reads it all back from the store in a new process", async () => {
    const store = memoryStore();
    const first = cannedModel({ extract: [entering()], reconcile: [{ decisions: [], summary: "" }], move: [proposes] });
    const knew = localIntelligence({ lenses: [fixtureLens()], adapters: [fixtureAdapter()], model: first.model, store, background: false });
    await knew.upsertEntity(scope, { id: "linda", name: "Linda" });
    await knew.addEpisode(scope, { source: "note", content: "Mom gardens, and is entering the village show on 4 October", entityHints: ["linda"], referenceAt: said });
    await knew.extractNow(scope, { maxEpisodes: 1 });
    const [wish] = movesOf((await store.get(scope))!, "linda");

    // A week on, in a new process over the same store: she won. The correction replaces the
    // entry fact, so the open move rests on the replacement by the time the model is asked;
    // the model closes it as done and proposes what follows.
    const later = new Date("2026-10-08T09:00:00Z");
    const second = cannedModel({
      extract: [extraction([extracted("linda", "EVENT", "Won second prize at the village show", { validAt: "2026-10-04" })])],
      reconcile: [
        (request: ModelRequest) => {
          const entered = /^- (f\d+) \| EVENT \| Entering the village show/m.exec(request.prompt)![1]!;
          return { decisions: [{ newIndex: 0, action: "supersede", factId: entered, invalidAt: null }], summary: "Linda, a prize-winner." };
        },
      ],
      move: [
        (request: ModelRequest) => {
          const won = /^- (\S+) \| EVENT \| Won second prize/m.exec(request.prompt)![1]!;
          const open = /^- (\S+) \| Wish her luck at the village show \| when: 2026-10-04; why: She is entering \| (\S+) \(lapsed\)$/m.exec(request.prompt)!;
          assert.deepEqual([open[1], open[2]], [wish!.id, won], "the open move is shown resting on the replacement, and lapsed, its day having passed");
          return { closed: [{ moveId: open[1]!, reason: "done" }], proposed: [{ label: "Congratulate her on second prize", factIds: [won], fields: { when: null, why: "She won" } }] };
        },
      ],
    });
    const again = localIntelligence({ lenses: [fixtureLens()], adapters: [fixtureAdapter()], model: second.model, store, background: false });
    await again.addEpisode(scope, { source: "note", content: "Mom won second prize at the show!", entityHints: ["linda"], referenceAt: later });
    const done = (await again.extractNow(scope, { maxEpisodes: 1 })).episodes[0]!;
    assert.equal(done.status, "ingested");
    if (done.status === "ingested") assert.deepEqual([done.facts, done.moves], [{ added: 0, merged: 0, superseded: 1 }, { proposed: 1, closed: 1, rejected: 0 }]);
    const won = (await again.searchFacts(scope, "second prize"))[0]!;
    assert.deepEqual(
      movesOf((await store.get(scope))!, "linda").map((item) => [item.label, item.status, item.resolvedAt, item.factIds]),
      [
        ["Wish her luck at the village show", "done", later.toISOString(), [won.id]],
        ["Congratulate her on second prize", "open", null, [won.id]],
      ],
    );

    // The knower takes the prize back: the move resting on it alone is withdrawn, dated to the retraction.
    const retracted = new Date("2026-10-09T00:00:00Z");
    await again.invalidateFact(scope, won.id, { at: retracted });
    assert.deepEqual(
      movesOf((await store.get(scope))!, "linda").map((item) => [item.label, item.status, item.resolvedAt]),
      [
        ["Wish her luck at the village show", "done", later.toISOString()],
        ["Congratulate her on second prize", "withdrawn", retracted.toISOString()],
      ],
    );
  });

  it("refuses an adapter over another vocabulary, and two of one name", () => {
    const elsewhere = compileVocabulary({ ...fixtureVocabularyDefinition(), id: "elsewhere" });
    const other = compileAdapter({ ...fixtureAdapterDefinition(), vocabulary: "elsewhere" }, elsewhere);
    const { model } = cannedModel({});
    assert.throws(() => localIntelligence({ lenses: [fixtureLens()], adapters: [other], model }), /every adapter reads the one vocabulary, and fixture-moment reads elsewhere, not fixture/);
    assert.throws(() => localIntelligence({ lenses: [fixtureLens()], adapters: [fixtureAdapter(), fixtureAdapter()], model }), /two adapters named fixture-moment/);
  });
});

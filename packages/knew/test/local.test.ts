import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { KNOWER_ID, localIntelligence, memoryStore, type LocalStore, type Model, type ModelRequest, type ScopeRecord } from "../src/index.ts";
import { extracted, extraction, fixtureGiftLens, fixtureLens } from "../src/testing.ts";

/**
 * The engine in your process: a note read with the app's own model function,
 * kept in the app's own store. The model here answers from a script, by task,
 * and records what it was asked.
 */

type Answer = unknown | Error | ((request: ModelRequest) => unknown);

function cannedModel(answers: Record<ModelRequest["task"], Answer[]>, usage = { inputTokens: 1_000, outputTokens: 100, costUsd: 0.01 }) {
  const asked: ModelRequest[] = [];
  const model: Model = async (request) => {
    asked.push(request);
    const next = answers[request.task].shift();
    if (next === undefined) throw new Error(`unscripted ${request.task}`);
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
    assert.deepEqual(now.calls.map((call) => [call.method, call.model, call.usage?.costUsd]), [["extract", "canned", 0.01], ["reconcile", "canned", 0.01], ["reconcile", "canned", 0.01]]);
    const done = now.episodes[0]!;
    assert.equal(done.status, "ingested");
    if (done.status === "ingested") assert.equal(done.costUsd, 0.03);

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
    const { model } = cannedModel({ extract: [extraction([extracted("linda", "LIKES", "Gardening")])], reconcile: [{ decisions: [], summary: "Gardens." }] });
    const first = localIntelligence({ lenses: [fixtureLens()], model, store: jsonStore, background: false });
    await first.upsertEntity(scope, { id: "linda", name: "Linda" });
    await first.addEpisode(scope, { source: "note", sourceRef: "n-1", content: "Mom gardens", entityHints: ["linda"], referenceAt: said });
    await first.extractNow(scope, { maxEpisodes: 1 });

    const second = localIntelligence({ lenses: [fixtureLens()], model: cannedModel({ extract: [], reconcile: [] }).model, store: jsonStore, background: false });
    const view = (await second.getEntity(scope, "linda"))!;
    assert.deepEqual([view.summary, view.facts.map((f) => f.fact), view.facts[0]!.createdAt.getTime()], ["Gardens.", ["Gardening"], said.getTime()]);
    assert.equal((await second.episodes(scope))[0]!.ingestedAt instanceof Date, true);
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

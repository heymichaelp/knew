import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  attributeFacts,
  compileLens,
  compileVocabulary,
  extendLens,
  extendVocabulary,
  KNOWER_ID,
  lensProblems,
  mustHonorFrom,
  parseVocabularyDefinition,
  readinessFor,
  renderBrief,
  subjectOf,
  type Fact,
} from "../src/index.ts";
import { person } from "../src/presets.ts";
import { extracted, extraction, fakeIntelligence, fixtureGiftLens, fixtureLens, fixtureVocabulary, fixtureVocabularyDefinition } from "../src/testing.ts";

/**
 * Understanding has three subjects: the entity, the relationship between the
 * knower and the entity (kept on the entity, one to each), and the knower
 * (kept on `self`, the same beside every entity). What to learn next ranks all
 * three, built on what is known in each.
 */

const at = (iso: string) => new Date(iso);
let n = 0;
const fact = (type: string, text: string, said: string, entityId = "linda", extra: Partial<Fact> = {}): Fact => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
  entityId,
  objectId: null,
  type,
  fact: text,
  attributes: {},
  validAt: null,
  invalidAt: null,
  createdAt: at(`${said}T00:00:00Z`),
  lastSaidAt: null,
  expiredAt: null,
  supersededById: null,
  episodeIds: ["e"],
  ...extra,
});
const now = at("2026-10-05T00:00:00Z");

describe("Scenario: A vocabulary says what each dimension is about", () => {
  it("reads a type's subject through its dimension, a retired type as the fallback's", () => {
    const vocabulary = fixtureVocabulary();
    assert.deepEqual(["LIKES", "HISTORY", "MEANS", "RETIRED_TYPE"].map((type) => subjectOf(vocabulary, type)), ["entity", "relationship", "knower", "entity"]);
  });

  it("refuses a fallback about the relationship or the knower: a fact that fits no other type is about the entity", () => {
    assert.throws(() => parseVocabularyDefinition({ ...fixtureVocabularyDefinition(), fallbackType: "MEANS" }), /fallbackType MEANS is about the knower/);
  });

  it("refuses a need whose types are about more than one subject", () => {
    const problems = lensProblems(
      { id: "mixed", version: 1, vocabulary: "fixture", header: "{who}", overHeading: "Over", needs: [{ id: "mixed", label: "Mixed", types: ["LIKES", "MEANS"] }] },
      fixtureVocabulary(),
    );
    assert.deepEqual(problems, ["need mixed counts types about the entity and the knower; a need is about one"]);
  });
});

describe("Scenario: Attribution keeps each fact with its subject", () => {
  it("puts what is about the writer on the knower, keeps the knower on every roster, and drops a fact filed under the wrong subject", () => {
    const vocabulary = fixtureVocabulary();
    const facts = [
      { entityId: KNOWER_ID, type: "MEANS", fact: "Can spend about £40", attributes: null, validAt: null, invalidAt: null },
      { entityId: "linda", type: "HISTORY", fact: "Raised the knower", attributes: null, validAt: null, invalidAt: null },
      { entityId: "linda", type: "MEANS", fact: "A budget on the person", attributes: null, validAt: null, invalidAt: null },
      { entityId: KNOWER_ID, type: "LIKES", fact: "A taste on the knower", attributes: null, validAt: null, invalidAt: null },
      { entityId: "carol", type: "LIKES", fact: "Not on the roster", attributes: null, validAt: null, invalidAt: null },
    ];
    const { byEntity, offRoster, misattributed } = attributeFacts(facts, new Set(["linda"]), (type) => subjectOf(vocabulary, type));
    assert.deepEqual([...byEntity].map(([id, list]) => [id, list.map((f) => f.fact)]), [
      [KNOWER_ID, ["Can spend about £40"]],
      ["linda", ["Raised the knower"]],
    ]);
    assert.deepEqual([offRoster, misattributed], [1, 2]);
  });
});

describe("Scenario: What to learn next ranks the entity, the relationship and the knower together", () => {
  const gift = fixtureGiftLens();

  it("counts each need against its subject's facts, and waits across subjects", () => {
    const bare = readinessFor(gift, { fields: {} }, [], now);
    assert.deepEqual(
      bare.needs.map((need) => [need.id, need.about, need.state, need.waitingOn]),
      [
        ["what-they-love", "entity", "open", []],
        ["how-you-know-them", "relationship", "waiting", ["what-you-can-spend"]],
        ["what-you-can-spend", "knower", "open", []],
      ],
    );
    assert.deepEqual(bare.next.map((d) => [d.need, d.about]), [["what-they-love", "entity"], ["what-you-can-spend", "knower"]]);

    const budget = fact("MEANS", "Can spend about £40", "2026-10-01", KNOWER_ID);
    const known = readinessFor(gift, { fields: {} }, [], now, [budget]);
    assert.deepEqual(known.next.map((d) => [d.need, d.about, d.value]), [["what-they-love", "entity", 3], ["how-you-know-them", "relationship", 2]], "the budget known, how you know them is offered");
    const history = known.next.find((d) => d.need === "how-you-know-them")!;
    assert.deepEqual(history.factIds, [budget.id], "built on what is known about the knower, the need it came after");
    assert.deepEqual(known.dimensions.find((d) => d.id === "means"), { id: "means", label: "Your means", about: "knower", facts: 1, due: 0, lastSaidAt: budget.createdAt, factIds: [budget.id] });
  });

  it("never counts a knower fact passed as an entity fact, or the other way round", () => {
    const budget = fact("MEANS", "Can spend about £40", "2026-10-01", KNOWER_ID);
    const wrong = readinessFor(gift, { fields: {} }, [budget], now, []);
    assert.equal(wrong.needs.find((need) => need.id === "what-you-can-spend")!.state, "open", "knower facts are read from the knower's own set");
  });
});

describe("Scenario: A page prints what is known about the knower where its lens places it, and honors what the knower must not do", () => {
  it("prints the knower's section under the gift lens, and nothing of them under one that gives them none", () => {
    const loves = fact("LIKES", "Gardening", "2026-10-01");
    const budget = fact("MEANS", "Can spend about £40", "2026-10-01", KNOWER_ID);
    const gift = renderBrief(fixtureGiftLens(), { entity: { name: "Linda", fields: {} }, summary: "", facts: [loves], knower: [budget], at: now })!;
    assert.ok(gift.includes("You:\n- Can spend about £40"), gift);
    const plain = renderBrief(fixtureLens(), { entity: { name: "Linda", fields: {} }, summary: "", facts: [loves], knower: [budget], at: now })!;
    assert.ok(!plain.includes("£40"), plain);
    assert.equal(renderBrief(fixtureGiftLens(), { entity: { name: "Linda", fields: {} }, summary: "", facts: [], knower: [budget], at: now }), null, "what is known about the knower alone makes no page about Linda");
  });

  it("hands over a pinned knower fact as one to honor, beside every entity", () => {
    const definition = fixtureVocabularyDefinition();
    const vocabulary = compileVocabulary({ ...definition, factTypes: { ...definition.factTypes, MEANS: { ...definition.factTypes.MEANS!, pinned: true } } });
    const lens = compileLens({ id: "plain", version: 1, vocabulary: "fixture", header: "{who}", overHeading: "Over" }, vocabulary);
    const line = fact("MEANS", "Never spends on alcohol", "2026-10-01", KNOWER_ID);
    assert.deepEqual(mustHonorFrom(lens, [], now, [line]), [{ type: "MEANS", fact: "Never spends on alcohol" }]);
  });
});

describe("Scenario: One note about Mia, read into all three subjects, through a gift lens over the person preset", () => {
  const vocabulary = compileVocabulary(extendVocabulary(person.vocabulary(), { id: "gifts", version: 1 }));
  const gift = compileLens(
    extendLens(person.lens(), {
      id: "gift",
      version: 1,
      vocabulary: "gifts",
      order: "listed",
      needs: Object.fromEntries([
        ...["work", "people", "between", "life", "background", "pursuits", "ahead", "together", "has", "avoid"].map((id) => [id, null]),
        ["budget", { dimension: "you", label: "What you can spend" }],
        ["loves", { label: "What they love", types: ["INTEREST", "TASTE"] }],
        ["how-close", { dimension: "between", label: "How you know each other" }],
      ]),
    }),
    vocabulary,
  );

  it("files the budget on the knower, the friendship and the taste on Mia, and meets all three needs for Mia and only the budget for Dad", async () => {
    const engine = fakeIntelligence({ lenses: [gift] });
    const scope = { clientId: "c", subjectId: "ana" };
    await engine.upsertEntity(scope, { id: "mia", name: "Mia" });
    await engine.upsertEntity(scope, { id: "dad", name: "Dad" });
    await engine.addEpisode(scope, { source: "note", sourceRef: "n-1", content: "I can spend about £40 on Mia. We've been friends since uni. She loves matcha.", entityHints: ["mia"], extract: "inline" });
    engine.script({
      extraction: extraction([
        extracted(KNOWER_ID, "CONSTRAINT", "Can spend about £40 on gifts"),
        extracted("mia", "HISTORY", "Friends since university"),
        extracted("mia", "TASTE", "Loves matcha"),
      ]),
    });
    await engine.extractNow(scope, { maxEpisodes: 1 });
    assert.deepEqual((await engine.getEntity(scope, KNOWER_ID))!.facts.map((f) => f.fact), ["Can spend about £40 on gifts"]);
    assert.deepEqual((await engine.getEntity(scope, "mia"))!.facts.map((f) => f.fact).sort(), ["Friends since university", "Loves matcha"]);
    const mia = (await engine.readiness(scope, "mia"))!;
    assert.deepEqual(mia.needs.map((need) => [need.id, need.about, need.state]), [
      ["budget", "knower", "met"],
      ["loves", "entity", "met"],
      ["how-close", "relationship", "met"],
    ]);
    const dad = (await engine.readiness(scope, "dad"))!;
    assert.deepEqual(dad.needs.map((need) => [need.id, need.state]), [
      ["budget", "met"],
      ["loves", "open"],
      ["how-close", "open"],
    ]);
    assert.deepEqual(dad.next.map((d) => [d.need, d.about]), [["loves", "entity"], ["how-close", "relationship"]], "for Dad, what is next builds on what is already known about the knower");
  });
});

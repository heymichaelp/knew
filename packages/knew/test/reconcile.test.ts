import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  attributeFacts,
  cleanProposals,
  orderEntities,
  parseLooseDate,
  planReconciliation,
  type Fact,
} from "../src/index.ts";
import { fixtureVocabulary } from "../src/testing.ts";

const at = (iso: string) => new Date(iso);
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const current = (n: number, type: string, text: string): Fact => ({
  id: id(n),
  entityId: "s",
  objectId: null,
  type,
  fact: text,
  attributes: {},
  validAt: null,
  invalidAt: null,
  createdAt: at("2025-01-01T00:00:00Z"),
  lastSaidAt: null,
  expiredAt: null,
  supersededById: null,
  episodeIds: ["e"],
});

const plan = (
  incoming: Array<{ type: string; fact: string }>,
  decisions: Array<{ newIndex: number; action: "add" | "merge" | "supersede" | "drop"; factId: string | null; invalidAt?: string | null }>,
  facts: Fact[],
) =>
  planReconciliation({
    vocabulary: fixtureVocabulary(),
    entityId: "p",
    current: facts,
    incoming,
    reconciliation: { decisions: decisions.map((d) => ({ invalidAt: null, ...d })), summary: " About them. " },
    knownAt: at("2025-10-02T00:00:00Z"),
    summaryVersion: "reconcile.v1",
  });

describe("Scenario: A correction retires the old fact; a detail is added beside it", () => {
  it("supersedes what the model cites, with the end date it gave", () => {
    const austin = current(1, "OTHER", "Lives in Austin");
    const p = plan([{ type: "EVENT", fact: "Moved to Portland" }], [{ newIndex: 0, action: "supersede", factId: austin.id, invalidAt: "2025-09" }], [austin]);
    assert.equal(p.supersessions.length, 1);
    assert.equal(p.supersessions[0]!.factId, austin.id);
    assert.deepEqual(p.supersessions[0]!.invalidAt, at("2025-09-01T00:00:00Z"));
    assert.equal(p.summary, "About them.");
    assert.deepEqual(p.unknownFactIds, []);
  });

  it("downgrades a citation the model was never shown to an add, and says so", () => {
    const p = plan([{ type: "LIKES", fact: "Loves cheese" }], [{ newIndex: 0, action: "supersede", factId: id(99) }], [current(1, "LINE", "Vegan")]);
    assert.equal(p.adds.length, 1);
    assert.equal(p.supersessions.length, 0);
    assert.deepEqual(p.unknownFactIds, [id(99)]);
  });

  it("keeps an enduring fact when a different kind of fact tries to replace it", () => {
    const craft = current(1, "SKILL", "A machinist for 35 years");
    const p = plan([{ type: "CIRCUMSTANCE", fact: "Setting up a shop in his garage" }], [{ newIndex: 0, action: "supersede", factId: craft.id }], [craft]);
    assert.equal(p.adds.length, 1);
    assert.equal(p.supersessions.length, 0);
  });

  it("still lets an enduring fact be restated as its own type", () => {
    const craft = current(1, "SKILL", "Beginner potter");
    const p = plan([{ type: "SKILL", fact: "Teaches pottery" }], [{ newIndex: 0, action: "supersede", factId: craft.id }], [craft]);
    assert.equal(p.supersessions.length, 1);
  });

  it("supersedes one fact once per batch; the second claim becomes an add", () => {
    const old = current(1, "OTHER", "Works nights");
    const p = plan(
      [
        { type: "EVENT", fact: "New job, days only" },
        { type: "CIRCUMSTANCE", fact: "Has evenings free" },
      ],
      [
        { newIndex: 0, action: "supersede", factId: old.id },
        { newIndex: 1, action: "supersede", factId: old.id },
      ],
      [old],
    );
    assert.equal(p.supersessions.length, 1);
    assert.equal(p.adds.length, 1);
  });

  it("keeps a fact the model forgot to decide about, merges by id, and counts drops", () => {
    const wheel = current(1, "LIKES", "Wants a pottery wheel");
    const p = plan(
      [
        { type: "LIKES", fact: "The wheel again" },
        { type: "OTHER", fact: "Nice weather" },
        { type: "LIKES", fact: "Forgotten" },
      ],
      [
        { newIndex: 0, action: "merge", factId: wheel.id },
        { newIndex: 1, action: "drop", factId: null },
      ],
      [wheel],
    );
    assert.deepEqual(p.merges, [{ factId: wheel.id }]);
    assert.equal(p.dropped, 1);
    assert.deepEqual(p.adds.map((f) => f.fact), ["Forgotten"]);
  });

  it("leaves the summary alone when the model wrote nothing", () => {
    const p = planReconciliation({
      vocabulary: fixtureVocabulary(),
      entityId: "p",
      current: [],
      incoming: [],
      reconciliation: { decisions: [], summary: "   " },
      knownAt: at("2025-10-02T00:00:00Z"),
      summaryVersion: "v",
    });
    assert.equal(p.summary, null);
  });
});

describe("Scenario: Attribution is checked, never trusted", () => {
  it("drops a fact pinned on an id that is not on the roster, and keeps the rest by entity", () => {
    const { byEntity, offRoster } = attributeFacts(
      [
        { entityId: "linda", type: "LIKES", fact: "  Gardens  ", attributes: { level: null, kind: null }, validAt: "2025-03", invalidAt: "bogus" },
        { entityId: "stranger", type: "LIKES", fact: "x", attributes: null, validAt: null, invalidAt: null },
      ],
      new Set(["linda", "sam"]),
    );
    assert.equal(offRoster, 1);
    const linda = byEntity.get("linda")!;
    assert.equal(linda[0]!.fact, "Gardens");
    assert.deepEqual(linda[0]!.attributes, {});
    assert.deepEqual(linda[0]!.validAt, at("2025-03-01T00:00:00Z"));
    assert.equal(linda[0]!.invalidAt, null);
  });

  it("orders hinted entities first, then by volume, and counts what the cap dropped", () => {
    const byEntity = new Map([
      ["a", [{ type: "LIKES", fact: "1" }]],
      ["b", [{ type: "LIKES", fact: "1" }, { type: "LIKES", fact: "2" }]],
      ["c", [{ type: "LIKES", fact: "1" }, { type: "LIKES", fact: "2" }, { type: "LIKES", fact: "3" }]],
    ]);
    const { kept, droppedForCap } = orderEntities(byEntity, ["a"], 2);
    assert.deepEqual(kept, ["a", "c"]);
    assert.equal(droppedForCap, 2);
  });

  it("keeps a field update only for one of the vocabulary's fields, so a vocabulary with none proposes none", () => {
    const extraction = {
      unresolvedNames: [],
      aliases: [],
      fieldUpdates: [
        { entityId: "linda", field: "city", value: "Denver" },
        { entityId: "linda", field: "shoe_size", value: "8" },
      ],
    };
    assert.deepEqual(cleanProposals(extraction, new Set(["linda"]), ["city", "relationship"]).fieldUpdates, [{ entityId: "linda", field: "city", value: "Denver" }]);
    assert.deepEqual(cleanProposals(extraction, new Set(["linda"]), []).fieldUpdates, []);
    assert.deepEqual(cleanProposals(extraction, new Set(["linda"])).fieldUpdates, []);
  });

  it("trims and deduplicates proposals, keeping only on-roster field updates and aliases", () => {
    const cleaned = cleanProposals(
      {
        unresolvedNames: [" Aunt Carol ", "Aunt Carol", ""],
        fieldUpdates: [
          { entityId: "linda", field: "city", value: " Portland " },
          { entityId: "nobody", field: "city", value: "x" },
        ],
        aliases: [
          { entityId: "linda", alias: " Mom " },
          { entityId: "nobody", alias: "x" },
          { entityId: "linda", alias: "  " },
        ],
      },
      new Set(["linda"]),
      ["relationship", "city"],
    );
    assert.deepEqual(cleaned.unresolvedNames, ["Aunt Carol"]);
    assert.deepEqual(cleaned.fieldUpdates, [{ entityId: "linda", field: "city", value: "Portland" }]);
    assert.deepEqual(cleaned.aliases, [{ entityId: "linda", alias: "Mom" }]);
  });
});

describe("Scenario: Dates the model writes are read in three shapes and nothing else", () => {
  it("reads a year, a month and a day as UTC dates and refuses the rest", () => {
    assert.deepEqual(parseLooseDate("2025"), at("2025-01-01T00:00:00Z"));
    assert.deepEqual(parseLooseDate("2025-09"), at("2025-09-01T00:00:00Z"));
    assert.deepEqual(parseLooseDate("2025-09-14"), at("2025-09-14T00:00:00Z"));
    assert.equal(parseLooseDate("next spring"), null);
    assert.equal(parseLooseDate(null), null);
    assert.equal(parseLooseDate("2025-13-01"), null);
  });
});

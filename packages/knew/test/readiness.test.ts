import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compileLens,
  compileVocabulary,
  ENGINE_DEFAULTS,
  factsKnownAt,
  factsTrueAt,
  gapsFor,
  isDueForRevisit,
  readinessFor,
  renderBrief,
  type NeedSpec,
  type Fact,
  type Lens,
  type LensDefinition,
} from "../src/index.ts";
import { fixtureLens, fixtureLensDefinition, fixtureVisitLens, fixtureVocabulary, fixtureVocabularyDefinition } from "../src/testing.ts";

const at = (iso: string) => new Date(iso);
let n = 0;
const fact = (type: string, text: string, said: string, extra: Partial<Fact> = {}): Fact => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
  entityId: "linda",
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

const mother = { fields: { relationship: "mother" } };
const friend = { fields: { relationship: "friend" } };

const lensOf = (needs: NeedSpec[], extra: Partial<LensDefinition> = {}): Lens =>
  compileLens({ id: "t", version: 1, vocabulary: "fixture", header: "About {who}:", overHeading: "Over", needs, ...extra }, fixtureVocabulary());

/** The plain rule, as an oracle: a need is a gap when it applies and no current
 *  fact of one of its types exists. */
function plainGaps(lens: Lens, fields: Record<string, string | null>, facts: Fact[], when: Date): string[] {
  const live = new Set(facts.filter((f) => !f.expiredAt && !(f.invalidAt && f.invalidAt <= when)).map((f) => f.type));
  const applies = (need: Lens["needs"][number]) =>
    need.when.every((clause) => {
      const value = fields[clause.field];
      return typeof value === "string" && clause.equals.some((e) => e.trim().toLowerCase() === value.trim().toLowerCase());
    });
  return lens.needs.filter((need) => applies(need) && !need.types.some((type) => live.has(type))).map((need) => need.id);
}

describe("Scenario: With nothing but types declared, a gap is an applicable need with no current fact", () => {
  const now = at("2026-10-05T00:00:00Z");
  const fieldsCases: Array<Record<string, string | null>> = [{ relationship: "mother" }, { relationship: "Mother " }, { relationship: "friend" }, {}];
  const factCases: Fact[][] = [
    [],
    [fact("LIKES", "Gardens", "2026-01-01")],
    [fact("SKILL", "Throws pots", "2026-01-01")],
    [fact("CIRCUMSTANCE", "Works nights", "2026-09-01")],
    [fact("CIRCUMSTANCE", "Works nights", "2026-01-01", { expiredAt: at("2026-02-01T00:00:00Z") })],
    [fact("CIRCUMSTANCE", "Six months in Lisbon from May", "2026-04-20", { invalidAt: at("2026-09-01T00:00:00Z") })],
    [fact("RETIRED_TYPE", "A type the lens no longer has", "2026-01-01")],
    [fact("LIKES", "Gardens", "2026-01-01"), fact("CIRCUMSTANCE", "Works days", "2026-09-30")],
    [fact("CIRCUMSTANCE", "Works days", "2025-01-01")],
  ];

  it("reports the plain rule's gaps, for every entity and ledger", () => {
    const lens = fixtureLens();
    for (const fields of fieldsCases) {
      for (const facts of factCases) {
        const expected = plainGaps(lens, fields, facts, now);
        assert.deepEqual(gapsFor(lens, { fields }, facts, now).map((g) => g.need), expected, JSON.stringify({ fields, facts: facts.map((f) => f.fact) }));
      }
    }
  });

  it("with no revisit windows either, every direction is a gap and readiness is the share met", () => {
    const definition = fixtureVocabularyDefinition();
    const { revisitAfterDays: _window, ...circumstance } = definition.factTypes.CIRCUMSTANCE!;
    const vocabulary = compileVocabulary({ ...definition, factTypes: { ...definition.factTypes, CIRCUMSTANCE: circumstance } });
    const lens = compileLens(fixtureLensDefinition(), vocabulary);
    for (const fields of fieldsCases) {
      for (const facts of factCases) {
        const expected = plainGaps(lens, fields, facts, now);
        const readiness = readinessFor(lens, { fields }, facts, now);
        assert.deepEqual(readiness.next.map((s) => [s.kind, s.need]), expected.map((id) => ["learn", id]));
        assert.ok(readiness.needs.every((a) => a.state === "met" || a.state === "open"), "nothing is thin, waiting or due");
        const answered = readiness.needs.length - expected.length;
        assert.equal(readiness.overall, Math.round((answered / readiness.needs.length) * 1000) / 1000);
      }
    }
  });
});

describe("Scenario: Enough counts fresh facts, and strength says how far along a need is", () => {
  const lens = lensOf([{ id: "love", label: "What do they love?", types: ["LIKES"], enough: 2 }]);
  const now = at("2026-10-05T00:00:00Z");

  it("goes open, thin, met as facts arrive", () => {
    const one = fact("LIKES", "Gardens", "2026-01-01");
    const two = fact("LIKES", "Paints tiles", "2026-02-01");
    const standing = (facts: Fact[]) => readinessFor(lens, mother, facts, now).needs[0]!;
    assert.deepEqual([standing([]).state, standing([]).strength], ["open", 0]);
    assert.deepEqual([standing([one]).state, standing([one]).strength, standing([one]).facts], ["thin", 0.5, 1]);
    assert.deepEqual([standing([one, two]).state, standing([one, two]).strength], ["met", 1]);
    const thin = readinessFor(lens, mother, [one], now);
    assert.deepEqual(thin.next, [{ kind: "learn", need: "love", label: "What do they love?", dimension: null, types: ["LIKES"], value: 0.5, factIds: [one.id] }], "a thin need builds on what is known");
  });

  it("puts the heavier need first, keeps the lens's order on a tie, and rounds to three places", () => {
    const weighted = lensOf([
      { id: "a", label: "A?", types: ["LIKES"] },
      { id: "b", label: "B?", types: ["HAS"], weight: 3 },
      { id: "c", label: "C?", types: ["PERSON"] },
    ]);
    assert.deepEqual(readinessFor(weighted, mother, [], now).next.map((s) => [s.need, s.value]), [["b", 3], ["a", 1], ["c", 1]]);

    const tied = lensOf([
      { id: "aa", label: "AA?", types: ["HAS"], weight: 2 },
      { id: "bb", label: "BB?", types: ["LIKES"], weight: 3, enough: 3 },
    ]);
    const tie = readinessFor(tied, mother, [fact("LIKES", "Gardens", "2026-01-01")], now);
    assert.deepEqual(
      tie.next.map((s) => [s.need, s.value]),
      [["aa", 2], ["bb", 2]],
      "2 and 3 × (1 − ⅓) are the same value, so the lens's order decides — rounding happens only on the way out",
    );

    const thirds = lensOf([
      { id: "x", label: "X?", types: ["LIKES"], enough: 3 },
      { id: "y", label: "Y?", types: ["HAS"], weight: 2 },
    ]);
    const readiness = readinessFor(thirds, mother, [fact("LIKES", "Gardens", "2026-01-01"), fact("HAS", "A wheel", "2026-01-01")], now);
    assert.equal(readiness.needs[0]!.strength, 0.333);
    assert.equal(readiness.next[0]!.value, 0.667);
    assert.equal(readiness.overall, 0.778);
  });
});

describe("Scenario: One fact is one fact, however the caller assembled the ledger", () => {
  it("counts a fact passed twice once", () => {
    const lens = lensOf([{ id: "love", label: "What do they love?", types: ["LIKES"], enough: 2 }]);
    const once = fact("LIKES", "Gardens", "2026-01-01");
    const standing = readinessFor(lens, mother, [once, { ...once }], at("2026-10-05T00:00:00Z")).needs[0]!;
    assert.deepEqual([standing.state, standing.facts], ["thin", 1]);
  });
});

describe("Scenario: A fact goes due for a revisit when its window passes unsaid — on the day, and only then", () => {
  const lens = fixtureLens();
  const said = "2026-01-01";
  const day89 = at("2026-03-31T00:00:00Z");
  const day90 = at("2026-04-01T00:00:00Z");

  it("is fresh the day before the window closes and due on the day it does", () => {
    const days = fact("CIRCUMSTANCE", "Works days", said);
    const vocabulary = fixtureVocabulary();
    assert.equal(isDueForRevisit(vocabulary, days, day89), false);
    assert.equal(isDueForRevisit(vocabulary, days, day90), true);
    const before = readinessFor(lens, mother, [days], day89);
    const after = readinessFor(lens, mother, [days], day90);
    assert.equal(before.needs.find((a) => a.id === "how-the-days-go")!.state, "met");
    const due = after.needs.find((a) => a.id === "how-the-days-go")!;
    assert.deepEqual([due.state, due.strength, due.facts, due.due], ["due", 0.5, 1, 1]);
    assert.deepEqual(after.next.find((s) => s.kind === "revisit"), { kind: "revisit", need: "how-the-days-go", label: due.label, dimension: null, types: ["CIRCUMSTANCE"], value: 0.5, factIds: [days.id] });
    assert.equal(after.dimensions.find((d) => d.id === "life")!.due, 1);
  });

  it("counts from when it was last said, not when it was first said", () => {
    const retold = fact("CIRCUMSTANCE", "Works days", said, { lastSaidAt: at("2026-03-15T00:00:00Z") });
    assert.equal(readinessFor(lens, mother, [retold], day90).needs.find((a) => a.id === "how-the-days-go")!.state, "met");
  });

  it("never comes due for a type that names no window, however old", () => {
    const old = fact("LIKES", "Gardens", "2016-01-01");
    assert.equal(readinessFor(lens, friend, [old], day90).needs[0]!.state, "met");
    assert.equal(ENGINE_DEFAULTS.revisitAfterDays, null);
  });

  it("does not let facts due for a revisit meet a need, however many there are", () => {
    const one = fact("CIRCUMSTANCE", "Works days", "2025-12-01");
    const two = fact("CIRCUMSTANCE", "Cares for her mother at weekends", "2025-11-01");
    const readiness = readinessFor(lens, mother, [one, two], day90);
    const standing = readiness.needs.find((a) => a.id === "how-the-days-go")!;
    assert.deepEqual([standing.state, standing.strength], ["due", 0.5], "two quiet facts are not one fresh one");
    assert.deepEqual(readiness.next.find((s) => s.kind === "revisit")!.factIds, [two.id, one.id], "oldest said first");
  });

  it("changes nothing on the page", () => {
    const facts = [fact("CIRCUMSTANCE", "Works days", said), fact("LIKES", "Gardens", said)];
    const page = (when: Date) => renderBrief(lens, { entity: { name: "Linda", fields: { relationship: "mother" } }, summary: "", facts, at: when });
    assert.equal(page(day90), page(day89));
  });
});

describe("Scenario: Coarse before fine — a need waits until the one it comes after is met", () => {
  const lens = fixtureVisitLens();
  const now = at("2026-10-05T00:00:00Z");
  const loves = (entity: { fields: Record<string, string | null> }, facts: Fact[]) =>
    readinessFor(lens, entity, facts, now).needs.find((a) => a.id === "what-they-love");

  it("waits while what it comes after is open, and is not offered", () => {
    const readiness = readinessFor(lens, mother, [fact("LIKES", "Gardens", "2026-09-01")], now);
    const standing = readiness.needs.find((a) => a.id === "what-they-love")!;
    assert.deepEqual([standing.state, standing.waitingOn, standing.strength], ["waiting", ["how-the-days-go"], 0.5]);
    assert.ok(!readiness.next.some((s) => s.need === "what-they-love"));
  });

  it("stays met once met, whatever it waits on", () => {
    const standing = loves(mother, [fact("LIKES", "Gardens", "2026-09-01"), fact("SKILL", "Throws pots", "2026-09-01")])!;
    assert.deepEqual([standing.state, standing.waitingOn], ["met", []]);
  });

  it("goes ahead once what it comes after is answered — even by a fact due for a revisit — or does not apply", () => {
    const quiet = fact("CIRCUMSTANCE", "Works days", "2025-01-01");
    assert.equal(loves(mother, [quiet])!.state, "open", "answered, though due: the coarse thing is known");
    assert.equal(loves(friend, [])!.state, "open", "the need it comes after does not apply to a friend");
  });

  it("builds an open need's direction on the facts of the need it comes after", () => {
    const days = fact("CIRCUMSTANCE", "Works days", "2026-09-01");
    const step = readinessFor(lens, mother, [days], now).next.find((s) => s.need === "what-they-love")!;
    assert.deepEqual([step.kind, step.factIds], ["learn", [days.id]]);
  });

  it("terminates on a lens that skipped validation and waits in a circle", () => {
    const circular = compileLens(
      {
        id: "circle",
        version: 1,
        vocabulary: "fixture",
        header: "{who}",
        overHeading: "Over",
        needs: [
          { id: "a", label: "A?", types: ["LIKES"], after: ["b"] },
          { id: "b", label: "B?", types: ["HAS"], after: ["a"] },
        ],
      },
      fixtureVocabulary(),
    );
    assert.deepEqual(readinessFor(circular, mother, [], now).needs.map((a) => a.state), ["waiting", "waiting"]);
  });
});

describe("Scenario: The evidence per dimension needs no objective", () => {
  const now = at("2026-10-05T00:00:00Z");
  const facts = [
    fact("CIRCUMSTANCE", "Works days", "2026-09-01", { lastSaidAt: at("2026-10-01T00:00:00Z") }),
    fact("EVENT", "Moved home", "2026-09-20"),
    fact("CIRCUMSTANCE", "Six months in Lisbon from May", "2026-04-20", { invalidAt: at("2026-09-01T00:00:00Z") }),
    fact("LIKES", "Paints tiles", "2026-01-01", { expiredAt: at("2026-02-01T00:00:00Z") }),
    fact("RETIRED_TYPE", "Kept under the fallback", "2026-03-01"),
  ];

  it("counts current facts per dimension in the vocabulary's order, newest said first, the latest telling as last said", () => {
    const readiness = readinessFor(fixtureLens(), mother, facts, now);
    assert.deepEqual(
      readiness.dimensions.map((d) => [d.id, d.facts]),
      [
        ["never-cross", 0],
        ["has", 0],
        ["likes", 0],
        ["life", 2],
        ["people", 0],
        ["other", 1],
      ],
      "an ended fact and a retired one count for nothing; a retired type counts under the fallback",
    );
    const life = readiness.dimensions.find((d) => d.id === "life")!;
    assert.deepEqual([life.lastSaidAt, life.factIds], [at("2026-10-01T00:00:00Z"), [facts[0]!.id, facts[1]!.id]]);
  });

  it("reads the same through every lens over the vocabulary", () => {
    assert.deepEqual(readinessFor(fixtureLens(), mother, facts, now).dimensions, readinessFor(fixtureVisitLens(), mother, facts, now).dimensions);
  });

  it("has nothing to report for a lens with no need that applies to this entity", () => {
    const silent = readinessFor(lensOf([]), mother, facts, now);
    assert.deepEqual([silent.overall, silent.needs, silent.next], [null, [], []]);
    const parentsOnly = readinessFor(lensOf([{ id: "p", label: "P?", types: ["PERSON"], when: [{ field: "relationship", equals: ["father"] }] }]), mother, facts, now);
    assert.equal(parentsOnly.overall, null);
  });
});

describe("Scenario: A need of a dimension counts every type in it, a retired type as the fallback", () => {
  const now = at("2026-10-05T00:00:00Z");
  const retired = fact("RETIRED_TYPE", "Kept under the fallback", "2026-03-01");

  it("counts a retired type's fact toward a dimension need, and leaves a need by type to the raw type", () => {
    const byDimension = lensOf([{ id: "anything-else", label: "Anything else?", dimension: "other" }]);
    const byType = lensOf([{ id: "anything-else", label: "Anything else?", types: ["OTHER"] }]);
    assert.equal(readinessFor(byDimension, mother, [retired], now).needs[0]!.state, "met");
    assert.equal(readinessFor(byType, mother, [retired], now).needs[0]!.state, "open");
  });

  it("names the lens and its objective, and the moment it describes", () => {
    const readiness = readinessFor(fixtureVisitLens(), mother, [], now);
    assert.deepEqual([readiness.lens, readiness.objective, readiness.at], ["fixture-visit", "Plan a visit: how their days go before what they love.", now]);
  });
});

describe("Scenario: A lens can keep its directions in the order it lists them", () => {
  const now = at("2026-10-05T00:00:00Z");
  const needs: NeedSpec[] = [
    { id: "light", label: "Light", types: ["CIRCUMSTANCE"] },
    { id: "heavy", label: "Heavy", types: ["LIKES"], weight: 3 },
  ];

  it("puts the first need not met first, whatever the weights, where the value order would not", () => {
    assert.deepEqual(readinessFor(lensOf(needs), mother, [], now).next.map((d) => d.need), ["heavy", "light"]);
    assert.deepEqual(readinessFor(lensOf(needs, { order: "listed" }), mother, [], now).next.map((d) => d.need), ["light", "heavy"]);
  });

  it("puts a stale first need ahead of an open heavy one, so 'first of these that applies' needs no weights", () => {
    const stale = fact("CIRCUMSTANCE", "Works nights", "2026-01-01");
    const listed = readinessFor(lensOf(needs, { order: "listed" }), mother, [stale], now);
    assert.deepEqual(listed.next.map((d) => [d.kind, d.need]), [["revisit", "light"], ["learn", "heavy"]]);
    assert.deepEqual(readinessFor(lensOf(needs), mother, [stale], now).next.map((d) => d.need), ["heavy", "light"], "by value, the open heavy need wins");
  });
});

describe("Scenario: What is true at a moment is what was believed then, less what had ended", () => {
  it("keeps a six-month stay true for its six months, and believed all year", () => {
    const stay = fact("CIRCUMSTANCE", "Six months in Lisbon", "2026-04-01", { invalidAt: at("2026-10-01T00:00:00Z") });
    assert.deepEqual(factsTrueAt([stay], at("2026-06-01T00:00:00Z")).map((f) => f.fact), ["Six months in Lisbon"]);
    assert.deepEqual(factsTrueAt([stay], at("2026-11-01T00:00:00Z")), [], "over by its own end date");
    assert.deepEqual(factsKnownAt([stay], at("2026-11-01T00:00:00Z")).map((f) => f.fact), ["Six months in Lisbon"], "and still believed");
    assert.deepEqual(factsTrueAt([stay], at("2026-03-01T00:00:00Z")), [], "and not yet said");
  });
});

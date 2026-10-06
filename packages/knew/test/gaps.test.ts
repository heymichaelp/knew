import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { gapsFor, type Fact } from "../src/index.ts";
import { fakeIntelligence, fixtureLens, fixtureVisitLens } from "../src/testing.ts";

const at = (iso: string) => new Date(iso);

const fact = (type: string, text: string, extra: Partial<Fact> = {}): Fact => ({
  id: `00000000-0000-4000-8000-${String(Math.floor(Math.random() * 1e12)).padStart(12, "0")}`,
  entityId: "s",
  objectId: null,
  type,
  fact: text,
  attributes: {},
  validAt: null,
  invalidAt: null,
  createdAt: at("2026-01-01T00:00:00Z"),
  lastSaidAt: null,
  expiredAt: null,
  supersededById: null,
  episodeIds: ["e"],
  ...extra,
});

describe("Scenario: The lens asks questions, and the engine says which are still worth asking, in order", () => {
  const lens = fixtureLens();
  const jan = at("2026-01-15T00:00:00Z");

  it("lists every applicable ask for an entity known only by name, each with what answers it", () => {
    const gaps = gapsFor(lens, { fields: { relationship: "mother" } }, [], jan);
    assert.deepEqual(gaps, [
      { id: "what-they-love", question: "What do they love doing, and how deeply?", dimension: null, answeredBy: ["LIKES", "SKILL"] },
      { id: "how-the-days-go", question: "What do their days allow, living where they do?", dimension: null, answeredBy: ["CIRCUMSTANCE"] },
    ]);
  });

  it("closes an ask once a current fact of an answering type exists", () => {
    assert.deepEqual(gapsFor(lens, { fields: { relationship: "mother" } }, [fact("LIKES", "Gardens")], jan).map((g) => g.id), ["how-the-days-go"]);
  });

  it("applies a conditional ask only when the entity's field matches, case-insensitively", () => {
    assert.deepEqual(gapsFor(lens, { fields: { relationship: "Mother " } }, [], jan).map((g) => g.id), ["what-they-love", "how-the-days-go"]);
    assert.deepEqual(gapsFor(lens, { fields: { relationship: "friend" } }, [], jan).map((g) => g.id), ["what-they-love"]);
    assert.deepEqual(gapsFor(lens, { fields: {} }, [], jan).map((g) => g.id), ["what-they-love"]);
  });

  it("reopens an ask when its answering fact is retired or has ended by date", () => {
    const retired = fact("CIRCUMSTANCE", "Works nights", { expiredAt: at("2026-02-01T00:00:00Z") });
    assert.deepEqual(gapsFor(lens, { fields: { relationship: "father" } }, [retired], jan).map((g) => g.id), ["what-they-love", "how-the-days-go"]);
    const over = fact("CIRCUMSTANCE", "Six months in Lisbon from May", { invalidAt: at("2026-11-01T00:00:00Z") });
    assert.deepEqual(gapsFor(lens, { fields: { relationship: "father" } }, [over], at("2026-07-01T00:00:00Z")).map((g) => g.id), ["what-they-love"]);
    assert.deepEqual(gapsFor(lens, { fields: { relationship: "father" } }, [over], at("2026-12-01T00:00:00Z")).map((g) => g.id), ["what-they-love", "how-the-days-go"]);
  });

  it("orders the gaps by weight, leaves out an ask still waiting its turn, and names the dimension an ask asks about", () => {
    const visit = fixtureVisitLens();
    const gaps = gapsFor(visit, { fields: { relationship: "mother" } }, [], jan);
    assert.deepEqual(gaps.map((g) => [g.id, g.dimension]), [["how-the-days-go", null], ["people", "people"]]);
    assert.deepEqual(gaps[1]!.answeredBy, ["PERSON"]);
  });
});

describe("Scenario: The fake answers gaps and puts them on the brief, like the service", () => {
  it("knows nothing of a stranger, every ask of a newcomer, and fewer as facts land", async () => {
    const memory = fakeIntelligence();
    const scope = { clientId: "test", subjectId: "me" };
    assert.equal(await memory.gaps(scope, "linda"), null);
    await memory.upsertEntity(scope, { id: "linda", name: "Linda", fields: { relationship: "mother" } });
    assert.deepEqual((await memory.gaps(scope, "linda"))!.map((g) => g.id), ["what-they-love", "how-the-days-go"]);
    memory.seedFacts(scope, "linda", [{ type: "SKILL", fact: "Throws pots" }]);
    assert.deepEqual((await memory.gaps(scope, "linda"))!.map((g) => g.id), ["how-the-days-go"]);
    const brief = await memory.brief(scope, "linda");
    assert.deepEqual(brief!.gaps.map((g) => g.id), ["how-the-days-go"]);
    assert.deepEqual((await memory.gaps(scope, "linda", { lens: "fixture-visit" }))!.map((g) => g.id), ["how-the-days-go", "people"]);
  });

  it("refuses a kind its vocabulary does not describe", async () => {
    const memory = fakeIntelligence();
    await assert.rejects(memory.upsertEntity({ clientId: "test", subjectId: "me" }, { id: "lisbon", name: "Lisbon", kind: "place" }), /describes a person/);
  });
});

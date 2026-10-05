import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { gapsFor, parseLensDefinition, type Fact } from "../src/index.ts";
import { fakeIntelligence, fixtureLens, fixtureLensDefinition } from "../src/testing.ts";

const at = (iso: string) => new Date(iso);

const fact = (type: string, text: string, extra: Partial<Fact> = {}): Fact => ({
  id: `00000000-0000-4000-8000-${String(Math.floor(Math.random() * 1e12)).padStart(12, "0")}`,
  subjectId: "s",
  objectId: null,
  type,
  fact: text,
  attributes: {},
  validAt: null,
  invalidAt: null,
  createdAt: at("2026-01-01T00:00:00Z"),
  expiredAt: null,
  supersededById: null,
  episodeIds: ["e"],
  ...extra,
});

describe("Scenario: The lens asks questions, and the engine says which are still open", () => {
  const lens = fixtureLens();

  it("lists every applicable ask for someone known only by name", () => {
    const gaps = gapsFor(lens, { fields: { relationship: "mother" } }, []);
    assert.deepEqual(gaps.map((g) => g.id), ["what-they-love", "how-the-days-go"]);
    assert.equal(gaps[0]!.question, "What do they love doing, and how deeply?");
  });

  it("closes an ask once a current fact of an answering type exists", () => {
    const gaps = gapsFor(lens, { fields: { relationship: "mother" } }, [fact("LIKES", "Gardens")]);
    assert.deepEqual(gaps.map((g) => g.id), ["how-the-days-go"]);
  });

  it("applies a conditional ask only when the person's field matches, case-insensitively", () => {
    assert.deepEqual(gapsFor(lens, { fields: { relationship: "Mother " } }, []).map((g) => g.id), ["what-they-love", "how-the-days-go"]);
    assert.deepEqual(gapsFor(lens, { fields: { relationship: "friend" } }, []).map((g) => g.id), ["what-they-love"]);
    assert.deepEqual(gapsFor(lens, { fields: {} }, []).map((g) => g.id), ["what-they-love"]);
  });

  it("reopens an ask when its answering fact is retired or has ended by date", () => {
    const retired = fact("CIRCUMSTANCE", "Works nights", { expiredAt: at("2026-02-01T00:00:00Z") });
    assert.deepEqual(gapsFor(lens, { fields: { relationship: "father" } }, [retired]).map((g) => g.id), ["what-they-love", "how-the-days-go"]);
    const over = fact("CIRCUMSTANCE", "Six months in Lisbon from May", { invalidAt: at("2026-11-01T00:00:00Z") });
    assert.deepEqual(gapsFor(lens, { fields: { relationship: "father" } }, [over], at("2026-07-01T00:00:00Z")).map((g) => g.id), ["what-they-love"]);
    assert.deepEqual(gapsFor(lens, { fields: { relationship: "father" } }, [over], at("2026-12-01T00:00:00Z")).map((g) => g.id), ["what-they-love", "how-the-days-go"]);
  });

  it("refuses an ask answered by a type the lens does not have, or conditioned on a field it does not route", () => {
    const base = fixtureLensDefinition();
    assert.throws(() => parseLensDefinition({ ...base, asks: [{ id: "x", question: "?", answeredBy: ["NOPE"] }] }), /answered by NOPE/);
    assert.throws(
      () => parseLensDefinition({ ...base, asks: [{ id: "x", question: "?", when: [{ field: "age", equals: ["70"] }], answeredBy: ["LIKES"] }] }),
      /which is not a routing field/,
    );
    assert.throws(
      () => parseLensDefinition({ ...base, asks: [{ id: "x", question: "?", answeredBy: ["LIKES"] }, { id: "x", question: "??", answeredBy: ["LIKES"] }] }),
      /listed twice/,
    );
  });
});

describe("Scenario: The fake answers gaps and puts them on the brief, like the service", () => {
  it("knows nothing about a stranger, everything about a newcomer, and less as facts land", async () => {
    const memory = fakeIntelligence();
    const scope = { clientId: "test", subjectId: "me" };
    assert.equal(await memory.gaps(scope, "linda"), null);
    await memory.upsertPerson(scope, { id: "linda", name: "Linda", fields: { relationship: "mother" } });
    assert.deepEqual((await memory.gaps(scope, "linda"))!.map((g) => g.id), ["what-they-love", "how-the-days-go"]);
    memory.seedFacts(scope, "linda", [{ type: "SKILL", fact: "Throws pots" }]);
    assert.deepEqual((await memory.gaps(scope, "linda"))!.map((g) => g.id), ["how-the-days-go"]);
    const brief = await memory.brief(scope, "linda");
    assert.deepEqual(brief!.gaps.map((g) => g.id), ["how-the-days-go"]);
  });
});

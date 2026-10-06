import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { asKnownAt, factsKnownAt, lastSaidOf, mustHonorFrom, renderBrief, type Fact } from "../src/index.ts";
import { fixtureLens } from "../src/testing.ts";

const at = (iso: string) => new Date(iso);

const fact = (i: number, type: string, text: string, day: string, extra: Partial<Fact> = {}): Fact => ({
  id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
  entityId: "s",
  objectId: null,
  type,
  fact: text,
  attributes: {},
  validAt: null,
  invalidAt: null,
  createdAt: at(`${day}T00:00:00Z`),
  lastSaidAt: null,
  expiredAt: null,
  supersededById: null,
  episodeIds: ["e"],
  ...extra,
});

const linda = { name: "Linda", fields: { relationship: "mother", city: "Austin" } };

describe("Scenario: The brief puts what must never be crossed first and fits on a page", () => {
  it("keeps every pinned fact however long the ledger, and says what it left out", () => {
    const lens = fixtureLens();
    const facts: Fact[] = [
      fact(1, "LINE", "Vegan, strictly — no leather, no wool", "2024-01-05"),
      fact(2, "HAS", "Owns a good pour-over setup and a burr grinder", "2024-02-01"),
      fact(3, "SKILL", "Throws pots on a wheel", "2024-03-01", { attributes: { level: "serious" } }),
      ...Array.from({ length: 77 }, (_, i) =>
        fact(10 + i, "LIKES", `An interest mentioned at some length to use the page, number ${i}`, "2025-06-01"),
      ),
    ];
    const page = renderBrief(lens, { entity: linda, summary: "A retired teacher.", facts, maxChars: 3_500 })!;

    assert.ok(page.length <= 3_500);
    assert.ok(page.startsWith("What we know about Linda (mother):\n\nA retired teacher."));
    assert.ok(page.includes("Vegan, strictly"));
    assert.ok(page.includes("pour-over"));
    assert.ok(page.indexOf("Never cross:") < page.indexOf("Already has:"));
    assert.ok(page.indexOf("Already has:") < page.indexOf("Likes:"));
    assert.match(page, /\(\+\d+ older facts not shown\)$/);
    // Dated, not weighted; tagged by the attribute the lens names.
    assert.ok(page.includes("told us 2024-01-05"));
    assert.ok(page.includes("Throws pots on a wheel [serious] (told us 2024-03-01)"));
  });

  it("has nothing to say about someone we know nothing about", () => {
    assert.equal(renderBrief(fixtureLens(), { entity: linda, summary: "  ", facts: [] }), null);
  });

  it("lists the pinned facts as what must be honored", () => {
    const lens = fixtureLens();
    const facts = [fact(1, "LINE", "Vegan", "2024-01-05"), fact(2, "LIKES", "Walks", "2024-01-05")];
    assert.deepEqual(mustHonorFrom(lens, facts, at("2026-01-01T00:00:00Z")), [{ type: "LINE", fact: "Vegan" }]);
  });
});

describe("Scenario: A stay with an end date is over when it ends, whether or not anyone says so", () => {
  const lens = fixtureLens();
  const facts = [
    fact(1, "CIRCUMSTANCE", "Spending six months in Lisbon from May", "2026-04-20", {
      validAt: at("2026-05-01T00:00:00Z"),
      invalidAt: at("2026-11-01T00:00:00Z"),
    }),
    fact(2, "LIKES", "Paints tiles", "2026-04-20"),
  ];
  const page = (when: string) => renderBrief(lens, { entity: linda, summary: "", facts, at: at(when) })!;

  it("reads as current before the end date, among what is true", () => {
    const july = page("2026-07-01T00:00:00Z");
    assert.ok(july.includes("Life:\n- Spending six months in Lisbon"));
    assert.ok(!july.includes("No longer the case"));
  });

  it("leaves the sections after the end date, and is listed last as context", () => {
    const december = page("2026-12-01T00:00:00Z");
    assert.ok(!december.includes("Life:"));
    assert.ok(december.includes("No longer the case:\n- Spending six months in Lisbon"));
    assert.ok(december.indexOf("Paints tiles") < december.indexOf("No longer the case"));
  });
});

describe("Scenario: What we knew then is answerable after we learn otherwise", () => {
  it("withholds an end date and a successor learned after the as-of moment", () => {
    const retired = fact(1, "OTHER", "Lives in Austin", "2025-01-10", {
      invalidAt: at("2025-09-01T00:00:00Z"),
      expiredAt: at("2025-10-02T00:00:00Z"),
      supersededById: "00000000-0000-4000-8000-000000000002",
    });
    const june = asKnownAt(retired, at("2025-06-01T00:00:00Z"));
    assert.deepEqual([june.invalidAt, june.expiredAt, june.supersededById], [null, null, null]);
    // After the retirement, it reads as retired.
    assert.equal(asKnownAt(retired, at("2026-01-01T00:00:00Z")).expiredAt, retired.expiredAt);
    // And without an as-of, it is simply not current.
    assert.deepEqual(factsKnownAt([retired]), []);
    assert.deepEqual(factsKnownAt([retired], at("2025-06-01T00:00:00Z")).map((f) => f.fact), ["Lives in Austin"]);
    assert.deepEqual(factsKnownAt([retired], at("2024-12-01T00:00:00Z")), []);
  });

  it("withholds a retelling that came after the as-of moment, and keeps one that came before", () => {
    const retold = fact(1, "LIKES", "Gardens", "2026-01-10", { lastSaidAt: at("2026-06-01T00:00:00Z") });
    assert.equal(asKnownAt(retold, at("2026-03-01T00:00:00Z")).lastSaidAt, null, "in March the June retelling had not happened");
    assert.equal(lastSaidOf(asKnownAt(retold, at("2026-03-01T00:00:00Z"))).getTime(), at("2026-01-10T00:00:00Z").getTime());
    assert.equal(asKnownAt(retold, at("2026-07-01T00:00:00Z")).lastSaidAt?.getTime(), at("2026-06-01T00:00:00Z").getTime());
    assert.equal(asKnownAt(retold), retold, "without an as-of moment, the fact as it stands");
  });

  it("applies both rules at once to a fact retold and then retired after the as-of moment", () => {
    const both = fact(1, "OTHER", "Lives in Austin", "2025-01-10", {
      lastSaidAt: at("2025-08-01T00:00:00Z"),
      invalidAt: at("2025-09-01T00:00:00Z"),
      expiredAt: at("2025-10-02T00:00:00Z"),
      supersededById: "00000000-0000-4000-8000-000000000002",
    });
    const june = asKnownAt(both, at("2025-06-01T00:00:00Z"));
    assert.deepEqual([june.lastSaidAt, june.invalidAt, june.expiredAt, june.supersededById], [null, null, null, null]);
  });
});

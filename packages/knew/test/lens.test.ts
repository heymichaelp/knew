import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { briefHeader, compileLens, isPinnedFactType, lensFrom, lensProblems, parseLensDefinition, sectionIndexOf, type LensDefinition } from "../src/index.ts";
import { fixtureLens, fixtureLensDefinition, fixtureVisitLens, fixtureVisitLensDefinition, fixtureVocabulary } from "../src/testing.ts";

const minimal: LensDefinition = { id: "plain", version: 1, vocabulary: "fixture", header: "About {who}:", overHeading: "Over" };

describe("Scenario: A lens says only what differs, and the vocabulary supplies the rest", () => {
  it("reads every dimension as a section, the vocabulary's pinned types, and each dimension's question as an ask", () => {
    const lens = compileLens(minimal, fixtureVocabulary());
    assert.deepEqual(
      lens.sections.map((s) => [s.heading, s.dimensions]),
      [
        ["Never cross", ["never-cross"]],
        ["Already has", ["has"]],
        ["Likes", ["likes"]],
        ["Life", ["life"]],
        ["People", ["people"]],
        ["Other", ["other"]],
      ],
    );
    assert.deepEqual([...lens.pinned].sort(), ["HAS", "LINE"]);
    assert.equal(lens.objective, null);
    assert.deepEqual(lens.asks, [
      { id: "people", question: "Who is in their life?", dimension: "people", answeredBy: ["PERSON"], when: [], weight: 1, enough: 1, after: [] },
    ]);
  });

  it("fills every ask's weight, enough and order from the engine's defaults", () => {
    const lens = fixtureLens();
    assert.equal(lens.objective, "Treat them well next time.");
    assert.deepEqual(
      lens.asks.map((a) => [a.id, a.weight, a.enough, a.after, a.dimension, a.answeredBy]),
      [
        ["what-they-love", 1, 1, [], null, ["LIKES", "SKILL"]],
        ["how-the-days-go", 1, 1, [], null, ["CIRCUMSTANCE"]],
      ],
    );
  });

  it("takes its own sections, pinned types, header and asks when it names them", () => {
    const lens = fixtureVisitLens();
    assert.deepEqual(lens.sections.map((s) => s.heading), ["Mind", "Know"]);
    assert.equal(sectionIndexOf(lens, "CIRCUMSTANCE"), 0);
    assert.equal(sectionIndexOf(lens, "SKILL"), 1);
    assert.equal(sectionIndexOf(lens, "RETIRED_TYPE"), 1, "a retired type reads as the fallback, wherever the fallback's dimension sits");
    assert.equal(isPinnedFactType(lens, "LINE"), true);
    assert.equal(isPinnedFactType(lens, "HAS"), false, "a lens names what it must honor");
    assert.equal(isPinnedFactType(fixtureLens(), "HAS"), true);
    assert.equal(briefHeader(lens, { name: "Linda", fields: { relationship: "mother" } }), "Before you visit Linda (mother):");
    const people = lens.asks.find((a) => a.id === "people")!;
    assert.deepEqual([people.question, people.answeredBy], ["Who is in their life?", ["PERSON"]], "an ask of a dimension borrows its question and hears its types");
    assert.deepEqual(lens.asks.find((a) => a.id === "what-they-love")!.after, ["how-the-days-go"]);
  });

  it("fills the header from the template and the vocabulary's prompt fields", () => {
    const lens = fixtureLens();
    assert.equal(briefHeader(lens, { name: "Linda", fields: { relationship: "mother", city: "Austin" } }), "What we know about Linda (mother):");
    assert.equal(briefHeader(lens, { name: "Linda", fields: { city: "Austin" } }), "What we know about Linda:");
  });
});

describe("Scenario: A lens whose own shape cannot be read is refused with every problem named", () => {
  const base = fixtureVisitLensDefinition();
  const asks = base.asks!;

  it("refuses a header without {who}", () => {
    assert.throws(() => parseLensDefinition({ ...base, header: "Before you visit:" }));
  });

  it("refuses an ask that names both a dimension and its types, or neither, and one answered by types with no question", () => {
    assert.throws(() => parseLensDefinition({ ...base, asks: [{ id: "x", dimension: "people", answeredBy: ["PERSON"], question: "?" }] }), /one, not both/);
    assert.throws(() => parseLensDefinition({ ...base, asks: [{ id: "x", question: "?" }] }), /one, not both and not neither/);
    assert.throws(() => parseLensDefinition({ ...base, asks: [{ id: "x", answeredBy: ["PERSON"] }] }), /must say what it asks/);
  });

  it("refuses an ask listed twice, a weight that is not positive, and an enough that is not a whole number of facts", () => {
    assert.throws(() => parseLensDefinition({ ...base, asks: [asks[2]!, asks[2]!] }), /ask people is listed twice/);
    assert.throws(() => parseLensDefinition({ ...base, asks: [{ ...asks[2]!, weight: 0 }] }));
    assert.throws(() => parseLensDefinition({ ...base, asks: [{ ...asks[2]!, weight: 1001 }] }), "a weight is relative, and at most 1,000");
    parseLensDefinition({ ...base, asks: [{ ...asks[2]!, weight: 1000 }] });
    assert.throws(() => parseLensDefinition({ ...base, asks: [{ ...asks[2]!, enough: 1.5 }] }));
  });

  it("refuses an ask that waits on itself, on an ask that is not there, twice on one, or in a circle", () => {
    assert.throws(() => parseLensDefinition({ ...base, asks: [{ ...asks[2]!, after: ["people"] }] }), /ask people waits on itself/);
    assert.throws(() => parseLensDefinition({ ...base, asks: [{ ...asks[2]!, after: ["ghost"] }] }), /waits on ghost, which is not an ask/);
    assert.throws(
      () => parseLensDefinition({ ...base, asks: [asks[0]!, { ...asks[1]!, after: ["how-the-days-go", "how-the-days-go"] }] }),
      /waits on how-the-days-go twice/,
    );
    assert.throws(
      () =>
        parseLensDefinition({
          ...base,
          asks: [{ ...asks[0]!, after: ["people"] }, asks[1]!, { ...asks[2]!, after: ["what-they-love"] }],
        }),
      /wait on each other in a circle/,
    );
  });

  it("refuses a dimension placed in two sections", () => {
    assert.throws(
      () => parseLensDefinition({ ...base, sections: [{ heading: "A", dimensions: ["life"] }, { heading: "B", dimensions: ["life", "has"] }] }),
      /dimension life is in two sections/,
    );
  });
});

describe("Scenario: A lens that does not read its vocabulary cleanly is refused at compile, every reference named", () => {
  const vocabulary = fixtureVocabulary();

  it("names every unresolved reference at once", () => {
    const problems = lensProblems(
      {
        ...minimal,
        vocabulary: "elsewhere",
        sections: [{ heading: "Only", dimensions: ["life", "limbo"] }],
        pinned: ["NOPE"],
        attributeTags: ["colour"],
        asks: [
          { id: "a", dimension: "ghost" },
          { id: "b", dimension: "life" },
          { id: "c", question: "?", answeredBy: ["NOPE"] },
          { id: "d", question: "?", answeredBy: ["LIKES"], when: [{ field: "age", equals: ["70"] }] },
        ],
      },
      vocabulary,
    );
    assert.deepEqual(problems, [
      "it reads vocabulary elsewhere, and was given fixture",
      "a section holds dimension limbo, which the vocabulary does not have",
      "dimension never-cross is in no section, so its facts would never be on the page",
      "dimension has is in no section, so its facts would never be on the page",
      "dimension likes is in no section, so its facts would never be on the page",
      "dimension people is in no section, so its facts would never be on the page",
      "dimension other is in no section, so its facts would never be on the page",
      "pinned names NOPE, which is not a fact type",
      "attributeTags names colour, which no type carries",
      "ask a asks about dimension ghost, which the vocabulary does not have",
      "ask b has no question, and dimension life has none to lend it",
      "ask c is answered by NOPE, which is not a fact type",
      "ask d applies when age matches, which is not one of the vocabulary's fields",
    ]);
  });

  it("throws from compileLens and lensFrom with the problems in the message", () => {
    assert.throws(() => compileLens({ ...minimal, pinned: ["NOPE"] }, vocabulary), /lens plain@1: pinned names NOPE/);
    assert.throws(() => lensFrom({ ...fixtureLensDefinition(), vocabulary: "other" }, vocabulary), /reads vocabulary other/);
    assert.deepEqual(lensProblems(fixtureLensDefinition(), vocabulary), []);
    assert.deepEqual(lensProblems(fixtureVisitLensDefinition(), vocabulary), []);
  });
});

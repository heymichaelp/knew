import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { briefHeader, compileLens, isPinnedFactType, lensFrom, lensProblems, parseLensDefinition, sectionIndexOf, type LensDefinition } from "../src/index.ts";
import { fixtureLens, fixtureLensDefinition, fixtureVisitLens, fixtureVisitLensDefinition, fixtureVocabulary } from "../src/testing.ts";

const minimal: LensDefinition = { id: "plain", version: 1, vocabulary: "fixture", header: "About {who}:", overHeading: "Over" };

describe("Scenario: A lens says only what differs, and the vocabulary supplies the rest", () => {
  it("reads every dimension as a need, labelled as the dimension is, and every one but the knower's as a section, with the vocabulary's pinned types", () => {
    const lens = compileLens(minimal, fixtureVocabulary());
    assert.deepEqual(
      lens.sections.map((s) => [s.heading, s.dimensions]),
      [
        ["Never cross", ["never-cross"]],
        ["Already has", ["has"]],
        ["Likes", ["likes"]],
        ["Life", ["life"]],
        ["People", ["people"]],
        ["Between you", ["between"]],
        ["Other", ["other"]],
      ],
      "the knower's dimension is read beside every entity, and printed only where a lens places it",
    );
    assert.deepEqual([...lens.pinned].sort(), ["HAS", "LINE"]);
    assert.equal(lens.objective, null);
    assert.deepEqual(
      lens.needs.map((n) => [n.id, n.label, n.dimension]),
      [
        ["never-cross", "Never cross", "never-cross"],
        ["has", "Already has", "has"],
        ["likes", "Likes", "likes"],
        ["life", "Life", "life"],
        ["people", "People", "people"],
        ["between", "Between you", "between"],
        ["means", "Your means", "means"],
        ["other", "Other", "other"],
      ],
    );
    assert.deepEqual(lens.needs.find((n) => n.id === "people"), { id: "people", label: "People", about: "entity", dimension: "people", types: ["PERSON"], when: [], weight: 1, enough: 1, after: [] });
    assert.deepEqual(
      lens.needs.filter((n) => n.about !== "entity").map((n) => [n.id, n.about]),
      [
        ["between", "relationship"],
        ["means", "knower"],
      ],
    );
  });

  it("fills every need's weight, enough and order from the engine's defaults", () => {
    const lens = fixtureLens();
    assert.equal(lens.objective, "Treat them well next time.");
    assert.deepEqual(
      lens.needs.map((a) => [a.id, a.weight, a.enough, a.after, a.dimension, a.types]),
      [
        ["what-they-love", 1, 1, [], null, ["LIKES", "SKILL"]],
        ["how-the-days-go", 1, 1, [], null, ["CIRCUMSTANCE"]],
      ],
    );
  });

  it("takes its own sections, pinned types, header and needs when it names them", () => {
    const lens = fixtureVisitLens();
    assert.deepEqual(lens.sections.map((s) => s.heading), ["Mind", "Know"]);
    assert.equal(sectionIndexOf(lens, "CIRCUMSTANCE"), 0);
    assert.equal(sectionIndexOf(lens, "SKILL"), 1);
    assert.equal(sectionIndexOf(lens, "RETIRED_TYPE"), 1, "a retired type reads as the fallback, wherever the fallback's dimension sits");
    assert.equal(isPinnedFactType(lens, "LINE"), true);
    assert.equal(isPinnedFactType(lens, "HAS"), false, "a lens names what it must honor");
    assert.equal(isPinnedFactType(fixtureLens(), "HAS"), true);
    assert.equal(briefHeader(lens, { name: "Linda", fields: { relationship: "mother" } }), "Before you visit Linda (mother):");
    const people = lens.needs.find((a) => a.id === "people")!;
    assert.deepEqual([people.label, people.types], ["People", ["PERSON"]], "a need of a dimension borrows its label and counts its types");
    assert.deepEqual(lens.needs.find((a) => a.id === "what-they-love")!.after, ["how-the-days-go"]);
  });

  it("fills the header from the template and the vocabulary's prompt fields", () => {
    const lens = fixtureLens();
    assert.equal(briefHeader(lens, { name: "Linda", fields: { relationship: "mother", city: "Austin" } }), "What we know about Linda (mother):");
    assert.equal(briefHeader(lens, { name: "Linda", fields: { city: "Austin" } }), "What we know about Linda:");
  });
});

describe("Scenario: A lens whose own shape cannot be read is refused with every problem named", () => {
  const base = fixtureVisitLensDefinition();
  const needs = base.needs!;

  it("refuses a header without {who}", () => {
    assert.throws(() => parseLensDefinition({ ...base, header: "Before you visit:" }));
  });

  it("refuses a need that names both a dimension and its types, or neither, and one naming types with no label", () => {
    assert.throws(() => parseLensDefinition({ ...base, needs: [{ id: "x", dimension: "people", types: ["PERSON"], label: "?" }] }), /one, not both/);
    assert.throws(() => parseLensDefinition({ ...base, needs: [{ id: "x", label: "?" }] }), /one, not both and not neither/);
    assert.throws(() => parseLensDefinition({ ...base, needs: [{ id: "x", types: ["PERSON"] }] }), /must have a label/);
  });

  it("refuses a need listed twice, a weight that is not positive, and an enough that is not a whole number of facts", () => {
    assert.throws(() => parseLensDefinition({ ...base, needs: [needs[2]!, needs[2]!] }), /need people is listed twice/);
    assert.throws(() => parseLensDefinition({ ...base, needs: [{ ...needs[2]!, weight: 0 }] }));
    assert.throws(() => parseLensDefinition({ ...base, needs: [{ ...needs[2]!, weight: 1001 }] }), "a weight is relative, and at most 1,000");
    parseLensDefinition({ ...base, needs: [{ ...needs[2]!, weight: 1000 }] });
    assert.throws(() => parseLensDefinition({ ...base, needs: [{ ...needs[2]!, enough: 1.5 }] }));
  });

  it("refuses a need that waits on itself, on a need that is not there, twice on one, or in a circle", () => {
    assert.throws(() => parseLensDefinition({ ...base, needs: [{ ...needs[2]!, after: ["people"] }] }), /need people waits on itself/);
    assert.throws(() => parseLensDefinition({ ...base, needs: [{ ...needs[2]!, after: ["ghost"] }] }), /waits on ghost, which is not a need/);
    assert.throws(
      () => parseLensDefinition({ ...base, needs: [needs[0]!, { ...needs[1]!, after: ["how-the-days-go", "how-the-days-go"] }] }),
      /waits on how-the-days-go twice/,
    );
    assert.throws(
      () =>
        parseLensDefinition({
          ...base,
          needs: [{ ...needs[0]!, after: ["people"] }, needs[1]!, { ...needs[2]!, after: ["what-they-love"] }],
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
        needs: [
          { id: "a", dimension: "ghost" },
          { id: "c", label: "?", types: ["NOPE"] },
          { id: "d", label: "?", types: ["LIKES"], when: [{ field: "age", equals: ["70"] }] },
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
      "dimension between is in no section, so its facts would never be on the page",
      "dimension other is in no section, so its facts would never be on the page",
      "pinned names NOPE, which is not a fact type",
      "attributeTags names colour, which no type carries",
      "need a names dimension ghost, which the vocabulary does not have",
      "need c counts NOPE, which is not a fact type",
      "need d applies when age matches, which is not one of the vocabulary's fields",
    ]);
  });

  it("throws from compileLens and lensFrom with the problems in the message", () => {
    assert.throws(() => compileLens({ ...minimal, pinned: ["NOPE"] }, vocabulary), /lens plain@1: pinned names NOPE/);
    assert.throws(() => lensFrom({ ...fixtureLensDefinition(), vocabulary: "other" }, vocabulary), /reads vocabulary other/);
    assert.deepEqual(lensProblems(fixtureLensDefinition(), vocabulary), []);
    assert.deepEqual(lensProblems(fixtureVisitLensDefinition(), vocabulary), []);
  });
});

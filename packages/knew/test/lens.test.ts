import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  briefHeader,
  compiledSchemaProblems,
  compileLens,
  DEFAULT_PROMPT_REFS,
  factTypeGlossary,
  factTypeVocabulary,
  lensFrom,
  extractSchemaFor,
  reconcileSchema,
  parseFactAttributes,
  parseLensDefinition,
  systemExtra,
} from "../src/index.ts";
import { fixtureLens, fixtureLensDefinition } from "../src/testing.ts";

describe("Scenario: A lens is data a client registers, and the engine reads it", () => {
  it("compiles a valid definition and reads its types in order", () => {
    const lens = fixtureLens();
    assert.deepEqual(lens.factTypeKeys, ["LINE", "HAS", "SKILL", "LIKES", "EVENT", "CIRCUMSTANCE", "PERSON", "OTHER"]);
    assert.equal(lens.factTypes.LINE!.pinned, true);
    assert.equal(lens.factTypes.LINE!.enduring, true);
    assert.equal(lens.factTypes.LIKES!.pinned, false);
    assert.deepEqual(lens.extractAttributes.map((f) => f.name), ["level", "kind"]);
    assert.deepEqual(lens.entityKinds, ["person"]);
  });

  it("renders the vocabulary the prompt reads: one line per type, attributes named", () => {
    const vocabulary = factTypeVocabulary(fixtureLens());
    assert.equal(vocabulary.split("\n").length, 8);
    assert.ok(vocabulary.includes("- SKILL: A pursuit with a depth claim. Attributes: level."));
    assert.ok(vocabulary.includes("- LIKES: An interest, with no claim about depth.\n"));
  });

  it("uses the engine's default prompts unless the lens brings its own", () => {
    const stock = fixtureLens();
    assert.equal(stock.prompts.extract.ref, DEFAULT_PROMPT_REFS.extract);
    assert.ok(stock.prompts.extract.text.startsWith("# Task: Remember what was just said"));
    const own = compileLens({ ...fixtureLensDefinition(), prompts: { extract: "My own extract prompt." } });
    assert.equal(own.prompts.extract.ref, "lens:fixture@1:extract");
    assert.equal(own.prompts.extract.text, "My own extract prompt.");
    assert.equal(own.prompts.reconcile.ref, DEFAULT_PROMPT_REFS.reconcile);
  });

  it("carries the charter and the vocabulary as system context", () => {
    const extra = systemExtra(fixtureLens());
    assert.equal(extra.length, 2);
    assert.ok(extra[0]!.startsWith("# Charter"));
    assert.ok(extra[1]!.startsWith("## Fact types\n\n- LINE:"));
  });

  it("fills the brief header from the template and the prompt fields", () => {
    const lens = fixtureLens();
    assert.equal(briefHeader(lens, { name: "Linda", fields: { relationship: "mother", city: "Austin" } }), "What we know about Linda (mother):");
    assert.equal(briefHeader(lens, { name: "Linda", fields: { city: "Austin" } }), "What we know about Linda:");
  });

  it("keeps a type's own attributes and drops the rest", () => {
    const lens = fixtureLens();
    assert.deepEqual(parseFactAttributes(lens, "SKILL", { level: "expert", kind: "moved" }), { level: "expert" });
    assert.deepEqual(parseFactAttributes(lens, "SKILL", { level: "wizard" }), {});
    assert.deepEqual(parseFactAttributes(lens, "NOT_A_TYPE", { level: "expert" }), {});
  });

  it("describes itself for a screen", () => {
    const glossary = factTypeGlossary(fixtureLens());
    assert.deepEqual(glossary.SKILL, {
      description: "A pursuit with a depth claim.",
      section: "Already has",
      pinned: false,
      enduring: true,
      attributes: [{ name: "level", values: ["beginner", "serious", "expert"] }],
    });
  });
});

describe("Scenario: A definition that cannot be read is refused with every problem named", () => {
  const base = fixtureLensDefinition();

  it("refuses a fallback type that is not a type", () => {
    assert.throws(() => parseLensDefinition({ ...base, fallbackType: "NOPE" }), /fallbackType NOPE/);
  });

  it("refuses a type in a section the brief has no heading for", () => {
    assert.throws(
      () => parseLensDefinition({ ...base, factTypes: { ...base.factTypes, LOST: { description: "x", section: "limbo" } } }),
      /LOST sits in section limbo/,
    );
  });

  it("refuses a prompt field that is not a routing field, and a tag no type carries", () => {
    assert.throws(() => parseLensDefinition({ ...base, promptFields: ["age"] }), /promptFields names age/);
    assert.throws(() => parseLensDefinition({ ...base, briefAttributeTags: ["colour"] }), /briefAttributeTags names colour/);
  });

  it("refuses an enum without values and a header without {who}", () => {
    assert.throws(() =>
      parseLensDefinition({
        ...base,
        factTypes: { ...base.factTypes, BAD: { description: "x", section: "other", attributes: [{ name: "k", kind: "enum" }] } },
      }),
    );
    assert.throws(() => parseLensDefinition({ ...base, briefHeader: "What we know:" }));
  });

  it("accepts the smallest possible lens: one type, one section, no routing fields", () => {
    const lens = lensFrom({
      id: "tiny",
      version: 1,
      factTypes: { NOTE: { description: "Anything.", section: "all" } },
      briefSections: [{ section: "all", heading: "Everything" }],
      briefHeader: "About {who}:",
      overHeading: "Over",
      fallbackType: "NOTE",
      routingFields: [],
      charter: "Keep everything.",
    });
    assert.deepEqual(lens.promptFields, []);
    assert.equal(briefHeader(lens, { name: "Al", fields: {} }), "About Al:");
  });
});

describe("Scenario: The model is never sent a schema a structured-output endpoint refuses", () => {
  it("compiles every schema without the refused keywords, for a lens with and without routing fields", () => {
    assert.deepEqual(compiledSchemaProblems(extractSchemaFor(fixtureLens())), []);
    assert.deepEqual(compiledSchemaProblems(reconcileSchema), []);
    const noRouting = compileLens({ ...fixtureLensDefinition(), routingFields: [], promptFields: [] });
    assert.deepEqual(compiledSchemaProblems(extractSchemaFor(noRouting)), []);
  });

  it("spells every attribute any type carries as a nullable key, in the lens's order", () => {
    const definition = { ...fixtureLensDefinition(), extractAttributeKeys: ["kind", "level"] };
    const schema = extractSchemaFor(compileLens(definition));
    const parsed = schema.parse({
      facts: [{ personId: "p", type: "SKILL", fact: "Throws pots", attributes: { kind: null, level: "serious" }, validAt: null, invalidAt: null }],
      aliases: [],
      unresolvedNames: [],
      fieldUpdates: [{ personId: "p", field: "city", value: "Lisbon" }],
    });
    assert.deepEqual(Object.keys(parsed.facts[0]!.attributes!), ["kind", "level"]);
    assert.throws(() => schema.parse({ facts: [], aliases: [], unresolvedNames: [], fieldUpdates: [{ personId: "p", field: "age", value: "70" }] }));
  });
});

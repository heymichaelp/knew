import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compiledSchemaProblems,
  compileVocabulary,
  DEFAULT_PROMPT_REFS,
  extractSchemaFor,
  factTypeGlossary,
  factTypeVocabulary,
  parseFactAttributes,
  parseVocabularyDefinition,
  reconcileSchema,
  systemExtra,
  vocabularyFrom,
  whoLabel,
} from "../src/index.ts";
import { fixtureVocabulary, fixtureVocabularyDefinition } from "../src/testing.ts";

describe("Scenario: A vocabulary is data a client registers, and extraction writes in it", () => {
  it("compiles a valid definition and reads its types and dimensions in order", () => {
    const vocabulary = fixtureVocabulary();
    assert.equal(vocabulary.kind, "person");
    assert.deepEqual(vocabulary.factTypeKeys, ["LINE", "HAS", "SKILL", "LIKES", "EVENT", "CIRCUMSTANCE", "PERSON", "HISTORY", "MEANS", "OTHER"]);
    assert.deepEqual(
      vocabulary.dimensions.map((d) => [d.id, d.label, d.about]),
      [
        ["never-cross", "Never cross", "entity"],
        ["has", "Already has", "entity"],
        ["likes", "Likes", "entity"],
        ["life", "Life", "entity"],
        ["people", "People", "entity"],
        ["between", "Between you", "relationship"],
        ["means", "Your means", "knower"],
        ["other", "Other", "entity"],
      ],
      "a dimension is about the entity unless it says otherwise",
    );
    assert.equal(vocabulary.factTypes.LINE!.pinned, true);
    assert.equal(vocabulary.factTypes.LINE!.enduring, true);
    assert.equal(vocabulary.factTypes.CIRCUMSTANCE!.revisitAfterDays, 90);
    assert.equal(vocabulary.factTypes.LIKES!.revisitAfterDays, null, "a type that names no window is never due");
    assert.deepEqual(vocabulary.extractAttributes.map((f) => f.name), ["level", "kind"]);
  });

  it("renders the type list the prompt reads: one line per type, attributes named, and where a fact about the relationship or the knower attaches", () => {
    const list = factTypeVocabulary(fixtureVocabulary());
    assert.equal(list.split("\n").length, 10);
    assert.ok(list.includes("- HISTORY: How the knower and they know each other. (About the relationship between the writer and an entry: attach it to that entry.)"));
    assert.ok(list.includes("- MEANS: What the knower can spend or give. (About the writer: attach it to self.)"));
    assert.ok(list.includes("- SKILL: A pursuit with a depth claim. Attributes: level."));
    assert.ok(list.includes("- LIKES: An interest, with no claim about depth.\n"));
  });

  it("uses the engine's default prompts unless the vocabulary brings its own", () => {
    const stock = fixtureVocabulary();
    assert.equal(stock.prompts.extract.ref, DEFAULT_PROMPT_REFS.extract);
    assert.equal(stock.prompts.reconcile.ref, DEFAULT_PROMPT_REFS.reconcile);
    const own = compileVocabulary({ ...fixtureVocabularyDefinition(), prompts: { extract: "My own extract prompt." } });
    assert.equal(own.prompts.extract.ref, "vocabulary:fixture@1:extract");
    assert.equal(own.prompts.extract.text, "My own extract prompt.");
    assert.equal(own.prompts.reconcile.ref, DEFAULT_PROMPT_REFS.reconcile);
  });

  it("carries the charter and the type list as system context", () => {
    const extra = systemExtra(fixtureVocabulary());
    assert.equal(extra.length, 2);
    assert.ok(extra[0]!.startsWith("# Charter"));
    assert.ok(extra[1]!.startsWith("## Fact types\n\n- LINE:"));
  });

  it("names an entity with its prompt fields", () => {
    const vocabulary = fixtureVocabulary();
    assert.equal(whoLabel(vocabulary, { name: "Linda", fields: { relationship: "mother", city: "Austin" } }), "Linda (mother)");
    assert.equal(whoLabel(vocabulary, { name: "Linda", fields: { city: "Austin" } }), "Linda");
  });

  it("keeps a type's own attributes and drops the rest", () => {
    const vocabulary = fixtureVocabulary();
    assert.deepEqual(parseFactAttributes(vocabulary, "SKILL", { level: "expert", kind: "moved" }), { level: "expert" });
    assert.deepEqual(parseFactAttributes(vocabulary, "SKILL", { level: "wizard" }), {});
    assert.deepEqual(parseFactAttributes(vocabulary, "NOT_A_TYPE", { level: "expert" }), {});
  });

  it("describes each type for a screen: its dimension, its flags, its revisit window", () => {
    const glossary = factTypeGlossary(fixtureVocabulary());
    assert.deepEqual(glossary.SKILL, {
      description: "A pursuit with a depth claim.",
      dimension: { id: "has", label: "Already has", about: "entity" },
      pinned: false,
      enduring: true,
      revisitAfterDays: null,
      attributes: [{ name: "level", values: ["beginner", "serious", "expert"] }],
    });
    assert.equal(glossary.CIRCUMSTANCE!.revisitAfterDays, 90);
  });
});

describe("Scenario: A vocabulary that cannot be read is refused with every problem named", () => {
  const base = fixtureVocabularyDefinition();

  it("refuses a fallback type that is not a type", () => {
    assert.throws(() => parseVocabularyDefinition({ ...base, fallbackType: "NOPE" }), /fallbackType NOPE/);
  });

  it("refuses a type that informs a dimension the vocabulary does not have, and a dimension nothing informs", () => {
    assert.throws(
      () => parseVocabularyDefinition({ ...base, factTypes: { ...base.factTypes, LOST: { description: "x", dimension: "limbo" } } }),
      /LOST informs dimension limbo/,
    );
    assert.throws(
      () => parseVocabularyDefinition({ ...base, dimensions: { ...base.dimensions, empty: { label: "Empty" } } }),
      /dimension empty has no fact types/,
    );
  });

  it("refuses a revisit window on an enduring type: time never makes it false", () => {
    assert.throws(
      () => parseVocabularyDefinition({ ...base, factTypes: { ...base.factTypes, LINE: { ...base.factTypes.LINE!, revisitAfterDays: 30 } } }),
      /LINE is enduring/,
    );
    assert.throws(
      () => parseVocabularyDefinition({ ...base, factTypes: { ...base.factTypes, LIKES: { ...base.factTypes.LIKES!, revisitAfterDays: 0 } } }),
      "a window is a whole number of days, at least one",
    );
  });

  it("refuses a prompt field that is not a field, and an attribute key no type carries", () => {
    assert.throws(() => parseVocabularyDefinition({ ...base, promptFields: ["age"] }), /promptFields names age/);
    assert.throws(() => parseVocabularyDefinition({ ...base, extractAttributeKeys: ["colour"] }), /extractAttributeKeys names colour/);
  });

  it("refuses an enum without values, a kind that is not a name, and a type key that is not a type key", () => {
    assert.throws(() =>
      parseVocabularyDefinition({
        ...base,
        factTypes: { ...base.factTypes, BAD: { description: "x", dimension: "other", attributes: [{ name: "k", kind: "enum" }] } },
      }),
    );
    assert.throws(() => parseVocabularyDefinition({ ...base, kind: "A Person" }));
    assert.throws(() => parseVocabularyDefinition({ ...base, factTypes: { ...base.factTypes, lowercase: { description: "x", dimension: "other" } } }));
  });

  it("accepts the smallest possible vocabulary: one type, one dimension, no fields", () => {
    const vocabulary = vocabularyFrom({
      id: "tiny",
      version: 1,
      kind: "thing",
      factTypes: { NOTE: { description: "Anything.", dimension: "all" } },
      dimensions: { all: { label: "Everything" } },
      fallbackType: "NOTE",
      fields: [],
      charter: "Keep everything.",
    });
    assert.deepEqual(vocabulary.promptFields, []);
    assert.equal(whoLabel(vocabulary, { name: "The red bike", fields: {} }), "The red bike");
  });
});

describe("Scenario: The model is never sent a schema a structured-output endpoint refuses", () => {
  it("compiles every schema without the refused keywords, for a vocabulary with and without fields", () => {
    assert.deepEqual(compiledSchemaProblems(extractSchemaFor(fixtureVocabulary())), []);
    assert.deepEqual(compiledSchemaProblems(reconcileSchema), []);
    const noFields = compileVocabulary({ ...fixtureVocabularyDefinition(), fields: [], promptFields: [] });
    assert.deepEqual(compiledSchemaProblems(extractSchemaFor(noFields)), []);
  });

  it("spells every attribute any type carries as a nullable key, in the vocabulary's order, and names entities by id", () => {
    const definition = { ...fixtureVocabularyDefinition(), extractAttributeKeys: ["kind", "level"] };
    const schema = extractSchemaFor(compileVocabulary(definition));
    const parsed = schema.parse({
      facts: [{ entityId: "p", type: "SKILL", fact: "Throws pots", attributes: { kind: null, level: "serious" }, validAt: null, invalidAt: null }],
      aliases: [],
      unresolvedNames: [],
      fieldUpdates: [{ entityId: "p", field: "city", value: "Lisbon" }],
    });
    assert.deepEqual(Object.keys(parsed.facts[0]!.attributes!), ["kind", "level"]);
    assert.throws(() => schema.parse({ facts: [], aliases: [], unresolvedNames: [], fieldUpdates: [{ entityId: "p", field: "age", value: "70" }] }));
  });
});

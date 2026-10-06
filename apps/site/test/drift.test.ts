/**
 * The guards that keep knew.dev from describing an engine that does not exist.
 * Each one fails the build rather than relying on anyone remembering.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ENGINE_DEFAULTS } from "@popjoker/knew";
import * as presets from "@popjoker/knew/presets";

import {
  clientMethods,
  contractCaseSummaries,
  engineDefaults,
  lensFields,
  lensNestedFields,
  presetOutlines,
  vocabularyFields,
  vocabularyNestedFields,
  type DefinitionField,
} from "../lib/engine";
import { DOCUMENTED_METHODS } from "../lib/api-routes";
import { DEFAULT_NOTES } from "../lib/default-notes";
import { LENS_FIELD_NOTES, LENS_NESTED_NOTES } from "../lib/lens-notes";
import { VOCABULARY_FIELD_NOTES, VOCABULARY_NESTED_NOTES } from "../lib/vocabulary-notes";
import { headingsOf, packageManifest, presetExtensionExample, readShipped } from "../lib/package-docs";

function explainsExactly(fields: DefinitionField[], notes: Record<string, string>, what: string) {
  assert.deepEqual(Object.keys(notes).sort(), fields.map((f) => f.name).sort(), `${what} must have exactly one note per schema field`);
  for (const field of fields) {
    assert.ok(field.type && field.type !== "unknown", `${what}: ${field.name} has no readable type`);
    assert.ok(notes[field.name]?.trim(), `${what}: ${field.name} has no note`);
  }
}

describe("the definitions pages cannot fall behind the schemas", () => {
  it("explains every vocabulary field the schema defines, and invents none", () => {
    explainsExactly(vocabularyFields(), VOCABULARY_FIELD_NOTES, "VOCABULARY_FIELD_NOTES");
  });

  it("explains every lens field the schema defines, and invents none", () => {
    explainsExactly(lensFields(), LENS_FIELD_NOTES, "LENS_FIELD_NOTES");
  });

  it("explains every field inside a fact type, a dimension, an ask and a section", () => {
    const vocabulary = vocabularyNestedFields();
    const lens = lensNestedFields();
    assert.deepEqual(Object.keys(VOCABULARY_NESTED_NOTES).sort(), Object.keys(vocabulary).sort(), "VOCABULARY_NESTED_NOTES must have a block per nested field");
    assert.deepEqual(Object.keys(LENS_NESTED_NOTES).sort(), Object.keys(lens).sort(), "LENS_NESTED_NOTES must have a block per nested field");
    for (const [path, fields] of Object.entries(vocabulary)) explainsExactly(fields, VOCABULARY_NESTED_NOTES[path]!, `VOCABULARY_NESTED_NOTES["${path}"]`);
    for (const [path, fields] of Object.entries(lens)) explainsExactly(fields, LENS_NESTED_NOTES[path]!, `LENS_NESTED_NOTES["${path}"]`);
  });
});

describe("the defaults table cannot fall behind the engine", () => {
  it("explains every default the engine ships, and invents none", () => {
    assert.deepEqual(Object.keys(DEFAULT_NOTES).sort(), Object.keys(ENGINE_DEFAULTS).sort());
    assert.deepEqual(engineDefaults().map((d) => d.name).sort(), Object.keys(ENGINE_DEFAULTS).sort());
    for (const item of engineDefaults()) assert.ok(DEFAULT_NOTES[item.name].trim(), `${item.name} has no note`);
  });
});

describe("the presets page is the presets", () => {
  it("outlines every preset the package exports", () => {
    assert.deepEqual(presetOutlines().map((outline) => outline.name), Object.keys(presets));
  });

  it("files every type of each under the dimension it informs, and loses none", () => {
    for (const { name, vocabulary, dimensions } of presetOutlines()) {
      assert.deepEqual(dimensions.map((dimension) => dimension.id), vocabulary.dimensions.map((dimension) => dimension.id), `${name}: the dimensions, in order`);
      const filed = dimensions.flatMap((dimension) => dimension.types.map((type) => ({ key: type.key, under: dimension.id })));
      assert.deepEqual(filed.map((type) => type.key).sort(), [...vocabulary.factTypeKeys].sort(), `${name}: every type, once`);
      for (const type of filed) assert.equal(type.under, vocabulary.factTypes[type.key]!.dimension, `${name}: ${type.key}`);
    }
  });

  it("quotes the guide's own example of extending one, and links to where it sits", () => {
    const { code, section } = presetExtensionExample();
    assert.match(code, /extendVocabulary\(/);
    assert.ok(headingsOf(readShipped("ADOPTING.md")).some((heading) => heading.id === section.id && heading.level === 2));
  });
});

describe("the API page cannot fall behind the client", () => {
  it("documents a route for every method the client exposes", () => {
    const undocumented = clientMethods().filter((m) => !DOCUMENTED_METHODS.includes(m));
    assert.deepEqual(undocumented, [], "every client method needs a row in ROUTE_GROUPS");
  });

  it("does not document methods the client does not have", () => {
    const methods = clientMethods();
    const invented = DOCUMENTED_METHODS.filter((m) => !methods.includes(m));
    assert.deepEqual(invented, [], "ROUTE_GROUPS names a client method that no longer exists");
  });

  it("names each route's timeout budget exactly once per client method", () => {
    assert.equal(new Set(DOCUMENTED_METHODS).size, DOCUMENTED_METHODS.length, "a client method is documented twice");
  });
});

describe("the contract page is the suite", () => {
  it("reads its cases from contractCases(), scripted flags intact", () => {
    const cases = contractCaseSummaries();
    assert.ok(cases.length > 0, "the contract suite is empty");
    for (const c of cases) {
      assert.ok(c.name.trim(), "a contract case has no name");
      assert.equal(typeof c.scripted, "boolean");
    }
  });
});

describe("the long-form pages come from the tarball", () => {
  it("reads the package's own docs, at the version the site will publish", () => {
    assert.match(packageManifest.version, /^\d+\.\d+\.\d+/);
    assert.equal(packageManifest.license, "MIT");
    for (const file of ["README.md", "ADOPTING.md", "CHANGELOG.md"] as const) {
      assert.ok(readShipped(file).trim().length > 0, `${file} is empty`);
    }
  });

  it("finds headings to build a contents list from", () => {
    assert.ok(headingsOf(readShipped("ADOPTING.md")).length >= 5);
    assert.ok(headingsOf(readShipped("CHANGELOG.md")).length >= 1);
  });
});

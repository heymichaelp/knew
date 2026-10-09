/**
 * The sandbox's examples are written against the presets. A preset change that
 * leaves one behind — a type renamed, a dimension dropped — fails here rather
 * than on the page.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { compileLens, compileVocabulary } from "@popjoker/knew";
import * as presets from "@popjoker/knew/presets";

import { EXAMPLES, exampleFor, type PresetName } from "../lib/sandbox-examples";

describe("the sandbox's examples stay in step with the presets", () => {
  for (const example of EXAMPLES) {
    it(`${example.id}: its lens compiles against its vocabulary, and every fact is of one of its types`, () => {
      const vocabulary = compileVocabulary(example.vocabulary);
      compileLens(example.lens, vocabulary);
      for (const fact of example.facts) {
        assert.ok(fact.type in vocabulary.factTypes, `${fact.id} is of type ${fact.type}, which ${vocabulary.id} does not have`);
        for (const [name, value] of Object.entries(fact.attributes)) {
          const attribute = vocabulary.definition.factTypes[fact.type]!.attributes?.find((a) => a.name === name);
          assert.ok(attribute, `${fact.id} sets ${name}, which ${fact.type} does not carry`);
          if (attribute.kind === "enum") assert.ok(attribute.values!.includes(value), `${fact.id} sets ${name} to ${value}`);
        }
      }
    });
  }

  it("has a starting point for every preset", () => {
    for (const preset of Object.keys(presets) as PresetName[]) assert.equal(exampleFor(preset).preset, preset);
  });
});

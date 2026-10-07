import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compileLens, compileVocabulary, parseLensDefinition, parseVocabularyDefinition } from "@popjoker/knew";
import { person } from "@popjoker/knew/presets";
import { extracted, extraction, fakeIntelligence } from "@popjoker/knew/testing";
import giftDefinition from "../definitions/lenses/gift.json" with { type: "json" };
import vocabularyDefinition from "../definitions/vocabulary.json" with { type: "json" };
import { createApp } from "../src/app.ts";

const definition = parseVocabularyDefinition(vocabularyDefinition);
const gift = compileLens(parseLensDefinition(giftDefinition), compileVocabulary(definition));
const scope = { clientId: "thoughtful", subjectId: "ana" };

function thoughtful() {
  const engine = fakeIntelligence({ lenses: [gift] });
  return { engine, app: createApp(engine) };
}

describe("Thoughtful on knew", () => {
  it("starts from the person preset and changes none of its types", () => {
    assert.equal(definition.basedOn?.preset, "person");
    assert.deepEqual(definition.basedOn?.changed, []);
    for (const [key, spec] of Object.entries(person.vocabulary().factTypes)) assert.deepEqual(definition.factTypes[key], spec, key);
  });

  it("asks first about someone new, and has nothing for someone never added", async () => {
    const { app } = thoughtful();
    assert.equal(await app.firstMove("ana", "dad"), null);
    await app.addPerson("ana", { id: "dad", name: "Dad" });
    assert.deepEqual(await app.firstMove("ana", "dad"), { move: "ask-first", about: "What they love or want" });
  });

  it("shows picks once five things are known about what they love or want, and not at four", async () => {
    const { engine, app } = thoughtful();
    await app.addPerson("ana", { id: "dad", name: "Dad" });
    const notes = [
      ["INTEREST", "Bakes sourdough every weekend"],
      ["TASTE", "Loves dark, bitter chocolate"],
      ["WISH", "Wants a proper bread lame"],
      ["TASTE", "Hates anything with a logo on it"],
      ["INTEREST", "Started cycling to work"],
    ] as const;
    for (const [index, [type, text]] of notes.entries()) {
      engine.script({ extraction: extraction([extracted("dad", type, text)]) });
      await app.addNote("ana", "dad", text);
      assert.equal((await app.firstMove("ana", "dad"))?.move, index < 4 ? "ask-first" : "show-first", `after ${index + 1} notes`);
    }
  });

  it("hands the picks model knew's page, and what it must honor as rules", async () => {
    const { engine, app } = thoughtful();
    await app.addPerson("ana", { id: "mia", name: "Mia" });
    engine.seedFacts(scope, "mia", [
      { type: "AVOID", fact: "No alcohol, ever" },
      { type: "HAS", fact: "Owns every Studio Ghibli film" },
      { type: "INTEREST", fact: "Collects enamel pins" },
      { type: "INTEREST", fact: "Into bouldering" },
      { type: "TASTE", fact: "Loves anything matcha" },
      { type: "TASTE", fact: "Reads Le Guin" },
      { type: "WISH", fact: "Wants a film camera" },
    ]);
    const move = await app.firstMove("ana", "mia");
    assert.ok(move?.move === "show-first");
    assert.equal(move.page, (await engine.brief(scope, "mia", { lens: "gift" }))?.text);
    assert.deepEqual([...move.honor].sort(), ["No alcohol, ever", "Owns every Studio Ghibli film"]);
  });
});

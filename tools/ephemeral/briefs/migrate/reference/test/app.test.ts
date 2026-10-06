import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compileLens, compileVocabulary, parseLensDefinition, parseVocabularyDefinition } from "@popjoker/knew";
import { extracted, extraction, fakeIntelligence } from "@popjoker/knew/testing";
import regularsDefinition from "../definitions/lenses/regulars.json" with { type: "json" };
import vocabularyDefinition from "../definitions/vocabulary.json" with { type: "json" };
import { createApp } from "../src/app.ts";

const vocabulary = compileVocabulary(parseVocabularyDefinition(vocabularyDefinition));
const regulars = compileLens(parseLensDefinition(regularsDefinition), vocabulary);

function stems() {
  const engine = fakeIntelligence({ lenses: [regulars] });
  return { engine, app: createApp(engine) };
}

describe("Stems on knew 1.0", () => {
  it("shows no card for a customer nobody has noted anything about", async () => {
    const { app } = stems();
    await app.addCustomer("east", { id: "ruth", name: "Ruth Alder", tier: "regular" });
    assert.equal(await app.card("east", "ruth"), null);
  });

  it("reads a note before addNote resolves, and puts what must be honored on the card", async () => {
    const { engine, app } = stems();
    await app.addCustomer("east", { id: "ruth", name: "Ruth Alder", tier: "regular" });
    engine.script({ extraction: extraction([extracted("ruth", "ALLERGY", "Lilies: the cat is poisoned by them")]) });
    await app.addNote("east", "ruth", "No lilies ever, because of the cat.");
    const card = await app.card("east", "ruth");
    assert.deepEqual(card?.mustHonor, ["Lilies: the cat is poisoned by them"]);
    assert.match(card?.page ?? "", /^Before you take an order from Ruth Alder \(regular\):\n\nAbout Ruth Alder\.\n\nNever send:\n- Lilies: the cat is poisoned by them/);
    assert.equal(card?.ask, "What do they love to get?");
  });

  it("asks a wholesale customer about their standing order, and a regular not", async () => {
    const { engine, app } = stems();
    await app.addCustomer("west", { id: "bloom", name: "Bloom & Co", tier: "Wholesale" });
    await app.addCustomer("west", { id: "ana", name: "Ana", tier: "regular" });
    for (const id of ["bloom", "ana"]) {
      engine.script({
        extraction: extraction([
          extracted(id, "FAVORITE", "Eucalyptus by the armful"),
          extracted(id, "OCCASION", "Opening day on 3 May", { attributes: { month: "may" } }),
        ]),
      });
      await app.addNote("west", id, "Loves eucalyptus; celebrates opening day on 3 May.");
    }
    assert.equal((await app.card("west", "bloom"))?.ask, "How often do they reorder, and how much do they spend?");
    assert.equal((await app.card("west", "ana"))?.ask, "Who do they usually send to?");
  });

  it("keeps each shop's customers to that shop", async () => {
    const { engine, app } = stems();
    await app.addCustomer("east", { id: "ruth", name: "Ruth Alder" });
    engine.script({ extraction: extraction([extracted("ruth", "FAVORITE", "Garden roses")]) });
    await app.addNote("east", "ruth", "Loves garden roses.");
    assert.equal(await app.card("west", "ruth"), null);
  });
});

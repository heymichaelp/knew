import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compileLens, compileVocabulary, parseLensDefinition, parseVocabularyDefinition } from "@popjoker/knew";
import { extracted, extraction, fakeIntelligence } from "@popjoker/knew/testing";
import visitDefinition from "../definitions/lenses/visit.json" with { type: "json" };
import vocabularyDefinition from "../definitions/vocabulary.json" with { type: "json" };
import { createApp } from "../src/app.ts";

const visit = compileLens(parseLensDefinition(visitDefinition), compileVocabulary(parseVocabularyDefinition(vocabularyDefinition)));
const DAY_MS = 86_400_000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS);

function haunts() {
  const engine = fakeIntelligence({ lenses: [visit] });
  return { engine, app: createApp(engine) };
}

describe("Haunts on knew", () => {
  it("starts with what kind of place it is, and knows nothing of a place never added", async () => {
    const { app } = haunts();
    assert.equal(await app.known("ana", "luna"), null);
    await app.addPlace("ana", { id: "luna", name: "Café Luna" });
    assert.deepEqual(await app.nextToLearn("ana", "luna"), { about: "What kind of place it is", recheck: [] });
  });

  it("keeps a correction's history, and asks to re-check hours gone quiet", async () => {
    const { engine, app } = haunts();
    await app.addPlace("ana", { id: "nine", name: "Bar Nine" });
    engine.script({ extraction: extraction([extracted("nine", "HOURS", "Open 8 to 6")]) });
    await app.addNote("ana", "nine", "Open eight till six.", { at: daysAgo(60) });
    engine.script({
      extraction: extraction([extracted("nine", "HOURS", "Opens at 10 now"), extracted("nine", "KIND", "A bar"), extracted("nine", "VIBE", "Loud"), extracted("nine", "ORDER", "Negroni")]),
      reconcile: ({ current }) => ({ decisions: [{ newIndex: 0, action: "supersede", factId: current[0]!.id, invalidAt: null }], summary: "A bar." }),
    });
    await app.addNote("ana", "nine", "Opens at ten now. A loud bar; get the negroni.", { at: daysAgo(40) });
    assert.deepEqual((await app.known("ana", "nine"))?.sort(), ["A bar", "Loud", "Negroni", "Opens at 10 now"]);
    assert.deepEqual(await app.known("ana", "nine", { asOf: daysAgo(50) }), ["Open 8 to 6"]);
    assert.deepEqual(await app.nextToLearn("ana", "nine"), { about: "When it is open", recheck: ["Opens at 10 now"] });
  });
});

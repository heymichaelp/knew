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

describe("Haunts on knew", () => {
  it("knows nothing of a place never added, and keeps what a note says", async () => {
    const engine = fakeIntelligence({ lenses: [visit] });
    const app = createApp(engine);
    assert.equal(await app.known("ana", "luna"), null);
    await app.addPlace("ana", { id: "luna", name: "Café Luna" });
    assert.deepEqual(await app.known("ana", "luna"), []);
    engine.script({ extraction: extraction([extracted("luna", "KIND", "A café with a reading room")]) });
    await app.addNote("ana", "luna", "Luna is a café with a reading room.");
    assert.deepEqual(await app.known("ana", "luna"), [{ topic: "KIND", text: "A café with a reading room" }]);
  });

  it("lets a correction replace what it corrects, as of when it was said", async () => {
    const engine = fakeIntelligence({ lenses: [visit] });
    const app = createApp(engine);
    await app.addPlace("ana", { id: "nine", name: "Bar Nine" });
    engine.script({ extraction: extraction([extracted("nine", "HOURS", "Open 8 till 6")]) });
    await app.addNote("ana", "nine", "Open 8 till 6.", { at: daysAgo(20) });
    engine.script({
      extraction: extraction([extracted("nine", "HOURS", "Opens at 10")]),
      reconcile: ({ current }) => ({ decisions: [{ newIndex: 0, action: "supersede", factId: current[0]!.id, invalidAt: null }], summary: "A bar." }),
    });
    await app.addNote("ana", "nine", "It opens at 10 now.", { at: daysAgo(5) });
    assert.deepEqual(await app.known("ana", "nine"), [{ topic: "HOURS", text: "Opens at 10" }]);
    assert.deepEqual(await app.known("ana", "nine", { asOf: daysAgo(10) }), [{ topic: "HOURS", text: "Open 8 till 6" }]);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compileLens, compileVocabulary, parseLensDefinition, parseVocabularyDefinition } from "@popjoker/knew";
import { extracted, extraction, fakeIntelligence } from "@popjoker/knew/testing";
import visitDefinition from "../definitions/lenses/visit.json" with { type: "json" };
import vocabularyDefinition from "../definitions/vocabulary.json" with { type: "json" };
import { createApp } from "../src/app.ts";

const vocabulary = compileVocabulary(parseVocabularyDefinition(vocabularyDefinition));
const visit = compileLens(parseLensDefinition(visitDefinition), vocabulary);
const DAY_MS = 86_400_000;

function haunts() {
  const engine = fakeIntelligence({ lenses: [visit] });
  return { engine, app: createApp(engine) };
}

describe("Haunts on knew", () => {
  it("learns what kind of place it is before anything else, and nothing about a place never added", async () => {
    const { app } = haunts();
    assert.equal(await app.nextToLearn("ana", "luna"), null);
    await app.addPlace("ana", { id: "luna", name: "Café Luna" });
    assert.deepEqual(await app.nextToLearn("ana", "luna"), { about: "What kind of place it is", recheck: [] });
  });

  it("reads a note before addNote resolves, and only then turns to what the place is like", async () => {
    const { engine, app } = haunts();
    await app.addPlace("ana", { id: "luna", name: "Café Luna" });
    engine.script({ extraction: extraction([extracted("luna", "KIND", "A café with a reading room upstairs")]) });
    await app.addNote("ana", "luna", "Luna's a café with a reading room upstairs.");
    const readiness = await engine.readiness({ clientId: "haunts", subjectId: "ana" }, "luna", { lens: "visit" });
    assert.deepEqual(
      readiness?.next.map((direction) => direction.need),
      ["opening-hours", "what-its-like", "what-to-order"],
    );
    assert.deepEqual(await app.nextToLearn("ana", "luna"), { about: "When it is open", recheck: [] });
  });

  it("brings hours noted over a month ago back to be re-checked, and leaves recent ones alone", async () => {
    const { engine, app } = haunts();
    await app.addPlace("ana", { id: "nine", name: "Bar Nine" });
    engine.script({ extraction: extraction([extracted("nine", "KIND", "A wine bar")]) });
    await app.addNote("ana", "nine", "Nine is a wine bar.");
    engine.script({ extraction: extraction([extracted("nine", "HOURS", "Open 5pm to 1am, closed Sundays")]) });
    await app.addNote("ana", "nine", "Open five till one, shut Sundays.", { at: new Date(Date.now() - 45 * DAY_MS) });
    assert.deepEqual(await app.nextToLearn("ana", "nine"), { about: "When it is open", recheck: ["Open 5pm to 1am, closed Sundays"] });

    engine.script({ extraction: extraction([extracted("nine", "HOURS", "Open 5pm to midnight, closed Sundays")]) });
    await app.addNote("ana", "nine", "They close at midnight now.", { at: new Date(Date.now() - 10 * DAY_MS) });
    assert.deepEqual(await app.nextToLearn("ana", "nine"), { about: "What it is like to be there", recheck: [] });
  });

  it("keeps each user's places to that user", async () => {
    const { app } = haunts();
    await app.addPlace("ana", { id: "luna", name: "Café Luna" });
    assert.equal(await app.nextToLearn("ben", "luna"), null);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractInput, reconcileInput, type Fact } from "../src/index.ts";
import { fixtureVocabulary } from "../src/testing.ts";

const at = (iso: string) => new Date(iso);

describe("Scenario: The model is shown the roster it must choose from, with the hinted one marked", () => {
  it("prints the knower first, then each entry with the vocabulary's prompt fields and aliases, under its kind", () => {
    const input = extractInput(fixtureVocabulary(), {
      content: "She loves it",
      source: "note",
      referenceAt: at("2026-03-02T12:00:00Z"),
      roster: [
        { id: "r-1", name: "Linda", fields: { relationship: "mother", city: "Austin" }, aliases: ["Mom"] },
        { id: "r-2", name: "Priya", fields: { relationship: null, city: null }, aliases: [] },
      ],
      hints: ["r-1"],
    });
    assert.ok(input.includes("Today (when this was said): 2026-03-02"));
    assert.ok(input.includes("Where it came from: a note they wrote"));
    assert.ok(input.includes('The entries on their list: the person writing, then each of kind "person" (attach facts only to these ids):\n- id: self | name: the person writing (the person writing: "I", "me", "my")\n- id: r-1'));
    assert.ok(input.includes("- id: r-1 | name: Linda | relationship: mother | also called: Mom (recorded about them)"));
    assert.ok(input.includes("- id: r-2 | name: Priya\n"));
    assert.ok(input.includes('What was said:\n"""\nShe loves it\n"""'));
    assert.ok(!input.includes("read off the photograph"));
    assert.ok(!input.includes("The question they were answering"));
  });

  it("shows the question an answer was given to, quoted apart and ahead of what was said", () => {
    const input = extractInput(fixtureVocabulary(), {
      content: "Two, both at university",
      inReplyTo: "Do they have kids?",
      source: "reply",
      referenceAt: at("2026-03-02T12:00:00Z"),
      roster: [{ id: "r-1", name: "Linda", fields: {}, aliases: [] }],
      hints: ["r-1"],
    });
    const question = input.indexOf('The question they were answering (context, not something they said):\n"""\nDo they have kids?\n"""');
    assert.ok(question > 0, input);
    assert.ok(question < input.indexOf('What was said:\n"""\nTwo, both at university\n"""'));
  });

  it("names an unknown source by its own string, and a roster of only the knower, named by the client, as unresolved beyond them", () => {
    const input = extractInput(fixtureVocabulary(), {
      content: "x",
      source: "carrier-pigeon",
      referenceAt: at("2026-03-02T12:00:00Z"),
      roster: [{ id: "self", name: "Ana", fields: {}, aliases: [] }],
      hints: [],
    });
    assert.ok(input.includes("Where it came from: carrier-pigeon"));
    assert.ok(input.includes('- id: self | name: Ana (the person writing: "I", "me", "my")\n(no other entries yet — anyone or anything else mentioned is unresolved)'));
  });

  it("weighs what was read off a photograph differently from what was guessed", () => {
    const input = extractInput(fixtureVocabulary(), {
      content: "Here are 2 photos.",
      observed: "From two photos of her bookshelf: a wooden shelf packed with paperbacks. Words I can read in them: “Normal People”, “Pachinko”.",
      source: "message",
      referenceAt: at("2026-03-02T12:00:00Z"),
      roster: [{ id: "r-1", name: "Linda", fields: {}, aliases: [] }],
      hints: [],
    });
    assert.ok(input.includes("read off the photograph itself"));
    assert.ok(input.includes("evidence they own that book, not that"));
    assert.ok(input.includes("THAT clause"));
    assert.ok(input.includes("a machine's description"));
  });
});

describe("Scenario: Reconcile sees the current facts by id and the new ones by index", () => {
  it("lays out the entity, the dates, both lists and the summary", () => {
    const current: Fact = {
      id: "00000000-0000-4000-8000-000000000001",
      entityId: "s",
      objectId: null,
      type: "LIKES",
      fact: "Gardens",
      attributes: {},
      validAt: at("2025-03-01T00:00:00Z"),
      invalidAt: null,
      createdAt: at("2025-03-02T00:00:00Z"),
      lastSaidAt: null,
      expiredAt: null,
      supersededById: null,
      episodeIds: ["e"],
    };
    const input = reconcileInput(fixtureVocabulary(), {
      entity: { name: "Linda", fields: { relationship: "mother" } },
      referenceAt: at("2026-04-20T18:00:00Z"),
      current: [current],
      incoming: [{ type: "EVENT", fact: "Moved to Portland", validAt: at("2025-09-01T00:00:00Z"), invalidAt: null }],
      summary: "",
    });
    assert.ok(input.startsWith("About this person: Linda (mother)\n\nToday (when the new facts were said): 2026-04-20"));
    assert.ok(input.includes("- 00000000-0000-4000-8000-000000000001 | LIKES | Gardens | true since 2025-03-01; told us 2025-03-02"));
    assert.ok(input.includes("- 0 | EVENT | Moved to Portland | true since 2025-09-01"));
    assert.ok(input.endsWith('Current summary:\n"""\n(none yet)\n"""'));
  });
});

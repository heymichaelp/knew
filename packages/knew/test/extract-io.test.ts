import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractInput, reconcileInput, type Fact } from "../src/index.ts";
import { fixtureLens } from "../src/testing.ts";

const at = (iso: string) => new Date(iso);

describe("Scenario: The model is shown the roster it must choose from, with the hinted one marked", () => {
  it("prints each person with the lens's prompt fields and aliases", () => {
    const input = extractInput(fixtureLens(), {
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
    assert.ok(input.includes("- id: r-1 | name: Linda | relationship: mother | also called: Mom (recorded about them)"));
    assert.ok(input.includes("- id: r-2 | name: Priya\n"));
    assert.ok(input.includes('What was said:\n"""\nShe loves it\n"""'));
    assert.ok(!input.includes("read off the photograph"));
  });

  it("names an unknown source by its own string and an empty roster as unresolved", () => {
    const input = extractInput(fixtureLens(), {
      content: "x",
      source: "carrier-pigeon",
      referenceAt: at("2026-03-02T12:00:00Z"),
      roster: [],
      hints: [],
    });
    assert.ok(input.includes("Where it came from: carrier-pigeon"));
    assert.ok(input.includes("(none yet — every person mentioned is unresolved)"));
  });

  it("weighs what was read off a photograph differently from what was guessed", () => {
    const input = extractInput(fixtureLens(), {
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
  it("lays out the person, the dates, both lists and the summary", () => {
    const current: Fact = {
      id: "00000000-0000-4000-8000-000000000001",
      subjectId: "s",
      objectId: null,
      type: "LIKES",
      fact: "Gardens",
      attributes: {},
      validAt: at("2025-03-01T00:00:00Z"),
      invalidAt: null,
      createdAt: at("2025-03-02T00:00:00Z"),
      expiredAt: null,
      supersededById: null,
      episodeIds: ["e"],
    };
    const input = reconcileInput(fixtureLens(), {
      person: { name: "Linda", fields: { relationship: "mother" } },
      referenceAt: at("2026-04-20T18:00:00Z"),
      current: [current],
      incoming: [{ type: "EVENT", fact: "Moved to Portland", validAt: at("2025-09-01T00:00:00Z"), invalidAt: null }],
      summary: "",
    });
    assert.ok(input.startsWith("Person: Linda (mother)\n\nToday (when the new facts were said): 2026-04-20"));
    assert.ok(input.includes("- 00000000-0000-4000-8000-000000000001 | LIKES | Gardens | true since 2025-03-01; told us 2025-03-02"));
    assert.ok(input.includes("- 0 | EVENT | Moved to Portland | true since 2025-09-01"));
    assert.ok(input.endsWith('Current summary:\n"""\n(none yet)\n"""'));
  });
});

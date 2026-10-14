import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EXTRACT_V2, extractInput, promptFor, reconcileInput, resolveFactHandles, statelessIntelligence, type Fact, type ModelRequest } from "../src/index.ts";
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

describe("Scenario: Reconcile sees the current facts by a short handle and the new ones by index", () => {
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
    assert.ok(input.includes("Current facts (factId | type | fact | dates):\n- f1 | LIKES | Gardens | true since 2025-03-01; told us 2025-03-02"));
    assert.ok(!input.includes("00000000-0000-4000-8000-000000000001"), "a stored id costs a reconcile 36 characters a fact");
    assert.ok(input.includes("- 0 | EVENT | Moved to Portland | true since 2025-09-01"));
    assert.ok(input.endsWith('Current summary:\n"""\n(none yet)\n"""'));
  });
});

describe("Scenario: A handle reconcile cites comes back as the fact's id", () => {
  it("maps f1, f2 in the order listed, and leaves anything else for the plan to report", () => {
    const current = [{ id: "00000000-0000-4000-8000-000000000001" }, { id: "00000000-0000-4000-8000-000000000002" }];
    const decide = (factId: string | null) => ({ newIndex: 0, action: "merge" as const, factId, invalidAt: null });
    assert.deepEqual(
      resolveFactHandles([decide("f2"), decide(" f1 "), decide("f3"), decide("00000000-0000-4000-8000-000000000009"), decide(null)], current).map((d) => d.factId),
      ["00000000-0000-4000-8000-000000000002", "00000000-0000-4000-8000-000000000001", "f3", "00000000-0000-4000-8000-000000000009", null],
    );
  });
});

describe("Scenario: A prompt section with nothing to act on is left out", () => {
  const text = "Intro.\n\n<!-- if: reply -->\n## Answers\n\nRead it as an answer.\n<!-- end if -->\n\n## Always\n\nKept.\n<!-- if: fields -->\n## Fields\n\nFields.\n<!-- end if -->\n";

  it("keeps a section only when its condition holds, and leaves a prompt without sections untouched", () => {
    assert.equal(promptFor(text, { reply: false, fields: false }), "Intro.\n\n## Always\n\nKept.\n");
    assert.equal(promptFor(text, { reply: true, fields: true }), "Intro.\n\n## Answers\n\nRead it as an answer.\n\n## Always\n\nKept.\n## Fields\n\nFields.\n");
    assert.equal(promptFor("No sections here.\n", { reply: false, fields: false }), "No sections here.\n");
    // A condition the engine does not know is never a reason to hide instructions.
    assert.match(promptFor("<!-- if: someday -->\nStill here.\n<!-- end if -->\n", { reply: false, fields: false }), /Still here/);
  });

  it("sends knew's extract prompt without the question and field sections when the note has neither, and with them when it has both", async () => {
    assert.match(EXTRACT_V2, /<!-- if: reply -->\n## Answers to a question/);
    assert.match(EXTRACT_V2, /<!-- if: fields -->\n## Fields they own/);
    const systems: string[] = [];
    const model = async (request: ModelRequest) => {
      if (request.task === "extract") systems.push(request.system);
      return { output: request.task === "extract" ? { facts: [], unresolvedNames: [], aliases: [], fieldUpdates: [] } : { decisions: [], summary: "" } };
    };
    const engine = statelessIntelligence({ vocabulary: fixtureVocabulary(), model });
    const said = new Date("2026-04-20T18:00:00Z");
    await engine.extract({ roster: [{ id: "linda", name: "Linda", fields: {}, aliases: [] }], entities: {}, episode: { source: "note", content: "Linda gardens.", referenceAt: said } });
    await engine.extract({
      roster: [{ id: "linda", name: "Linda", fields: { relationship: "mother" }, aliases: [] }],
      entities: {},
      episode: { source: "note", content: "Two, both at university.", inReplyTo: "Does she have kids?", referenceAt: said },
    });
    const [plain, full] = systems as [string, string];
    for (const heading of ["## Answers to a question", "## Fields they own"]) {
      assert.ok(!plain.includes(heading), `${heading} sent with nothing to act on`);
      assert.ok(full.includes(heading), `${heading} missing when the note needs it`);
    }
    assert.ok(!full.includes("<!-- "), "a marker reached the model");
    assert.ok(plain.length < full.length - 700, "the two sections are about 770 characters");
  });
});

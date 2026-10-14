import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import {
  adapterDefinitionSchema,
  adapterProblems,
  applyMovePlan,
  compileAdapter,
  compiledSchemaProblems,
  compileVocabulary,
  dayOfMove,
  DEFAULT_PROMPT_REFS,
  dimensionVocabulary,
  ENGINE_DEFAULTS,
  extendAdapter,
  isMoveLapsed,
  liveMovesAt,
  MOVE_MAX_CHARS,
  moveInput,
  moveSchemaFor,
  moveSystemExtra,
  parseAdapterDefinition,
  planMoves,
  regroundDirections,
  withdrawUngrounded,
  type AdapterDefinition,
  type Fact,
  type Move,
  type MoveAnswer,
} from "../src/index.ts";
import { fixtureAdapter, fixtureAdapterDefinition, fixtureVocabulary, fixtureVocabularyDefinition } from "../src/testing.ts";

/**
 * Adapters and moves: one kind of move an app may make, registered as data,
 * and what the model proposes under it once a note is read. The planner
 * decides what stands. Nothing here calls a model: the answers are written out.
 */

const at = (iso: string) => new Date(iso);
let n = 0;
const fact = (type: string, text: string, said: string, extra: Partial<Fact> = {}): Fact => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
  entityId: "linda",
  objectId: null,
  type,
  fact: text,
  attributes: {},
  validAt: null,
  invalidAt: null,
  createdAt: at(`${said}T00:00:00Z`),
  lastSaidAt: null,
  expiredAt: null,
  supersededById: null,
  episodeIds: ["e"],
  ...extra,
});
let m = 0;
const move = (label: string, fields: Record<string, string | null>, extra: Partial<Move> = {}): Move => ({
  id: `m-${++m}`,
  entityId: "linda",
  adapter: "fixture-moment",
  label,
  fields: { when: null, why: null, ...fields },
  factIds: [],
  episodeId: "e",
  proposedAt: at("2026-01-10T00:00:00Z"),
  status: "open",
  resolvedAt: null,
  ...extra,
});
const answer = (partial: Partial<MoveAnswer>): MoveAnswer => ({ closed: [], proposed: [], ...partial });
const vocabulary = fixtureVocabulary();
const adapter = fixtureAdapter();
const jan = at("2026-01-15T00:00:00Z");
const bare: AdapterDefinition = { id: "nudges", version: 1, vocabulary: "fixture", noun: "nudge", instructions: "**A nudge** is a word in season." };

describe("Scenario: An adapter is a definition a client registers, checked like a lens", () => {
  it("fills in what a definition leaves out: three open per entity, ninety days, every dimension but the knower's", () => {
    const compiled = compileAdapter(parseAdapterDefinition(bare), vocabulary);
    assert.deepEqual(
      [compiled.id, compiled.version, compiled.noun, compiled.fields, compiled.perEntity, compiled.lapse, compiled.dimensions],
      ["nudges", 1, "nudge", [], ENGINE_DEFAULTS.movesPerEntity, { afterDays: ENGINE_DEFAULTS.moveLapseDays, field: null }, ["never-cross", "has", "likes", "life", "people", "between", "other"]],
    );
    assert.equal(compiled.vocabulary, vocabulary);
    assert.deepEqual(
      [adapter.fields, adapter.perEntity, adapter.lapse, adapter.dimensions],
      [
        [
          { name: "when", description: "The day it is for, YYYY-MM-DD, when their words give one.", kind: "date", values: null },
          { name: "why", description: "The fact it rests on, in plain words.", kind: "text", values: null },
        ],
        2,
        { afterDays: 30, field: "when" },
        ["likes", "life", "people", "has"],
      ],
    );
  });

  it("refuses a shape that is not an adapter, naming why", () => {
    const refuses = (patch: Partial<AdapterDefinition>, why: RegExp) => assert.throws(() => parseAdapterDefinition({ ...fixtureAdapterDefinition(), ...patch }), why);
    refuses({ id: "Moments" }, /id/);
    refuses({ fields: { tone: { description: "How warm.", kind: "enum" } } }, /an enum field names its values/);
    refuses({ fields: { tone: { description: "How warm.", values: ["warm"] } } }, /only an enum does/);
    refuses({ lapse: { field: "day" } }, /names field day, which the adapter does not have/);
    refuses({ lapse: { field: "why" } }, /names field why, which is not a date/);
    refuses({ fields: Object.fromEntries(["a", "b", "c", "d", "e", "f", "g"].map((name) => [name, { description: "x" }])) }, /at most 6 fields/);
    refuses({ perEntity: 0 }, /perEntity/);
    assert.equal(adapterDefinitionSchema.safeParse(bare).success, true);
  });

  it("names every reference its vocabulary does not resolve, and never a dimension about the knower", () => {
    assert.deepEqual(adapterProblems({ ...bare, vocabulary: "elsewhere" }, vocabulary), ["it reads vocabulary elsewhere, and was given fixture"]);
    assert.deepEqual(adapterProblems({ ...bare, dimensions: ["likes", "weather", "means"] }, vocabulary), [
      "it names dimension weather, which the vocabulary does not have",
      "it names dimension means, which is about the knower; nothing is proposed about the knower",
    ]);
    assert.throws(() => compileAdapter({ ...bare, dimensions: ["means"] }, vocabulary), /adapter nudges@1: it names dimension means/);
    assert.deepEqual(adapterProblems(fixtureAdapterDefinition(), vocabulary), []);
  });

  it("extends into one of the client's own: fields patched by name or dropped, the rest replaced or kept, and the result checked", () => {
    const own = extendAdapter(fixtureAdapterDefinition(), {
      id: "fixture-nudge",
      version: 2,
      noun: "nudge",
      fields: { why: null, tone: { description: "How warm to be.", kind: "enum", values: ["warm", "plain"] } },
      perEntity: null,
      lapse: { afterDays: 7 },
      dimensions: ["likes"],
    });
    assert.deepEqual(
      [own.id, own.version, own.noun, own.instructions, Object.keys(own.fields!), own.perEntity, own.lapse, own.dimensions],
      ["fixture-nudge", 2, "nudge", fixtureAdapterDefinition().instructions, ["when", "tone"], undefined, { afterDays: 7 }, ["likes"]],
    );
    const compiled = compileAdapter(own, vocabulary);
    assert.deepEqual([compiled.perEntity, compiled.lapse, compiled.fields[1]], [3, { afterDays: 7, field: null }, { name: "tone", description: "How warm to be.", kind: "enum", values: ["warm", "plain"] }]);
    const patched = extendAdapter(fixtureAdapterDefinition(), { id: "fixture-nudge", version: 3, fields: { why: { kind: "enum", values: ["said", "shown"] } } });
    assert.deepEqual(patched.fields!.why, { description: "The fact it rests on, in plain words.", kind: "enum", values: ["said", "shown"] }, "a patch keeps the base field's description");
    assert.throws(() => extendAdapter(fixtureAdapterDefinition(), { id: "fixture-nudge", version: 4, fields: { when: null } }), /names field when, which the adapter does not have/);
  });
});

describe("Scenario: The vocabulary carries the move prompt, and the move call is told the kind, the charter and the dimensions it may rest on", () => {
  it("carries the move prompt by ref, the client's own when it brings one", () => {
    assert.equal(vocabulary.prompts.move.ref, DEFAULT_PROMPT_REFS.move);
    const own = compileVocabulary({ ...fixtureVocabularyDefinition(), prompts: { move: "My own move prompt." } });
    assert.deepEqual([own.prompts.move.ref, own.prompts.move.text, own.prompts.next.ref], ["vocabulary:fixture@1:move", "My own move prompt.", DEFAULT_PROMPT_REFS.next]);
  });

  it("puts the adapter's instructions first, then the charter and the types, then only the dimensions the adapter names", () => {
    const extra = moveSystemExtra(vocabulary, adapter);
    assert.equal(extra.length, 4);
    assert.equal(extra[0], `## This kind of move\n\n${fixtureAdapterDefinition().instructions}`);
    assert.ok(extra[1]!.startsWith("# Charter"));
    assert.ok(extra[2]!.startsWith("## Fact types"));
    assert.equal(
      extra[3],
      [
        "## Dimensions",
        "",
        "- has: Already has (about the entry). Informed by: HAS, SKILL.",
        "- likes: Likes (about the entry). Informed by: LIKES.",
        "- life: Life (about the entry). Informed by: EVENT, CIRCUMSTANCE.",
        "- people: People (about the entry). Informed by: PERSON.",
      ].join("\n"),
      "in the vocabulary's order, not the adapter's",
    );
    assert.equal(dimensionVocabulary(vocabulary, ["means", "likes"]), "- likes: Likes (about the entry). Informed by: LIKES.", "the knower's are left out even when named");
  });

  it("answers in a schema of the adapter's fields, each nullable, an enum as choices, and no fields key for an adapter with none", () => {
    const schema = moveSchemaFor(adapter);
    assert.deepEqual(compiledSchemaProblems(schema), []);
    const row = (fields: unknown) => schema.safeParse(answer({ proposed: [{ label: "Wish her luck", factIds: ["f"], fields } as never] })).success;
    assert.deepEqual([row({ when: "2026-03-14", why: null }), row({ when: null }), row(undefined)], [true, false, false], "every field is a key, null when unknown");
    assert.equal(schema.safeParse(answer({ closed: [{ moveId: "m", reason: "lost" as never }] })).success, false);
    const toned = compileAdapter({ ...bare, fields: { tone: { description: "How warm.", kind: "enum", values: ["warm", "plain"] } } }, vocabulary);
    const tone = (value: string | null) => moveSchemaFor(toned).safeParse(answer({ proposed: [{ label: "A word", factIds: ["f"], fields: { tone: value } }] })).success;
    assert.deepEqual([tone("warm"), tone(null), tone("cold")], [true, true, false]);
    const bareJson = z.toJSONSchema(moveSchemaFor(compileAdapter(bare, vocabulary))) as { properties: { proposed: { items: { required: string[] } } } };
    assert.deepEqual(bareJson.properties.proposed.items.required, ["label", "factIds"]);
  });
});

describe("Scenario: The planner keeps what the move call may do, and counts the rest as refused", () => {
  const gardens = fact("LIKES", "Gardens", "2026-01-01");
  const mower = fact("HAS", "Has a ride-on mower", "2026-01-01");
  const met = fact("HISTORY", "Met at the allotment", "2026-01-01");
  const gone = fact("LIKES", "Knits", "2025-06-01", { expiredAt: at("2025-12-01T00:00:00Z") });
  const show = fact("EVENT", "Entering the village show in March", "2026-01-15", { episodeIds: ["e-2"] });
  const sister = fact("PERSON", "Her sister Pat visits on Sundays", "2026-01-01");

  it("keeps a grounded proposal with its fields as the adapter defines them, and refuses every row the engine cannot honour", () => {
    const open = move("Wish her luck at the village show", { when: "2026-03-14", why: "She said so" }, { factIds: [show.id] });
    const dismissed = move("Ask after Pat", {}, { status: "dismissed", resolvedAt: jan });
    const done = move("Send seeds", {}, { status: "done", resolvedAt: jan });
    const plan = planMoves({
      adapter,
      facts: [gardens, mower, met, gone, show, sister],
      moves: [open, dismissed, done],
      at: jan,
      answer: answer({
        closed: [
          { moveId: "nobody", reason: "done" },
          { moveId: dismissed.id, reason: "stale" },
          { moveId: open.id, reason: "done" },
          { moveId: open.id, reason: "stale" },
        ],
        proposed: [
          { label: "Ask after Pat", factIds: [sister.id], fields: { when: null, why: null } },
          { label: "Is she entering again?", factIds: [show.id], fields: { when: null, why: null } },
          { label: "   ", factIds: [gardens.id] },
          { label: "x".repeat(MOVE_MAX_CHARS + 1), factIds: [gardens.id] },
          { label: "A new trowel", factIds: [] },
          { label: "A new trowel", factIds: [gone.id] },
          { label: "A new trowel", factIds: [mower.id] },
          { label: "A new trowel", factIds: [met.id] },
          { label: "A new trowel", factIds: [gardens.id, mower.id] },
          { label: "Send seeds", factIds: [gardens.id, gardens.id], fields: { when: "March 2026", why: " for the show " } },
          { label: "send SEEDS ", factIds: [gardens.id], fields: { when: null, why: null } },
          { label: "Send seeds", factIds: [gardens.id], fields: { when: "2026-03-14", why: null } },
          { label: "Cheer her on", factIds: [show.id], fields: { when: "2026-03-14", why: "x" } },
        ],
      }),
    });
    assert.deepEqual(plan, {
      closed: [{ id: open.id, status: "done" }],
      proposed: [
        { label: "Send seeds", fields: { when: null, why: "for the show" }, factIds: [gardens.id] },
        { label: "Send seeds", fields: { when: "2026-03-14", why: null }, factIds: [gardens.id] },
      ],
      rejected: 14,
    });
  });

  it("takes a date only as a day that exists, an enum only as one of its values, and nothing over-long", () => {
    const toned = compileAdapter({ ...fixtureAdapterDefinition(), fields: { when: { description: "The day.", kind: "date" }, tone: { description: "How warm.", kind: "enum", values: ["warm", "plain"] } } }, vocabulary);
    const plan = planMoves({
      adapter: toned,
      facts: [gardens],
      moves: [],
      at: jan,
      answer: answer({
        proposed: [
          { label: "A", factIds: [gardens.id], fields: { when: "2026-02-30", tone: "cold" } },
          { label: "B", factIds: [gardens.id], fields: { when: " 2026-02-28 ", tone: "x".repeat(MOVE_MAX_CHARS + 1) } },
        ],
      }),
    });
    assert.deepEqual(plan.proposed.map((row) => row.fields), [
      { when: null, tone: null },
      { when: "2026-02-28", tone: null },
    ]);
  });

  it("applies closures before proposals, so one answer can swap a move, and a lapsed one takes no room", () => {
    const first = move("Wish her luck at the village show", {}, { factIds: [show.id] });
    const second = move("Ask what she is entering", {}, { factIds: [show.id] });
    const swapped = planMoves({
      adapter,
      facts: [gardens, show],
      moves: [first, second],
      at: jan,
      answer: answer({
        closed: [{ moveId: first.id, reason: "answered" }],
        proposed: [
          { label: "Send seeds for the show", factIds: [gardens.id], fields: { when: null, why: null } },
          { label: "A bunch of flowers after", factIds: [show.id], fields: { when: null, why: null } },
        ],
      }),
    });
    assert.deepEqual([swapped.closed, swapped.proposed.map((row) => row.label), swapped.rejected], [[{ id: first.id, status: "answered" }], ["Send seeds for the show"], 1]);

    const lapsed = move("Water the plants", { when: "2026-01-01" }, { factIds: [gardens.id] });
    const fresh = move("Ask what she is entering", {}, { factIds: [show.id] });
    assert.deepEqual(liveMovesAt([lapsed, fresh], adapter, jan), [fresh], "a move whose day has passed is not live");
    const room = planMoves({
      adapter,
      facts: [gardens, show],
      moves: [lapsed, fresh],
      at: jan,
      answer: answer({ closed: [{ moveId: lapsed.id, reason: "stale" }], proposed: [{ label: "Send seeds for the show", factIds: [gardens.id], fields: { when: null, why: null } }] }),
    });
    assert.deepEqual([room.closed, room.proposed.length, room.rejected], [[{ id: lapsed.id, status: "withdrawn" }], 1, 0], "the lapsed one is still open to close, and never counted against the room");
  });

  it("applies a plan in place: the closures dated, the proposals minted under the adapter", () => {
    const open = move("Wish her luck at the village show", {}, { factIds: [show.id] });
    const stale = move("Water the plants", {}, { factIds: [gardens.id] });
    const moves = [open, stale];
    let ids = 0;
    const minted = applyMovePlan(
      moves,
      { closed: [{ id: open.id, status: "done" }, { id: stale.id, status: "withdrawn" }], proposed: [{ label: "Send seeds", fields: { when: "2026-03-14", why: null }, factIds: [gardens.id] }], rejected: 0 },
      { adapter: "fixture-moment", entityId: "linda", at: jan, episodeId: "e-2", newId: () => `n-${++ids}` },
    );
    assert.deepEqual([open.status, open.resolvedAt, stale.status, stale.resolvedAt], ["done", jan, "withdrawn", jan]);
    assert.deepEqual(minted, [
      { id: "n-1", entityId: "linda", adapter: "fixture-moment", label: "Send seeds", fields: { when: "2026-03-14", why: null }, factIds: [gardens.id], episodeId: "e-2", proposedAt: jan, status: "open", resolvedAt: null },
    ]);
    assert.equal(moves.length, 3);
  });

  it("follows a supersession to the replacement, and withdraws a move with no ground left, as a direction is", () => {
    const denver = fact("CIRCUMSTANCE", "Lives in Denver", "2026-01-01");
    const colorado = fact("CIRCUMSTANCE", "Lives in Denver, Colorado", "2026-02-01");
    const snow = move("Ask how the snow is treating her", {}, { factIds: [denver.id] });
    const seeds = move("Send seeds", {}, { factIds: [gardens.id] });
    const moves = [snow, seeds];
    regroundDirections(moves, denver.id, colorado.id);
    assert.deepEqual(snow.factIds, [colorado.id]);
    assert.deepEqual(withdrawUngrounded(moves, (id) => id === gardens.id, jan), [snow.id]);
    assert.deepEqual([snow.status, snow.resolvedAt, seeds.status], ["withdrawn", jan, "open"]);
  });

  it("lapses the day after the day it names, else after the adapter's window, and is live only in between", () => {
    const dated = move("Wish her luck at the village show", { when: "2026-03-14" });
    assert.equal(dayOfMove(dated, adapter)?.toISOString(), "2026-03-14T00:00:00.000Z");
    assert.deepEqual([isMoveLapsed(dated, adapter, at("2026-03-14T23:00:00Z")), isMoveLapsed(dated, adapter, at("2026-03-15T00:00:00Z"))], [false, true], "on the day it still stands");
    const undated = move("Send seeds", { when: "spring" });
    assert.equal(dayOfMove(undated, adapter), null, "a day that is not one counts as none");
    assert.deepEqual([isMoveLapsed(undated, adapter, at("2026-02-08T23:00:00Z")), isMoveLapsed(undated, adapter, at("2026-02-09T00:00:00Z"))], [false, true], "thirty days from when it was proposed");
    const later = move("Ask after Pat", {}, { proposedAt: at("2026-02-01T00:00:00Z") });
    const closed = move("A bunch of flowers", {}, { status: "done", resolvedAt: at("2026-02-01T00:00:00Z") });
    assert.deepEqual(liveMovesAt([dated, undated, later, closed], adapter, jan), [dated, undated, closed], "as of January, February's is not yet, and the one done in February still was");
    assert.deepEqual(liveMovesAt([dated, undated, later, closed], adapter, at("2026-03-01T00:00:00Z")), [dated, later]);
  });

  it("writes the move call's input: the kind, what to honor, what was just learned, the rest, the writer, the fields, the open moves and the room", () => {
    const means = fact("MEANS", "Has fifty a month to spare", "2025-12-01", { entityId: "self" });
    const open = move("Wish her luck at the village show", { when: "2026-03-14", why: "She said so" }, { factIds: [show.id] });
    const lapsed = move("Water the plants", { when: "2026-01-01" }, { factIds: [gardens.id] });
    const done = move("Send seeds", {}, { status: "done", resolvedAt: jan });
    const text = moveInput(vocabulary, adapter, {
      entity: { name: "Linda", fields: { relationship: "mother" } },
      referenceAt: jan,
      facts: [gardens, mower, show],
      knower: [means],
      learned: [show.id],
      moves: [open, lapsed, done],
    });
    assert.ok(text.startsWith("Moves of kind fixture-moment for this person: Linda (mother)\n\nToday (when this was learned): 2026-01-15\n\n"));
    assert.match(text, new RegExp(`Honor \\(id \\| type \\| fact \\| dates\\): never a ground, and nothing near it:\n- ${mower.id} \\| HAS \\| Has a ride-on mower \\| told us 2026-01-01\n\nJust learned`));
    assert.match(text, new RegExp(`Just learned \\(id \\| type \\| fact \\| dates\\):\n- ${show.id} \\| EVENT \\| Entering the village show in March \\| told us 2026-01-15\n\nAlso known`));
    assert.match(text, new RegExp(`Also known \\(id \\| type \\| fact \\| dates\\):\n- ${gardens.id} \\| LIKES \\| Gardens \\| told us 2026-01-01\n\nAbout the writer`));
    assert.match(text, /About the writer \(id \| type \| fact \| dates\):\n- .* \| MEANS \| Has fifty a month to spare/);
    assert.match(text, /Fields \(name \| kind \| description\):\n- when \| date \| The day it is for, YYYY-MM-DD, when their words give one.\n- why \| text \| The fact it rests on, in plain words.\n\nOpen moves/);
    assert.match(
      text,
      new RegExp(
        `Open moves \\(id \\| label \\| fields \\| grew from\\):\n- ${open.id} \\| Wish her luck at the village show \\| when: 2026-03-14; why: She said so \\| ${show.id}\n- ${lapsed.id} \\| Water the plants \\| when: 2026-01-01; why: null \\| ${gardens.id} \\(lapsed\\)\n\nRoom for new moves: 1$`,
      ),
    );
    assert.doesNotMatch(text, /Send seeds/, "a closed move is not shown");

    const toned = compileAdapter({ ...bare, fields: { tone: { description: "How warm.", kind: "enum", values: ["warm", "plain"] } } }, vocabulary);
    const nothing = moveInput(vocabulary, toned, { entity: { name: "Al", fields: {} }, referenceAt: jan, facts: [], knower: [], learned: [], moves: [] });
    assert.equal(
      nothing,
      [
        "Moves of kind nudges for this person: Al",
        "Today (when this was learned): 2026-01-15",
        "Just learned (id | type | fact | dates):\n(nothing new)",
        "Also known (id | type | fact | dates):\n(nothing else)",
        "Fields (name | kind | description):\n- tone | enum (warm | plain) | How warm.",
        "Open moves (id | label | fields | grew from):\n(none yet)",
        "Room for new moves: 3",
      ].join("\n\n"),
      "no Honor with nothing pinned, no writer with nothing known of them",
    );
    const fieldless = moveInput(vocabulary, compileAdapter(bare, vocabulary), { entity: { name: "Al", fields: {} }, referenceAt: jan, facts: [], knower: [], learned: [], moves: [move("A word", {})] });
    assert.doesNotMatch(fieldless, /Fields \(name/);
    assert.match(fieldless, /\| A word \| none \| \n/, "a fieldless move shows none");
  });
});

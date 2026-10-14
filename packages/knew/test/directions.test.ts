import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyDirectionPlan,
  compiledSchemaProblems,
  compileLens,
  compileVocabulary,
  DEFAULT_PROMPT_REFS,
  dimensionVocabulary,
  DIRECTION_MAX_CHARS,
  ENGINE_DEFAULTS,
  gapsFor,
  isLapsed,
  liveDirectionsAt,
  nextInput,
  nextSchemaFor,
  nextSystemExtra,
  planDirections,
  readinessFor,
  regroundDirections,
  vocabularyFrom,
  withdrawUngrounded,
  type Fact,
  type Lens,
  type LensDefinition,
  type NeedSpec,
  type NextAnswer,
  type ProposedDirection,
} from "../src/index.ts";
import { fixtureGiftLens, fixtureLens, fixtureVisitLens, fixtureVocabulary, fixtureVocabularyDefinition } from "../src/testing.ts";

/**
 * Directions: the specific things to learn next that the model proposes inside
 * the vocabulary's dimensions. The planner decides what stands; readiness
 * ranks what is live. Nothing here calls a model: the answers are written out.
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
let d = 0;
const direction = (dimension: string, label: string, extra: Partial<ProposedDirection> = {}): ProposedDirection => ({
  id: `d-${++d}`,
  entityId: "linda",
  dimension,
  label,
  factIds: [],
  episodeId: "e",
  proposedAt: at("2026-01-10T00:00:00Z"),
  status: "open",
  answeredBy: null,
  resolvedAt: null,
  ...extra,
});
const answer = (partial: Partial<NextAnswer>): NextAnswer => ({ answered: [], withdrawn: [], proposed: [], ...partial });
const mother = { fields: { relationship: "mother" } };
const vocabulary = fixtureVocabulary();
const jan = at("2026-01-15T00:00:00Z");
const lensOf = (needs: NeedSpec[], extra: Partial<LensDefinition> = {}): Lens =>
  compileLens({ id: "t", version: 1, vocabulary: "fixture", header: "About {who}:", overHeading: "Over", needs, ...extra }, vocabulary);
const shown = (readiness: { next: Array<{ id: string | null; need: string; value: number }> }) => readiness.next.map((direction) => [direction.id, direction.need, direction.value]);

describe("Scenario: The vocabulary says how directions are kept, and what the next call is told", () => {
  it("keeps two per dimension for 180 days unless told otherwise, and none at all for `false`", () => {
    assert.deepEqual(vocabulary.directions, { perDimension: ENGINE_DEFAULTS.directionsPerDimension, lapseAfterDays: ENGINE_DEFAULTS.directionLapseDays });
    assert.deepEqual(compileVocabulary({ ...fixtureVocabularyDefinition(), directions: { perDimension: 1 } }).directions, { perDimension: 1, lapseAfterDays: 180 });
    assert.equal(compileVocabulary({ ...fixtureVocabularyDefinition(), directions: false }).directions, null);
    assert.throws(() => vocabularyFrom({ ...fixtureVocabularyDefinition(), directions: { perDimension: 0 } }), "a dimension with room for none is `false`, not zero");
  });

  it("carries the next prompt by ref, the client's own when it brings one", () => {
    assert.equal(vocabulary.prompts.next.ref, DEFAULT_PROMPT_REFS.next);
    const own = compileVocabulary({ ...fixtureVocabularyDefinition(), prompts: { next: "My own next prompt." } });
    assert.deepEqual([own.prompts.next.ref, own.prompts.next.text, own.prompts.extract.ref], ["vocabulary:fixture@1:next", "My own next prompt.", DEFAULT_PROMPT_REFS.extract]);
  });

  it("tells the next call the dimensions, each with what it is about and the types that inform it, the knower's left out", () => {
    const extra = nextSystemExtra(vocabulary);
    assert.equal(extra.length, 3);
    assert.ok(extra[0]!.startsWith("# Charter"));
    assert.ok(extra[2]!.startsWith("## Dimensions\n\n- never-cross: Never cross (about the entry). Informed by: LINE."));
    const dimensions = dimensionVocabulary(vocabulary);
    assert.match(dimensions, /^- has: Already has \(about the entry\)\. Informed by: HAS, SKILL\.$/m);
    assert.match(dimensions, /^- between: Between you \(about the relationship between the writer and the entry\)\. Informed by: HISTORY\.$/m);
    assert.doesNotMatch(dimensions, /means|Your means/);
  });

  it("offers the entity's and the relationship's dimensions in the answer schema, and nothing a structured-output endpoint refuses", () => {
    const schema = nextSchemaFor(vocabulary);
    assert.deepEqual(compiledSchemaProblems(schema), []);
    const proposal = (dimension: string) => schema.safeParse(answer({ proposed: [{ dimension, label: "Whether she still gardens", factIds: [] }] })).success;
    assert.deepEqual([proposal("likes"), proposal("between"), proposal("means"), proposal("elsewhere")], [true, true, false, false]);
  });
});

describe("Scenario: The planner keeps what the next call may do, and counts the rest as refused", () => {
  const gardens = fact("LIKES", "Gardens", "2026-01-01");
  const gone = fact("LIKES", "Knits", "2025-06-01", { expiredAt: at("2025-12-01T00:00:00Z") });

  it("keeps a grounded proposal and refuses every row the engine cannot honour", () => {
    const open = direction("likes", "Whether she sells what she grows", { factIds: [gardens.id] });
    const dismissed = direction("people", "Whether her sister still visits", { status: "dismissed", resolvedAt: jan });
    const plan = planDirections({
      vocabulary,
      facts: [gardens, gone],
      directions: [open, dismissed],
      at: jan,
      answer: answer({
        answered: [
          { directionId: "nobody", factId: gardens.id },
          { directionId: open.id, factId: gone.id },
        ],
        withdrawn: ["nobody"],
        proposed: [
          { dimension: "means", label: "Her budget", factIds: [] },
          { dimension: "likes", label: "Is she a Broncos fan?", factIds: [] },
          { dimension: "likes", label: "   ", factIds: [] },
          { dimension: "likes", label: "x".repeat(DIRECTION_MAX_CHARS + 1), factIds: [] },
          { dimension: "likes", label: "whether she SELLS what she grows ", factIds: [] },
          { dimension: "people", label: "Whether her sister still visits", factIds: [] },
          { dimension: "likes", label: "What she grows", factIds: [gone.id] },
          { dimension: "has", label: "Which wheel she wants", factIds: [gardens.id, gardens.id] },
          { dimension: "has", label: "which wheel she wants", factIds: [] },
          { dimension: "life", label: "Where the new flat is", factIds: [] },
          { dimension: "life", label: "Whether she still works nights", factIds: [] },
          { dimension: "life", label: "Who looks after the dog", factIds: [] },
        ],
      }),
    });
    assert.deepEqual(plan, {
      answered: [],
      withdrawn: [],
      proposed: [
        { dimension: "has", label: "Which wheel she wants", factIds: [gardens.id] },
        { dimension: "life", label: "Where the new flat is", factIds: [] },
        { dimension: "life", label: "Whether she still works nights", factIds: [] },
      ],
      rejected: 12,
    });
  });

  it("applies closures before proposals, so one answer can swap a direction, and a lapsed one takes no room", () => {
    const first = direction("likes", "Whether she sells what she grows");
    const second = direction("likes", "Whether she enters the village show");
    const swapped = planDirections({
      vocabulary,
      facts: [gardens],
      directions: [first, second],
      at: jan,
      answer: answer({
        answered: [{ directionId: first.id, factId: gardens.id }],
        proposed: [
          { dimension: "likes", label: "Which seeds she orders", factIds: [gardens.id] },
          { dimension: "likes", label: "Whether she keeps bees", factIds: [] },
        ],
      }),
    });
    assert.deepEqual([swapped.answered, swapped.proposed.map((row) => row.label), swapped.rejected], [[{ id: first.id, factId: gardens.id }], ["Which seeds she orders"], 1]);

    const lapsed = direction("likes", "Whether she took the allotment", { proposedAt: at("2025-01-01T00:00:00Z") });
    const fresh = direction("likes", "Whether she enters the village show");
    const room = planDirections({
      vocabulary,
      facts: [gardens],
      directions: [lapsed, fresh],
      at: jan,
      answer: answer({ withdrawn: [lapsed.id], proposed: [{ dimension: "likes", label: "Which seeds she orders", factIds: [] }] }),
    });
    assert.deepEqual([room.withdrawn, room.proposed.length, room.rejected], [[lapsed.id], 1, 0], "the lapsed one is still open to withdraw, and never counted against the room");
  });

  it("applies a plan in place: the closures dated, the proposals minted", () => {
    const open = direction("likes", "Whether she sells what she grows");
    const stale = direction("life", "Where the new flat is");
    const directions = [open, stale];
    let ids = 0;
    const minted = applyDirectionPlan(
      directions,
      { answered: [{ id: open.id, factId: gardens.id }], withdrawn: [stale.id], proposed: [{ dimension: "has", label: "Which wheel she wants", factIds: [gardens.id] }], rejected: 0 },
      { entityId: "linda", at: jan, episodeId: "e-2", newId: () => `m-${++ids}` },
    );
    assert.deepEqual([open.status, open.answeredBy, open.resolvedAt], ["answered", gardens.id, jan]);
    assert.deepEqual([stale.status, stale.resolvedAt], ["withdrawn", jan]);
    assert.deepEqual(minted, [
      { id: "m-1", entityId: "linda", dimension: "has", label: "Which wheel she wants", factIds: [gardens.id], episodeId: "e-2", proposedAt: jan, status: "open", answeredBy: null, resolvedAt: null },
    ]);
    assert.equal(directions.length, 3);
  });

  it("follows a supersession to the replacement, and withdraws what has no ground left", () => {
    const denver = fact("CIRCUMSTANCE", "Grew up in Denver", "2026-01-01");
    const colorado = fact("CIRCUMSTANCE", "Grew up in Denver, Colorado", "2026-02-01");
    const broncos = direction("likes", "Whether she follows the Broncos", { factIds: [denver.id] });
    const basic = direction("people", "Whether she has a partner");
    const directions = [broncos, basic];
    regroundDirections(directions, denver.id, colorado.id);
    assert.deepEqual(broncos.factIds, [colorado.id]);
    assert.deepEqual(withdrawUngrounded(directions, (id) => id !== colorado.id, jan), [broncos.id], "with Denver corrected away, the Broncos thread has no ground");
    assert.deepEqual([broncos.status, broncos.resolvedAt, basic.status], ["withdrawn", jan, "open"], "a direction that grew from nothing stands");
  });

  it("knows what is live at a moment: proposed by then, not yet resolved, and not lapsed, lapsing on the day", () => {
    const proposed = direction("likes", "Whether she sells what she grows");
    assert.deepEqual([isLapsed(proposed, 180, at("2026-07-08T00:00:00Z")), isLapsed(proposed, 180, at("2026-07-09T00:00:00Z"))], [false, true]);
    const later = direction("likes", "Whether she keeps bees", { proposedAt: at("2026-02-01T00:00:00Z") });
    const closed = direction("has", "Which wheel she wants", { status: "answered", answeredBy: gardens.id, resolvedAt: at("2026-02-01T00:00:00Z") });
    assert.deepEqual(
      liveDirectionsAt([proposed, later, closed], jan, 180).map((direction) => direction.id),
      [proposed.id, closed.id],
      "as of January, the one proposed in February is not yet, and the one answered in February still was",
    );
    assert.deepEqual(liveDirectionsAt([proposed, later, closed], at("2026-03-01T00:00:00Z"), 180).map((direction) => direction.id), [proposed.id, later.id]);
  });

  it("writes the next call's input: the entry, what was just learned, the rest, the writer, the open directions and the room", () => {
    const history = fact("HISTORY", "Met at the allotment", "2026-01-15", { episodeIds: ["e-2"] });
    const means = fact("MEANS", "Has fifty a month to spare", "2025-12-01", { entityId: "self" });
    const open = direction("likes", "Whether she sells what she grows", { factIds: [gardens.id] });
    const lapsed = direction("life", "Where the new flat is", { proposedAt: at("2025-01-01T00:00:00Z") });
    const text = nextInput(vocabulary, {
      entity: { name: "Linda", fields: { relationship: "mother" } },
      referenceAt: jan,
      facts: [gardens, history],
      knower: [means],
      learned: [history.id],
      directions: [open, lapsed, direction("has", "Which wheel she wants", { status: "answered", answeredBy: gardens.id, resolvedAt: jan })],
      perDimension: 2,
      lapseAfterDays: 180,
    });
    assert.ok(text.startsWith("Directions for this person: Linda (mother)\n\nToday (when this was learned): 2026-01-15\n\n"));
    assert.match(text, /Just learned \(id \| type \| fact \| dates\):\n- .* \| HISTORY \| Met at the allotment \| told us 2026-01-15\n\nAlso known/);
    assert.match(text, /Also known \(id \| type \| fact \| dates\):\n- .* \| LIKES \| Gardens \| told us 2026-01-01\n\nAbout the writer/);
    assert.match(text, /About the writer \(id \| type \| fact \| dates\):\n- .* \| MEANS \| Has fifty a month to spare/);
    assert.match(text, new RegExp(`Open directions \\(id \\| dimension \\| label \\| grew from\\):\n- ${open.id} \\| likes \\| Whether she sells what she grows \\| ${gardens.id}\n- ${lapsed.id} \\| life \\| Where the new flat is \\| nothing \\(lapsed\\)\n`));
    assert.doesNotMatch(text, /Which wheel she wants/, "a closed direction is not shown");
    assert.match(text, /Room for new directions \(dimension \| open now \| room left\):\n- never-cross \| 0 \| 2\n- has \| 0 \| 2\n- likes \| 1 \| 1\n- life \| 0 \| 2\n- people \| 0 \| 2\n- between \| 0 \| 2\n- other \| 0 \| 2$/);

    const nothing = nextInput(vocabulary, { entity: { name: "Al", fields: {} }, referenceAt: jan, facts: [], knower: [], learned: [], directions: [], perDimension: 2, lapseAfterDays: 180 });
    assert.match(nothing, /Just learned \(id \| type \| fact \| dates\):\n\(nothing yet: this entry was just added\)\n\nAlso known \(id \| type \| fact \| dates\):\n\(nothing else\)\n\nOpen directions/);
    assert.doesNotMatch(nothing, /About the writer/);
  });
});

describe("Scenario: Readiness ranks the proposed directions through the lens, and falls back to the need itself", () => {
  const lens = fixtureLens();

  it("replaces a need's own direction with what was proposed in its dimension, cited only by facts the reader can see", () => {
    const gardens = fact("LIKES", "Gardens", "2026-01-01");
    const bees = direction("likes", "Whether she keeps bees", { factIds: [gardens.id, "a-fact-nobody-can-see"] });
    const plain = readinessFor(lens, mother, [], jan);
    assert.deepEqual(shown(plain), [[null, "what-they-love", 1], [null, "how-the-days-go", 1]], "with nothing proposed, the needs are the directions, as before");
    const readiness = readinessFor(lens, mother, [gardens], jan, [], [bees]);
    assert.deepEqual(shown(readiness), [[null, "how-the-days-go", 1], [bees.id, "what-they-love", 0.5]], "in a need already met, a thread is worth what a stale fact is");
    assert.deepEqual(readiness.next[1], {
      id: bees.id,
      kind: "learn",
      need: "what-they-love",
      label: "Whether she keeps bees",
      about: "entity",
      dimension: "likes",
      types: ["LIKES", "SKILL"],
      value: 0.5,
      factIds: [gardens.id],
      proposedAt: bees.proposedAt,
    });
    assert.deepEqual(readiness.needs.map((need) => [need.id, need.state, need.strength]), [["what-they-love", "met", 1], ["how-the-days-go", "open", 0]], "a direction is never evidence");
    assert.deepEqual(gapsFor(lens, mother, [gardens], jan, [], [bees]).map((gap) => [gap.id, gap.need]), [[null, "how-the-days-go"]], "a thread in a met need is not a gap");
    const open = readinessFor(lens, mother, [], jan, [], [bees]);
    assert.deepEqual(shown(open), [[bees.id, "what-they-love", 1], [null, "how-the-days-go", 1]], "in an open need, a proposed direction is worth what the need is");
    assert.deepEqual(gapsFor(lens, mother, [], jan, [], [bees]).map((gap) => [gap.id, gap.label]), [[bees.id, "Whether she keeps bees"], [null, "How their days go"]]);
  });

  it("lists several in one need newest first, and in a lens that is `listed` keeps the lens's order whatever the values", () => {
    const older = direction("likes", "Whether she keeps bees", { proposedAt: at("2026-01-05T00:00:00Z") });
    const newer = direction("has", "Which wheel she wants", { proposedAt: at("2026-01-12T00:00:00Z") });
    assert.deepEqual(readinessFor(lens, mother, [], jan, [], [older, newer]).next.map((direction) => direction.id), [newer.id, older.id, null]);
    const weighted = lensOf([
      { id: "a", label: "A", types: ["HAS"] },
      { id: "b", label: "B", types: ["LIKES"], weight: 3 },
    ]);
    const bees = direction("likes", "Whether she keeps bees");
    assert.deepEqual(shown(readinessFor(weighted, mother, [], jan, [], [bees])), [[bees.id, "b", 3], [null, "a", 1]]);
    const listed = lensOf([{ id: "a", label: "A", types: ["HAS"] }, { id: "b", label: "B", types: ["LIKES"], weight: 3 }], { order: "listed" });
    assert.deepEqual(shown(readinessFor(listed, mother, [], jan, [], [bees])), [[null, "a", 1], [bees.id, "b", 3]]);
  });

  it("gives a direction to the need of its dimension first, else the first need whose types reach into it, and shows none a need waits for", () => {
    const visit = fixtureVisitLens();
    const partner = direction("people", "Whether she has a partner");
    const bees = direction("likes", "Whether she keeps bees");
    const met = direction("between", "How long since you last visited");
    const before = readinessFor(visit, mother, [], jan, [], [partner, bees, met]);
    assert.deepEqual(shown(before), [[null, "how-the-days-go", 2], [partner.id, "people", 1]], "what they love waits for how the days go, and nothing in this lens covers between");
    const days = fact("CIRCUMSTANCE", "Works days", "2026-01-02");
    const after = readinessFor(visit, mother, [days], jan, [], [partner, bees, met]);
    assert.deepEqual(shown(after), [[bees.id, "what-they-love", 1], [partner.id, "people", 1]]);
    assert.deepEqual(after.next[0]!.dimension, "likes", "a direction names the dimension it would inform, not the need's");
  });

  it("never shows a direction in a dimension about the knower", () => {
    const gift = fixtureGiftLens();
    const budget = direction("means", "What you can spend this year");
    const history = direction("between", "Where you first met");
    const means = fact("MEANS", "Has fifty a month to spare", "2025-12-01", { entityId: "self" });
    const readiness = readinessFor(gift, mother, [], jan, [means], [budget, history]);
    assert.deepEqual(shown(readiness), [[null, "what-they-love", 3], [history.id, "how-you-know-them", 2]]);
  });

  it("puts a revisit before the directions proposed in its need, both worth half", () => {
    const days = fact("CIRCUMSTANCE", "Works days", "2026-01-01");
    const nights = direction("life", "Whether the night shifts came back", { factIds: [days.id], proposedAt: at("2026-03-01T00:00:00Z") });
    const april = at("2026-04-01T00:00:00Z");
    const readiness = readinessFor(lens, mother, [days], april, [], [nights]);
    assert.deepEqual(readiness.next.map((direction) => [direction.kind, direction.id, direction.need, direction.value, direction.factIds]), [
      ["learn", null, "what-they-love", 1, []],
      ["revisit", null, "how-the-days-go", 0.5, [days.id]],
      ["learn", nights.id, "how-the-days-go", 0.5, [days.id]],
    ]);
    assert.deepEqual(gapsFor(lens, mother, [days], april, [], [nights]).map((gap) => gap.need), ["what-they-love"], "a due need is not a gap, whatever is proposed in it");
  });

  it("shows a direction only while it is live: not before it was proposed, still after a later answer, and not once it has lapsed", () => {
    const bees = direction("likes", "Whether she keeps bees", { proposedAt: at("2026-02-01T00:00:00Z") });
    assert.deepEqual(readinessFor(lens, mother, [], jan, [], [bees]).next[0]!.id, null, "as of January, February's proposal is not yet");
    const answered = direction("likes", "Whether she keeps bees", { status: "answered", answeredBy: "f", resolvedAt: at("2026-02-01T00:00:00Z") });
    assert.deepEqual(readinessFor(lens, mother, [], jan, [], [answered]).next[0]!.id, answered.id, "as of January, it was still open");
    const proposed = direction("likes", "Whether she keeps bees");
    assert.equal(readinessFor(lens, mother, [], at("2026-07-08T00:00:00Z"), [], [proposed]).next[0]!.id, proposed.id);
    assert.equal(readinessFor(lens, mother, [], at("2026-07-09T00:00:00Z"), [], [proposed]).next[0]!.id, null, "on day 180 it has lapsed, and the need speaks for itself again");
    const patient = compileLens(fixtureLens().definition, compileVocabulary({ ...fixtureVocabularyDefinition(), directions: { lapseAfterDays: 365 } }));
    assert.equal(readinessFor(patient, mother, [], at("2026-07-09T00:00:00Z"), [], [proposed]).next[0]!.id, proposed.id, "the window is the vocabulary's");
  });
});

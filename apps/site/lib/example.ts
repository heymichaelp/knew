/**
 * The worked example on the front page.
 *
 * The vocabulary is the package's own person preset, extended with the two
 * fields this example needs — the way a client starts. The episode and the
 * facts beneath it are written out here, the way a model would have returned
 * them. Everything after that — the page, what is known per dimension, what
 * to learn next — is not written: it is produced by the engine's own
 * `renderBrief` and `readinessFor`. If either changes, or the preset does, the
 * front page changes with it.
 */
import { compileLens, compileVocabulary, extendLens, extendVocabulary, type Fact, type ProposedDirection, readinessFor, renderBrief } from "@popjoker/knew";
import { person } from "@popjoker/knew/presets";

export const exampleVocabulary = compileVocabulary(
  extendVocabulary(person.vocabulary(), { id: "example", version: 1, fields: ["relationship", "city"], promptFields: ["relationship"] }),
);

export const exampleLens = compileLens(extendLens(person.lens(), { id: "example", version: 1, vocabulary: "example" }), exampleVocabulary);

/** A fixed moment, so the page is the same on every build. */
export const AT = new Date("2026-10-05T00:00:00Z");

const SAID = new Date("2026-10-04T19:12:00Z");

export const exampleEpisode = {
  source: "note",
  sourceLabel: "from your note",
  at: SAID,
  words:
    "Called Mum. She's finally back from Lisbon — the new job at the hospital starts a week from Monday. She's properly good at the ceramics now, selling at the fair next month. Don't mention Jamie.",
} as const;

export const examplePerson = {
  name: "Mum",
  fields: { relationship: "mother", city: null } as Record<string, string | null>,
};

const fact = (id: string, type: string, text: string, extra: Partial<Fact> = {}): Fact => ({
  id,
  entityId: "mum",
  objectId: null,
  type,
  fact: text,
  attributes: {},
  validAt: null,
  invalidAt: null,
  createdAt: SAID,
  lastSaidAt: null,
  expiredAt: null,
  supersededById: null,
  episodeIds: ["ep_1"],
  ...extra,
});

/** What extraction returned: typed, dated, and attached to an entity. */
export const exampleFacts: Fact[] = [
  fact("f1", "AVOID", "Never bring up Jamie."),
  fact("f2", "LIFE_EVENT", "Moved home from Lisbon.", {
    attributes: { kind: "moved" },
    validAt: new Date("2026-09-28T00:00:00Z"),
  }),
  fact("f3", "WORK", "Starts a new job at the hospital.", { validAt: new Date("2026-10-12T00:00:00Z") }),
  fact("f4", "SKILL", "Makes ceramics.", { attributes: { level: "serious" } }),
  fact("f5", "PLAN", "Selling her ceramics at the fair next month.", { validAt: new Date("2026-11-01T00:00:00Z") }),
];

/** The page, rendered by the engine. */
export const examplePage: string =
  renderBrief(exampleLens, {
    entity: examplePerson,
    summary: "",
    facts: exampleFacts,
    at: AT,
  }) ?? "";

const direction = (id: string, dimension: string, label: string, factIds: string[]): ProposedDirection => ({
  id,
  entityId: "mum",
  dimension,
  label,
  factIds,
  episodeId: "ep_1",
  proposedAt: SAID,
  status: "open",
  answeredBy: null,
  resolvedAt: null,
});

/** What the model proposed learning next, written out the way its `next` call would have returned them from these facts. */
export const exampleDirections: ProposedDirection[] = [
  direction("d1", "people", "Whether she's near family now she's back", ["f2"]),
  direction("d2", "together", "Whether you'll be at the fair next month", ["f5"]),
  direction("d3", "work", "What the new job at the hospital is", ["f3"]),
  direction("d4", "pursuits", "Whether she has a kiln at home now", ["f2", "f4"]),
  direction("d5", "background", "Whether she kept any ties to Lisbon", ["f2"]),
];

/** What is known, how strongly, and what to learn next — ranked by the engine. */
export const exampleReadiness = readinessFor(exampleLens, examplePerson, exampleFacts, AT, [], exampleDirections);

/**
 * A field is the client's business. The engine noticed the move and wants to
 * set `city`, but it proposes rather than writes.
 */
export const exampleProposal = { field: "city", value: "home", kind: "field" } as const;

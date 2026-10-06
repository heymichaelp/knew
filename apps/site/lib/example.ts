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
import { compileLens, compileVocabulary, extendLens, extendVocabulary, type Fact, readinessFor, renderBrief } from "@popjoker/knew";
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

/** What is known, how strongly, and what to learn next — decided by the engine. */
export const exampleReadiness = readinessFor(exampleLens, examplePerson, exampleFacts, AT);

/**
 * A field is the client's business. The engine noticed the move and wants to
 * set `city`, but it proposes rather than writes.
 */
export const exampleProposal = { field: "city", value: "home", kind: "field" } as const;

/**
 * The worked example on the front page.
 *
 * The episode and the facts beneath it are written out here, the way a model
 * would have returned them. Everything after that — the page, the gaps — is not
 * written: it is produced by the engine's own `renderBrief` and `gapsFor`,
 * through the fixture lens the package tests itself with. If either function
 * changes, the front page changes with it.
 */
import { compileLens, type Fact, gapsFor, renderBrief } from "@popjoker/knew";
import { fixtureLensDefinition } from "@popjoker/knew/testing";

export const exampleLens = compileLens(fixtureLensDefinition());

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

const fact = (
  id: string,
  type: string,
  text: string,
  extra: Partial<Fact> = {},
): Fact => ({
  id,
  subjectId: "mum",
  objectId: null,
  type,
  fact: text,
  attributes: {},
  validAt: null,
  invalidAt: null,
  createdAt: SAID,
  expiredAt: null,
  supersededById: null,
  episodeIds: ["ep_1"],
  ...extra,
});

/** What extraction returned: typed, dated, and attached to a person. */
export const exampleFacts: Fact[] = [
  fact("f1", "LINE", "Never bring up Jamie."),
  fact("f2", "EVENT", "Moved home from Lisbon.", {
    attributes: { kind: "moved" },
    validAt: new Date("2026-09-28T00:00:00Z"),
  }),
  fact("f3", "EVENT", "Starts a new job at the hospital.", {
    attributes: { kind: "new_job" },
    validAt: new Date("2026-10-12T00:00:00Z"),
  }),
  fact("f4", "SKILL", "Makes ceramics.", { attributes: { level: "serious" } }),
];

/** The page, rendered by the engine. */
export const examplePage: string =
  renderBrief(exampleLens, {
    person: examplePerson,
    summary: "",
    facts: exampleFacts,
    at: AT,
  }) ?? "";

/** The asks still open, decided by the engine. */
export const exampleGaps = gapsFor(exampleLens, examplePerson, exampleFacts, AT);

/**
 * A routing field is the client's business. The engine noticed the move and
 * wants to set `city`, but it proposes rather than writes.
 */
export const exampleProposal = { field: "city", value: "home", kind: "field" } as const;

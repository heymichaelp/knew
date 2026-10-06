import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compileLens, compileVocabulary, fromLegacyLens, gapsFor, mustHonorFrom, parseLensDefinition, parseVocabularyDefinition, renderBrief, type Fact } from "../src/index.ts";

/**
 * The move from 0.x is mechanical, and this is the proof: the 0.x fixture lens, split, renders the
 * page 0.2.1 rendered and reports the gaps 0.2.1 reported, byte for byte. The strings below were
 * captured from 0.2.1 before the split and are never regenerated from the code they check.
 */

/** The fixture lens exactly as 0.2.1 shipped it. */
const LEGACY_FIXTURE = {
  "id": "fixture",
  "version": 1,
  "factTypes": {
    "LINE": {
      "description": "A line never to cross.",
      "section": "never-cross",
      "pinned": true,
      "enduring": true
    },
    "HAS": {
      "description": "Something they already have.",
      "section": "has",
      "pinned": true
    },
    "SKILL": {
      "description": "A pursuit with a depth claim.",
      "section": "has",
      "enduring": true,
      "attributes": [
        {
          "name": "level",
          "kind": "enum",
          "values": [
            "beginner",
            "serious",
            "expert"
          ]
        }
      ]
    },
    "LIKES": {
      "description": "An interest, with no claim about depth.",
      "section": "likes"
    },
    "EVENT": {
      "description": "A dated change in circumstance.",
      "section": "life",
      "attributes": [
        {
          "name": "kind",
          "kind": "enum",
          "values": [
            "moved",
            "new_job",
            "other"
          ]
        }
      ]
    },
    "CIRCUMSTANCE": {
      "description": "How their life is arranged for now.",
      "section": "life"
    },
    "PERSON": {
      "description": "Someone in their life.",
      "section": "people"
    },
    "OTHER": {
      "description": "A statement worth keeping that fits no other type.",
      "section": "other"
    }
  },
  "briefSections": [
    {
      "section": "never-cross",
      "heading": "Never cross"
    },
    {
      "section": "has",
      "heading": "Already has"
    },
    {
      "section": "likes",
      "heading": "Likes"
    },
    {
      "section": "life",
      "heading": "Life"
    },
    {
      "section": "people",
      "heading": "People"
    },
    {
      "section": "other",
      "heading": "Other"
    }
  ],
  "briefHeader": "What we know about {who}:",
  "overHeading": "No longer the case",
  "fallbackType": "OTHER",
  "sourceLabels": {
    "note": "a note they wrote"
  },
  "routingFields": [
    "relationship",
    "city"
  ],
  "promptFields": [
    "relationship"
  ],
  "briefAttributeTags": [
    "level"
  ],
  "charter": "# Charter\n\nKeep what would change how you treat this person next time.\n",
  "asks": [
    {
      "id": "what-they-love",
      "question": "What do they love doing, and how deeply?",
      "answeredBy": [
        "LIKES",
        "SKILL"
      ]
    },
    {
      "id": "how-the-days-go",
      "question": "What do their days allow, living where they do?",
      "when": [
        {
          "field": "relationship",
          "equals": [
            "mother",
            "father"
          ]
        }
      ],
      "answeredBy": [
        "CIRCUMSTANCE"
      ]
    }
  ]
};

/** What 0.2.1 rendered for the scenario below. */
const RENDERED_BY_0_2_1 = {
  full: "What we know about Linda (mother):\n\nA retired teacher who took up ceramics.\n\nNever cross:\n- Never bring up Jamie. (told us 2026-03-02)\n\nAlready has:\n- Throws pots on a wheel [serious] (told us 3 times, first 2026-01-15)\n- Owns a good pour-over setup and a burr grinder (told us 2025-11-20)\n\nLikes:\n- Paints tiles (told us 2026-04-20)\n\nLife:\n- Moved home from Lisbon (since 2026-09; told us 2026-10-04)\n- Works days at the hospital, no more nights (since 2026-10; told us 2026-10-04)\n\nPeople:\n- Her sister Carol lives nearby (told us 2026-02-11)\n\nOther:\n- Prefers a phone call to a text (told us 2026-05-05)\n- A fact of a type the lens no longer has (told us 2025-06-01)\n\nNo longer the case:\n- Spending six months in Lisbon from May (since 2026-05; until 2026-09; told us 2026-04-20)",
  tight: "What we know about Linda (mother):\n\nA retired teacher who took up ceramics.\n\nNever cross:\n- Never bring up Jamie. (told us 2026-03-02)\n\nAlready has:\n- Owns a good pour-over setup and a burr grinder (told us 2025-11-20)\n\nLikes:\n- Paints tiles (told us 2026-04-20)\n\nLife:\n- Moved home from Lisbon (since 2026-09; told us 2026-10-04)\n\n(+6 older facts not shown)",
  noSummaryFriend: "What we know about Al (friend):\n\nLikes:\n- Paints tiles (told us 2026-04-20)\n\nLife:\n- Moved home from Lisbon (since 2026-09; told us 2026-10-04)\n\nNo longer the case:\n- Spending six months in Lisbon from May (since 2026-05; until 2026-09; told us 2026-04-20)",
};

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
  episodeIds: ["e1"],
  ...extra,
});

const facts: Fact[] = [
  fact("LINE", "Never bring up Jamie.", "2026-03-02"),
  fact("HAS", "Owns a good pour-over setup and a burr grinder", "2025-11-20"),
  fact("SKILL", "Throws pots on a wheel", "2026-01-15", { attributes: { level: "serious" }, episodeIds: ["e1", "e2", "e3"] }),
  fact("LIKES", "Paints tiles", "2026-04-20"),
  fact("EVENT", "Moved home from Lisbon", "2026-10-04", { attributes: { kind: "moved" }, validAt: at("2026-09-28T00:00:00Z") }),
  fact("CIRCUMSTANCE", "Spending six months in Lisbon from May", "2026-04-20", { validAt: at("2026-05-01T00:00:00Z"), invalidAt: at("2026-09-28T00:00:00Z") }),
  fact("CIRCUMSTANCE", "Works days at the hospital, no more nights", "2026-10-04", { validAt: at("2026-10-12T00:00:00Z") }),
  fact("PERSON", "Her sister Carol lives nearby", "2026-02-11"),
  fact("RETIRED_TYPE", "A fact of a type the lens no longer has", "2025-06-01"),
  fact("OTHER", "Prefers a phone call to a text", "2026-05-05"),
];
const linda = { name: "Linda", fields: { relationship: "mother", city: "Austin" } };
const now = at("2026-10-05T00:00:00Z");

describe("Scenario: A 0.x lens splits into a vocabulary and a lens that read exactly as it did", () => {
  const split = fromLegacyLens(LEGACY_FIXTURE);
  const vocabulary = compileVocabulary(parseVocabularyDefinition(split.vocabulary));
  const lens = compileLens(parseLensDefinition(split.lens), vocabulary);

  it("moves each field to its 1.0 home", () => {
    assert.deepEqual(Object.keys(split.vocabulary.dimensions), ["never-cross", "has", "likes", "life", "people", "other"]);
    assert.equal(split.vocabulary.dimensions["has"]!.label, "Already has");
    assert.equal(split.vocabulary.factTypes.SKILL!.dimension, "has");
    assert.deepEqual(split.vocabulary.fields, ["relationship", "city"]);
    assert.equal(split.vocabulary.kind, "person");
    assert.deepEqual([split.lens.vocabulary, split.lens.header, split.lens.attributeTags], ["fixture", "What we know about {who}:", ["level"]]);
    assert.equal(split.lens.sections, undefined, "the sections are the dimensions, so the lens leaves them to the default");
    assert.equal(split.lens.pinned, undefined, "and the pinned types are the vocabulary's");
  });

  it("renders the page 0.2.1 rendered, byte for byte", () => {
    assert.equal(renderBrief(lens, { entity: linda, summary: "A retired teacher who took up ceramics.", facts, at: now }), RENDERED_BY_0_2_1.full);
    assert.equal(renderBrief(lens, { entity: linda, summary: "A retired teacher who took up ceramics.", facts, at: now, maxChars: 420 }), RENDERED_BY_0_2_1.tight);
    assert.equal(
      renderBrief(lens, { entity: { name: "Al", fields: { relationship: "friend" } }, summary: "", facts: facts.slice(3, 6), at: now }),
      RENDERED_BY_0_2_1.noSummaryFriend,
    );
  });

  it("honors what 0.2.1 honored and reports the gaps it reported", () => {
    assert.deepEqual(mustHonorFrom(lens, facts, now), [
  {
    "type": "LINE",
    "fact": "Never bring up Jamie."
  },
  {
    "type": "HAS",
    "fact": "Owns a good pour-over setup and a burr grinder"
  }
]);
    const ids = (fields: Record<string, string | null>, ledger: Fact[]) => gapsFor(lens, { fields }, ledger, now).map((g) => g.id);
    assert.deepEqual(ids({ relationship: "mother" }, []), [
  "what-they-love",
  "how-the-days-go"
]);
    assert.deepEqual(ids({ relationship: "mother" }, facts), []);
    assert.deepEqual(ids({ relationship: "Mother " }, [facts[3]!]), [
  "how-the-days-go"
]);
    assert.deepEqual(ids({ relationship: "friend" }, []), [
  "what-they-love"
]);
    assert.deepEqual(ids({}, [facts[6]!]), [
  "what-they-love"
]);
    assert.deepEqual(ids({ relationship: "mother" }, [facts[5]!]), [
  "what-they-love",
  "how-the-days-go"
]);
    assert.deepEqual(
      gapsFor(lens, { fields: { relationship: "mother" } }, [], now).map(({ id, question, answeredBy }) => ({ id, question, answeredBy })),
      [
  {
    "id": "what-they-love",
    "question": "What do they love doing, and how deeply?",
    "answeredBy": [
      "LIKES",
      "SKILL"
    ]
  },
  {
    "id": "how-the-days-go",
    "question": "What do their days allow, living where they do?",
    "answeredBy": [
      "CIRCUMSTANCE"
    ]
  }
],
    );
  });

  it("slugs a 0.x section id a dimension cannot carry, drops a section no type uses, and names a type it cannot place", () => {
    const odd = fromLegacyLens({
      ...LEGACY_FIXTURE,
      factTypes: { ...LEGACY_FIXTURE.factTypes, OTHER: { ...LEGACY_FIXTURE.factTypes.OTHER, section: "Odds & Ends" } },
      briefSections: [...LEGACY_FIXTURE.briefSections.filter((s) => s.section !== "other"), { section: "Odds & Ends", heading: "Other" }, { section: "empty", heading: "Nothing" }],
    });
    assert.equal(odd.vocabulary.factTypes.OTHER!.dimension, "section-odds-ends");
    assert.equal(odd.vocabulary.dimensions["section-odds-ends"]!.label, "Other");
    assert.ok(!("empty" in odd.vocabulary.dimensions));
    parseVocabularyDefinition(odd.vocabulary);

    const lost = fromLegacyLens({ ...LEGACY_FIXTURE, factTypes: { ...LEGACY_FIXTURE.factTypes, LOST: { description: "x", section: "limbo" } } });
    assert.throws(() => parseVocabularyDefinition(lost.vocabulary), /LOST informs dimension limbo/);
  });

  it("keeps a lens with no asks asking nothing, rather than every dimension's question", () => {
    const { asks: _asks, ...noAsks } = LEGACY_FIXTURE;
    const split = fromLegacyLens(noAsks);
    assert.deepEqual(split.lens.asks, []);
    const quiet = compileLens(parseLensDefinition(split.lens), compileVocabulary(parseVocabularyDefinition(split.vocabulary)));
    assert.deepEqual(quiet.asks, []);
  });
});

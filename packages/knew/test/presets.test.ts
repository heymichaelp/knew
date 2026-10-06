import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  compileLens,
  compileVocabulary,
  extendLens,
  extendVocabulary,
  lensProblems,
  parseVocabularyDefinition,
  readinessFor,
  type Fact,
} from "../src/index.ts";
import { person } from "../src/presets.ts";

const at = (iso: string) => new Date(iso);
let n = 0;
const fact = (type: string, text: string, said: string): Fact => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
  entityId: "sam",
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
});

describe("Scenario: The person preset is a vocabulary and a lens a client can use as they stand", () => {
  const vocabulary = compileVocabulary(parseVocabularyDefinition(person.vocabulary()));

  it("is a valid vocabulary of fourteen types across nine dimensions, each but the fallback's with a question", () => {
    assert.equal(vocabulary.kind, "person");
    assert.equal(vocabulary.factTypeKeys.length, 14);
    assert.deepEqual(vocabulary.dimensions.map((d) => d.id), ["avoid", "ahead", "life", "work", "people", "pursuits", "has", "background", "other"]);
    assert.deepEqual(vocabulary.dimensions.filter((d) => d.question === null).map((d) => d.id), ["other"]);
    assert.deepEqual(
      vocabulary.factTypeKeys.filter((key) => vocabulary.factTypes[key]!.revisitAfterDays !== null).map((key) => [key, vocabulary.factTypes[key]!.revisitAfterDays]),
      [
        ["CIRCUMSTANCE", 180],
        ["RITUAL", 365],
        ["WORK", 365],
      ],
    );
    assert.deepEqual(vocabulary.factTypeKeys.filter((key) => vocabulary.factTypes[key]!.pinned), ["AVOID", "HAS"]);
    assert.deepEqual(person.PRESET, { id: "person", version: 1 });
  });

  it("comes with a starter lens that asks the coarse things first", () => {
    assert.deepEqual(lensProblems(person.lens(), vocabulary), []);
    const lens = compileLens(person.lens(), vocabulary);
    assert.equal(lens.objective, "Know them well enough to meet them well next time.");
    const readiness = readinessFor(lens, { fields: {} }, [], at("2026-10-05T00:00:00Z"));
    assert.deepEqual(readiness.next.map((s) => s.ask), ["work", "people", "life", "background", "pursuits", "ahead", "has", "avoid"]);
    assert.equal(readiness.next[0]!.question, "What do they do?");
  });

  it("hands out a fresh copy every time, so a client's edits never reach another's", () => {
    const mine = person.vocabulary();
    mine.factTypes.WORK!.description = "changed";
    assert.notEqual(person.vocabulary().factTypes.WORK!.description, "changed");
  });
});

describe("Scenario: A client extends a preset, saying only what differs", () => {
  it("adds a type and a dimension, switches a window off, drops what it has no use for, and records every change", () => {
    const extended = extendVocabulary(person.vocabulary(), {
      id: "relationships",
      version: 1,
      factTypes: {
        CONTEXT: { description: "How the two of you know each other.", dimension: "context", enduring: true },
        CIRCUMSTANCE: { revisitAfterDays: null },
        HAS: null,
      },
      dimensions: { context: { label: "How you know each other", question: "Where did you meet?" }, has: null },
      charter: "# Our charter\n\nKeep what helps the next conversation.\n",
    });
    assert.deepEqual([extended.id, extended.version, extended.kind], ["relationships", 1, "person"]);
    assert.ok("CONTEXT" in extended.factTypes);
    assert.ok(!("HAS" in extended.factTypes) && !("has" in extended.dimensions));
    assert.equal(extended.factTypes.CIRCUMSTANCE!.revisitAfterDays, undefined, "null removes the preset's window");
    assert.equal(extended.factTypes.CIRCUMSTANCE!.description, person.vocabulary().factTypes.CIRCUMSTANCE!.description, "the rest of the type is the preset's");
    assert.equal(extended.charter, "# Our charter\n\nKeep what helps the next conversation.\n");
    assert.deepEqual(extended.basedOn, { preset: "person", version: 1, changed: ["CIRCUMSTANCE", "HAS", "has"] }, "an addition is not a change");
    assert.deepEqual(Object.keys(extended.dimensions).slice(-1), ["context"], "a new dimension goes last");
  });

  it("carries the preset through an extension of an extension, and keeps counting what changed", () => {
    const first = extendVocabulary(person.vocabulary(), { id: "mine", version: 1, factTypes: { WORK: { revisitAfterDays: 90 } } });
    const second = extendVocabulary(first, { id: "mine", version: 2, factTypes: { TASTE: { description: "What they like, in their words." } } });
    assert.deepEqual(second.basedOn, { preset: "person", version: 1, changed: ["TASTE", "WORK"] });
  });

  it("refuses a result that is not a vocabulary, naming why", () => {
    assert.throws(() => extendVocabulary(person.vocabulary(), { id: "mine", version: 1, dimensions: { work: null } }), /WORK informs dimension work/);
    assert.throws(() => extendVocabulary(person.vocabulary(), { id: "mine", version: 1, factTypes: { NEW: { dimension: "other" } } }));
    assert.throws(() => extendVocabulary(person.vocabulary(), { id: "mine", version: 1, factTypes: { AVOID: { revisitAfterDays: 30 } } }), /AVOID is enduring/);
  });

  it("extends the starter lens into one of the client's own, for another objective, and reads the same facts through it", () => {
    const vocabulary = compileVocabulary(
      extendVocabulary(person.vocabulary(), {
        id: "relationships",
        version: 1,
        factTypes: { CONTEXT: { description: "How the two of you know each other.", dimension: "context", enduring: true } },
        dimensions: { context: { label: "How you know each other", question: "Where did you meet?" } },
      }),
    );
    const prep = extendLens(person.lens(), {
      id: "prep",
      version: 1,
      vocabulary: "relationships",
      objective: "Walk into the next conversation ready.",
      asks: {
        ahead: { weight: 3 },
        pursuits: { weight: 2, enough: 2, after: ["work"] },
        avoid: null,
        context: { dimension: "context" },
      },
    });
    assert.deepEqual(prep.asks!.map((a) => a.id), ["work", "people", "life", "background", "pursuits", "ahead", "has", "context"]);
    const lens = compileLens(prep, vocabulary);
    const facts = [fact("INTEREST", "Training for a marathon in October", "2026-09-01")];
    const readiness = readinessFor(lens, { fields: {} }, facts, at("2026-10-05T00:00:00Z"));
    assert.deepEqual(readiness.next.slice(0, 2).map((s) => [s.ask, s.value]), [["ahead", 3], ["work", 1]]);
    const pursuits = readiness.asks.find((a) => a.id === "pursuits")!;
    assert.deepEqual([pursuits.state, pursuits.waitingOn, pursuits.strength], ["waiting", ["work"], 0.5]);
    assert.equal(readiness.dimensions.find((d) => d.id === "pursuits")!.facts, 1);
  });

  it("refuses a lens extension that leaves an ask waiting on one it dropped, and clears what it sets to null", () => {
    const base = extendLens(person.lens(), { id: "lens-a", version: 1, asks: { pursuits: { after: ["work"] } } });
    assert.throws(() => extendLens(base, { id: "lens-b", version: 1, asks: { work: null } }), /waits on work, which is not an ask/);
    const plain = extendLens(base, { id: "lens-c", version: 1, objective: null, asks: { pursuits: { after: null } } });
    assert.equal(plain.objective, undefined);
    assert.equal(plain.asks!.find((a) => a.id === "pursuits")!.after, undefined);
  });
});

describe("Scenario: The core names no domain; the presets are the only place content lives", () => {
  it("finds none of the person preset's type keys in the code of the core", () => {
    const src = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
    const keys = Object.keys(person.vocabulary().factTypes);
    const core = readdirSync(src).filter((name) => name.endsWith(".ts") && !["testing.ts", "contract.ts", "presets.ts"].includes(name));
    for (const file of core) {
      const code = readFileSync(join(src, file), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");
      for (const key of keys) assert.doesNotMatch(code, new RegExp(`\\b${key}\\b`), `${file} names ${key}, which belongs to a preset`);
    }
  });
});

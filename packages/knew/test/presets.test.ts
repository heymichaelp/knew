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
import * as presets from "../src/presets.ts";
import { person, place, product } from "../src/presets.ts";

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

  it("is a valid vocabulary of fourteen types across nine dimensions", () => {
    assert.equal(vocabulary.kind, "person");
    assert.equal(vocabulary.factTypeKeys.length, 14);
    assert.deepEqual(vocabulary.dimensions.map((d) => d.id), ["avoid", "ahead", "life", "work", "people", "pursuits", "has", "background", "other"]);
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

  it("comes with a starter lens whose directions run coarse to fine", () => {
    assert.deepEqual(lensProblems(person.lens(), vocabulary), []);
    const lens = compileLens(person.lens(), vocabulary);
    assert.equal(lens.objective, "Know them well enough to meet them well next time.");
    const readiness = readinessFor(lens, { fields: {} }, [], at("2026-10-05T00:00:00Z"));
    assert.deepEqual(readiness.next.map((s) => s.need), ["work", "people", "life", "background", "pursuits", "ahead", "has", "avoid"]);
    assert.deepEqual([readiness.next[0]!.kind, readiness.next[0]!.label], ["learn", "Work"]);
  });

  it("hands out a fresh copy every time, so a client's edits never reach another's", () => {
    const mine = person.vocabulary();
    mine.factTypes.WORK!.description = "changed";
    assert.notEqual(person.vocabulary().factTypes.WORK!.description, "changed");
  });
});

describe("Scenario: The place and product presets stand as they are, as person does", () => {
  const cases = [
    {
      preset: place,
      types: 12,
      dimensions: ["caution", "what", "where", "when", "offer", "feel", "people", "history", "other"],
      windows: [["CAUTION", 365], ["HOURS", 30], ["BUSY", 90], ["OFFER", 180], ["PRICE", 365]],
      pinned: ["CAUTION"],
      first: "What it is",
    },
    {
      preset: product,
      types: 9,
      dimensions: ["caution", "what", "details", "standing", "origin", "care", "opinion", "other"],
      windows: [["OWNERSHIP", 365], ["CONDITION", 180], ["CARE", 365]],
      pinned: ["CAUTION"],
      first: "What it is",
    },
  ] as const;

  for (const { preset, types, dimensions, windows, pinned, first } of cases) {
    it(`is a valid ${preset.PRESET.id} vocabulary of ${types} types, with a starter lens that compiles against it and needs every dimension but the fallback's`, () => {
      const vocabulary = compileVocabulary(parseVocabularyDefinition(preset.vocabulary()));
      assert.deepEqual([vocabulary.id, vocabulary.version, vocabulary.kind], [preset.PRESET.id, 1, preset.PRESET.id]);
      assert.equal(vocabulary.factTypeKeys.length, types);
      assert.deepEqual(vocabulary.dimensions.map((d) => d.id), dimensions);
      assert.deepEqual(
        vocabulary.factTypeKeys.filter((key) => vocabulary.factTypes[key]!.revisitAfterDays !== null).map((key) => [key, vocabulary.factTypes[key]!.revisitAfterDays]),
        windows,
      );
      assert.deepEqual(vocabulary.factTypeKeys.filter((key) => vocabulary.factTypes[key]!.pinned), pinned);
      assert.deepEqual(lensProblems(preset.lens(), vocabulary), []);
      const readiness = readinessFor(compileLens(preset.lens(), vocabulary), { fields: {} }, [], at("2026-10-05T00:00:00Z"));
      assert.equal(readiness.next[0]!.label, first, "the coarse thing first");
      assert.deepEqual(readiness.needs.map((n) => n.dimension).sort(), dimensions.filter((d) => d !== "other").sort(), "every dimension but the fallback's is a need");
    });
  }

  it("hands out fresh copies, and extends like any preset, stamped with its own name", () => {
    const mine = place.vocabulary();
    mine.factTypes.HOURS!.revisitAfterDays = 7;
    assert.equal(place.vocabulary().factTypes.HOURS!.revisitAfterDays, 30);
    const haunts = extendVocabulary(place.vocabulary(), { id: "haunts", version: 1, factTypes: { HOURS: { revisitAfterDays: 14 } } });
    assert.deepEqual(haunts.basedOn, { preset: "place", version: 1, changed: ["HOURS"], added: [] });
    const gear = extendVocabulary(product.vocabulary(), { id: "gear", version: 1, factTypes: { CARE: null }, dimensions: { care: null } });
    assert.deepEqual(gear.basedOn, { preset: "product", version: 1, changed: ["CARE", "care"], added: [] });
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
      dimensions: { context: { label: "How you know each other" }, has: null },
      charter: "# Our charter\n\nKeep what helps the next conversation.\n",
    });
    assert.deepEqual([extended.id, extended.version, extended.kind], ["relationships", 1, "person"]);
    assert.ok("CONTEXT" in extended.factTypes);
    assert.ok(!("HAS" in extended.factTypes) && !("has" in extended.dimensions));
    assert.equal(extended.factTypes.CIRCUMSTANCE!.revisitAfterDays, undefined, "null removes the preset's window");
    assert.equal(extended.factTypes.CIRCUMSTANCE!.description, person.vocabulary().factTypes.CIRCUMSTANCE!.description, "the rest of the type is the preset's");
    assert.equal(extended.charter, "# Our charter\n\nKeep what helps the next conversation.\n");
    assert.deepEqual(
      extended.basedOn,
      { preset: "person", version: 1, changed: ["CIRCUMSTANCE", "HAS", "has"], added: ["CONTEXT", "context"] },
      "an addition is recorded as one, not as a change",
    );
    assert.deepEqual(Object.keys(extended.dimensions).slice(-1), ["context"], "a new dimension goes last");
  });

  it("carries the preset through an extension of an extension, and keeps counting what changed", () => {
    const first = extendVocabulary(person.vocabulary(), { id: "mine", version: 1, factTypes: { WORK: { revisitAfterDays: 90 } } });
    const second = extendVocabulary(first, { id: "mine", version: 2, factTypes: { TASTE: { description: "What they like, in their words." } } });
    assert.deepEqual(second.basedOn, { preset: "person", version: 1, changed: ["TASTE", "WORK"], added: [] });
  });

  it("never reports the client's own additions as changes to the preset, and treats a false flag as no flag", () => {
    const first = extendVocabulary(person.vocabulary(), {
      id: "mine",
      version: 1,
      factTypes: { CONTEXT: { description: "How the two of you know each other.", dimension: "context" } },
      dimensions: { context: { label: "How you know each other" } },
    });
    const second = extendVocabulary(first, {
      id: "mine",
      version: 2,
      factTypes: { CONTEXT: { enduring: true }, WORK: { pinned: false } },
    });
    assert.deepEqual(second.basedOn, { preset: "person", version: 1, changed: [], added: ["CONTEXT", "context"] });
    const third = extendVocabulary(second, { id: "mine", version: 3, factTypes: { CONTEXT: null }, dimensions: { context: null } });
    assert.deepEqual(third.basedOn, { preset: "person", version: 1, changed: [], added: [] }, "dropping an addition just un-adds it");
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
        dimensions: { context: { label: "How you know each other" } },
      }),
    );
    const prep = extendLens(person.lens(), {
      id: "prep",
      version: 1,
      vocabulary: "relationships",
      objective: "Walk into the next conversation ready.",
      needs: {
        ahead: { weight: 3 },
        pursuits: { weight: 2, enough: 2, after: ["work"] },
        avoid: null,
        context: { dimension: "context" },
      },
    });
    assert.deepEqual(prep.needs!.map((a) => a.id), ["work", "people", "life", "background", "pursuits", "ahead", "has", "context"]);
    const lens = compileLens(prep, vocabulary);
    const facts = [fact("INTEREST", "Training for a marathon in October", "2026-09-01")];
    const readiness = readinessFor(lens, { fields: {} }, facts, at("2026-10-05T00:00:00Z"));
    assert.deepEqual(readiness.next.slice(0, 2).map((s) => [s.need, s.value]), [["ahead", 3], ["work", 1]]);
    const pursuits = readiness.needs.find((a) => a.id === "pursuits")!;
    assert.deepEqual([pursuits.state, pursuits.waitingOn, pursuits.strength], ["waiting", ["work"], 0.5]);
    assert.equal(readiness.dimensions.find((d) => d.id === "pursuits")!.facts, 1);
  });

  it("patches a lens that leaves its needs to the dimensions, once it is handed the vocabulary", () => {
    const implicit = { id: "plain", version: 1, vocabulary: "person", header: "About {who}:", overHeading: "Over" };
    assert.throws(() => extendLens(implicit, { id: "mine", version: 1, needs: { work: { weight: 3 } } }), /pass person as the third argument/);
    const vocabulary = person.vocabulary();
    const weighted = extendLens(implicit, { id: "mine", version: 1, needs: { work: { weight: 3 }, other: { label: "Anything else?", dimension: "other" } } }, vocabulary);
    assert.deepEqual(
      weighted.needs!.map((a) => [a.id, a.weight ?? 1]),
      [["avoid", 1], ["ahead", 1], ["life", 1], ["work", 3], ["people", 1], ["pursuits", 1], ["has", 1], ["background", 1], ["other", 1]],
      "the defaults are written out, patched by id, and a new need goes last",
    );
    const fewer = extendLens(implicit, { id: "mine", version: 1, needs: { avoid: null } }, vocabulary);
    assert.equal(fewer.needs!.length, 8, "dropping one default keeps the other eight");
    assert.throws(() => extendLens(implicit, { id: "mine", version: 1, vocabulary: "elsewhere", needs: { work: { weight: 3 } } }, vocabulary), /reads vocabulary elsewhere/);
  });

  it("refuses a lens extension that leaves a need waiting on one it dropped, and clears what it sets to null", () => {
    const base = extendLens(person.lens(), { id: "lens-a", version: 1, needs: { pursuits: { after: ["work"] } } });
    assert.throws(() => extendLens(base, { id: "lens-b", version: 1, needs: { work: null } }), /waits on work, which is not a need/);
    const plain = extendLens(base, { id: "lens-c", version: 1, objective: null, needs: { pursuits: { after: null } } });
    assert.equal(plain.objective, undefined);
    assert.equal(plain.needs!.find((a) => a.id === "pursuits")!.after, undefined);
  });
});

describe("Scenario: The core names no domain; the presets are the only place content lives", () => {
  it("finds none of any preset's type keys in the code of the core", () => {
    const src = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
    const keys = [...new Set(Object.values(presets).flatMap((preset) => Object.keys(preset.vocabulary().factTypes)))];
    assert.ok(keys.includes("HOURS") && keys.includes("IDENTITY"), "every preset's keys, not only person's");
    const core = readdirSync(src).filter((name) => name.endsWith(".ts") && !["testing.ts", "contract.ts", "presets.ts"].includes(name));
    for (const file of core) {
      const code = readFileSync(join(src, file), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");
      for (const key of keys) assert.doesNotMatch(code, new RegExp(`\\b${key}\\b`), `${file} names ${key}, which belongs to a preset`);
    }
  });
});

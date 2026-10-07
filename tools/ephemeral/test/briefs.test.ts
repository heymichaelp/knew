import assert from "node:assert/strict";
import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import type { CheckResult } from "../kit/check-kit.ts";
import { briefLeaks, briefNames, loadBrief } from "../src/brief.ts";
import { checkInProcess } from "../src/check.ts";
import { packageNames } from "../src/names.ts";
import { WORKSPACE } from "../src/prep.ts";

/**
 * The briefs, held to what makes a run mean something: each names no API, each
 * tells the agent every id its checker relies on, each reference passes its
 * own checker, and each checker fails the reference broken in the ways it
 * claims to catch. The site's drift guards, applied to the briefs.
 */

/** What a brief must not say: every runtime export of the package's three entry points, and every property of its two definition schemas. */
const API = packageNames();

const failures = (result: CheckResult) =>
  result.checks
    .filter((item) => !item.passed)
    .map((item) => `${item.name}: ${item.detail}`)
    .join("\n") || "every check passed";

describe("Scenario: The leak check tells a name from a word", () => {
  it("flags a distinctive name anywhere, an ordinary word only as code, and never the words of a path", () => {
    const names = ["readinessFor", "ENGINE_DEFAULTS", "after", "vocabulary"];
    assert.deepEqual(briefLeaks("Call readinessFor, then wait until after lunch.", names, new Set()), ["readinessFor"]);
    assert.deepEqual(briefLeaks("Set `after` from ENGINE_DEFAULTS.", names, new Set()), ["ENGINE_DEFAULTS", "after"]);
    assert.deepEqual(briefLeaks("Write `definitions/vocabulary.json`, the vocabulary.", names, new Set()), []);
    assert.deepEqual(briefLeaks("Return `{ after }`.", names, new Set(["after"])), []);
  });

  it("knows the package's names: its exports, its presets, its test kit and its schemas' fields", () => {
    for (const name of ["readinessFor", "ENGINE_DEFAULTS", "person", "fakeIntelligence", "revisitAfterDays", "answeredBy", "after", "weight"]) {
      assert.ok(API.has(name), `${name} is missing from the names a brief must not say`);
    }
  });
});

for (const name of briefNames()) {
  describe(`Scenario: The ${name} brief is fit to hand an agent`, () => {
    const brief = loadBrief(name);
    const text = readFileSync(join(brief.dir, "BRIEF.md"), "utf8");

    it("names no API, only the product", () => {
      assert.deepEqual(briefLeaks(text, API, new Set(brief.allow)), [], "BRIEF.md says the package's names; say what the product needs instead");
    });

    it("allows only package names it actually says as code", () => {
      for (const allowed of brief.allow) {
        assert.ok(API.has(allowed), `${allowed} is not one of the package's names, so it needs no allowance`);
        assert.deepEqual(briefLeaks(text, [allowed], new Set()), [allowed], `${allowed} is allowed and never said as code`);
      }
    });

    it("tells the agent every id and type its checker relies on", () => {
      for (const id of [brief.pinned.vocabulary, ...brief.pinned.lenses, ...brief.pinned.types]) {
        assert.ok(text.includes(`\`${id}\``), `the checker relies on ${id}, and BRIEF.md never names it`);
      }
    });

    it("passes its own checker with its reference", async () => {
      const result = await checkInProcess(join(brief.dir, "reference"), name, { typecheck: false });
      assert.ok(result.passed, failures(result));
    });
  });
}

/** A reference, broken one way: which file, how, and the check that must fail. */
interface Mutation {
  what: string;
  file: string;
  edit: (text: string) => string;
  fails: string;
}

const swap = (from: string, to: string) => (text: string) => {
  assert.ok(text.includes(from), `the reference no longer reads ${JSON.stringify(from)}; update the mutation`);
  return text.replace(from, to);
};
const json =
  (change: (value: Record<string, any>) => void) =>
  (text: string): string => {
    const value = JSON.parse(text) as Record<string, any>;
    change(value);
    return `${JSON.stringify(value, null, 2)}\n`;
  };

const MUTATIONS: Record<string, Mutation[]> = {
  gifting: [
    {
      what: "the vocabulary is written from scratch",
      file: "definitions/vocabulary.json",
      edit: json((vocabulary) => delete vocabulary.basedOn),
      fails: "the vocabulary extends knew's person preset, keeping its types as they are",
    },
    {
      what: "a preset type is reworded",
      file: "definitions/vocabulary.json",
      edit: json((vocabulary) => (vocabulary.factTypes.HAS.description = "Something they own.")),
      fails: "the vocabulary extends knew's person preset, keeping its types as they are",
    },
    {
      what: "picks are shown at three things known",
      file: "definitions/lenses/gift.json",
      edit: json((lens) => (lens.asks.find((ask: { id: string }) => ask.id === "what-they-love").enough = 3)),
      fails: "picks wait for five things about what they love or want, in any mix",
    },
    {
      what: "wishes do not count toward picks",
      file: "definitions/lenses/gift.json",
      edit: json((lens) => (lens.asks.find((ask: { id: string }) => ask.id === "what-they-love").answeredBy = ["INTEREST", "SKILL", "TASTE"])),
      fails: "picks wait for five things about what they love or want, in any mix",
    },
    {
      what: "what they already have is only weighed",
      file: "definitions/lenses/gift.json",
      edit: json((lens) => (lens.pinned = ["AVOID"])),
      fails: "what to steer clear of and what they already have are rules to honor",
    },
    {
      what: "picks are shown as soon as anything is known",
      file: "src/app.ts",
      edit: swap(
        'const knowsEnough = readiness.asks.find((ask) => ask.id === KNOWS_ENOUGH)?.state === "met";',
        "const knowsEnough = (readiness.asks.find((ask) => ask.id === KNOWS_ENOUGH)?.facts ?? 0) > 0;",
      ),
      fails: "the fifth thing known turns asking into showing, and four is not enough",
    },
    {
      what: "the rules are left behind",
      file: "src/app.ts",
      edit: swap("honor: brief?.mustHonor.map((item) => item.fact) ?? []", "honor: []"),
      fails: "showing first hands over knew's page through the gift lens, and its rules",
    },
    {
      what: "the page is cut to fit",
      file: "src/app.ts",
      edit: swap("engine.brief(scope(userId), personId, { lens: LENS })", "engine.brief(scope(userId), personId, { lens: LENS, maxChars: 120 })"),
      fails: "showing first hands over knew's page through the gift lens, and its rules",
    },
  ],
  migrate: [
    {
      what: "the lens forgets its version",
      file: "definitions/lenses/regulars.json",
      edit: json((lens) => (lens.version = 1)),
      fails: "the definitions compile, keeping the 0.x lens's name and version",
    },
    {
      what: "a heading is spelled as its old section id",
      file: "definitions/vocabulary.json",
      edit: json((vocabulary) => (vocabulary.dimensions["section-never-send"].label = "Never Send")),
      fails: "every page reads exactly as 0.2.1 rendered it",
    },
    {
      what: "deliveries stop being honored",
      file: "definitions/vocabulary.json",
      edit: json((vocabulary) => delete vocabulary.factTypes.DELIVERY.pinned),
      fails: "an order must honor what it did on 0.2.1",
    },
    {
      what: "the standing-order question loses its tier condition",
      file: "definitions/lenses/regulars.json",
      edit: json((lens) => delete lens.asks.find((ask: { id: string }) => ask.id === "standing-order").when),
      fails: "the same questions are asked, worded the same, in the same order",
    },
    {
      what: "a note forgets its customer",
      file: "src/app.ts",
      edit: swap("        entityHints: [customerId],\n", ""),
      fails: "a note is read before addNote resolves, filed under its customer, and the card is knew's",
    },
    {
      what: "the tier never reaches knew",
      file: "src/app.ts",
      edit: swap("fields: { tier: customer.tier ?? null }", "fields: {}"),
      fails: "a wholesale customer is asked about a standing order, and a regular is not",
    },
    {
      what: "every shop shares one customer book",
      file: "src/app.ts",
      edit: swap("subjectId: shopId", 'subjectId: "stems"'),
      fails: "a shop's customers are its own",
    },
  ],
  places: [
    {
      what: "the vocabulary starts from knew's place preset",
      file: "definitions/vocabulary.json",
      edit: json((vocabulary) => (vocabulary.basedOn = { preset: "place", version: 1, changed: [], added: [] })),
      fails: "the vocabulary is Haunts' own, written from scratch",
    },
    {
      what: "hours never go stale",
      file: "definitions/vocabulary.json",
      edit: json((vocabulary) => delete vocabulary.factTypes.HOURS.revisitAfterDays),
      fails: "hours noted 45 days ago are due for a re-check",
    },
    {
      what: "hours go stale within a week",
      file: "definitions/vocabulary.json",
      edit: json((vocabulary) => (vocabulary.factTypes.HOURS.revisitAfterDays = 7)),
      fails: "hours noted 10 days ago are fine",
    },
    {
      what: "what it's like is asked before the kind is known",
      file: "definitions/lenses/visit.json",
      edit: json((lens) => delete lens.asks.find((ask: { id: string }) => ask.id === "what-its-like").after),
      fails: "what it's like waits for what kind of place it is",
    },
    {
      what: "a note's date is dropped",
      file: "src/app.ts",
      edit: swap("referenceAt: options.at ?? new Date(),", "referenceAt: new Date(),"),
      fails: "hours noted 45 days ago come back to be re-checked, in knew's words",
    },
    {
      what: "the next question passes over a re-check",
      file: "src/app.ts",
      edit: swap("const step = readiness?.next[0];", 'const step = readiness?.next.find((candidate) => candidate.kind === "ask");'),
      fails: "hours noted 45 days ago come back to be re-checked, in knew's words",
    },
    {
      what: "a note is left for the background sweep",
      file: "src/app.ts",
      edit: swap(
        "const outcome = await engine.extractNow(scope(userId), { maxEpisodes: 5, askedSourceRef: sourceRef });\n      if (outcome.askedIngested !== true) await engine.requestExtract(scope(userId));",
        "await engine.requestExtract(scope(userId));",
      ),
      fails: "a note is read before addNote resolves, filed under its place",
    },
    {
      what: "a note forgets which place it was written on",
      file: "src/app.ts",
      edit: swap("entityHints: [placeId],", ""),
      fails: "a note is read before addNote resolves, filed under its place",
    },
    {
      what: "every user shares one notebook",
      file: "src/app.ts",
      edit: swap("subjectId: userId", 'subjectId: "everyone"'),
      fails: "a notebook is its owner's alone",
    },
  ],
};

/** Inside the workspace, so a mutant resolves `@popjoker/knew` and tsx as the reference does. Gitignored. */
const MUTANTS = join(WORKSPACE, ".mutants");

describe("Scenario: Each checker fails its reference broken the ways it claims to catch", () => {
  before(() => rmSync(MUTANTS, { recursive: true, force: true }));
  after(() => rmSync(MUTANTS, { recursive: true, force: true }));

  it("has mutations for every brief", () => {
    for (const name of briefNames()) assert.ok((MUTATIONS[name]?.length ?? 0) > 0, `${name} has no mutations, so nothing shows its checker can fail`);
  });

  for (const [name, mutations] of Object.entries(MUTATIONS)) {
    mutations.forEach((mutation, index) => {
      it(`${name}: ${mutation.what}`, async () => {
        const dir = join(MUTANTS, `${name}-${index}`);
        cpSync(join(loadBrief(name).dir, "reference"), dir, { recursive: true });
        const path = join(dir, mutation.file);
        const before = readFileSync(path, "utf8");
        const after = mutation.edit(before);
        assert.notEqual(after, before, "the mutation changed nothing");
        writeFileSync(path, after);
        const result = await checkInProcess(dir, name, { typecheck: false, appTests: false });
        const item = result.checks.find((check) => check.name === mutation.fails);
        assert.ok(item, `the ${name} checker has no check named "${mutation.fails}"; it ran: ${result.checks.map((check) => check.name).join("; ")}`);
        assert.equal(item.passed, false, `"${mutation.fails}" passed with ${mutation.what}`);
      });
    });
  }
});

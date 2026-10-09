import assert from "node:assert/strict";
import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import type { CheckResult } from "../kit/check-kit.ts";
import { existsSync } from "node:fs";
import { briefLeaks, briefNames, changeFileOf, loadBrief, readingsOf, referenceOf, type Brief } from "../src/brief.ts";
import { checkInProcess, type Phase } from "../src/check.ts";
import { packageNames } from "../src/names.ts";
import { WORKSPACE, type Arm } from "../src/prep.ts";

/**
 * The briefs, held to what makes a run mean something: each names no API, each
 * tells the agent every id its checker relies on, each reference passes its
 * own checker, and each checker fails the reference broken in the ways it
 * claims to catch. The site's drift guards, applied to the briefs.
 */

/** What a brief must not say: every runtime export of the package's three entry points, and every property of its two definition schemas. */
const API = packageNames();

/** A reading brief's checks replay its recorded readings, in this process, and never call a model. */
function replaying(brief: Brief): void {
  if (!brief.reading) return;
  process.env.KNEW_READING = "replay";
  process.env.KNEW_READING_CACHE = readingsOf(brief);
}

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
    for (const name of ["readinessFor", "ENGINE_DEFAULTS", "person", "fakeIntelligence", "revisitAfterDays", "types", "after", "weight"]) {
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

    for (const arm of brief.arms) {
      for (const phase of brief.changes ? ([1, 2] as const) : ([1] as const)) {
        it(`passes its own checker with its ${arm} reference${phase === 2 ? ", after the change" : ""}`, async () => {
          replaying(brief);
          const result = await checkInProcess(referenceOf(brief, arm, phase), name, { typecheck: false, arm, phase });
          assert.ok(result.passed, failures(result));
        });
      }
    }

    if (brief.changes) {
      for (const arm of brief.arms) {
        const change = readFileSync(join(brief.dir, changeFileOf(arm)), "utf8");
        it(`hands the ${arm} arm a change that names no API${arm === "baseline" ? " and no knew" : ""}`, () => {
          assert.deepEqual(briefLeaks(change, API, new Set(brief.allow)), [], `${changeFileOf(arm)} says the package's names`);
          if (arm === "baseline") assert.doesNotMatch(change, /knew|@popjoker/i, `${changeFileOf(arm)} must not mention knew`);
        });
      }
      it("tells the agent every id the change adds that its checker relies on", () => {
        const change = readFileSync(join(brief.dir, "CHANGE.md"), "utf8");
        for (const id of [...(brief.change?.lenses ?? []), ...(brief.change?.types ?? [])]) {
          assert.ok(change.includes(`\`${id}\``), `the checker relies on ${id} after the change, and CHANGE.md never names it`);
        }
      });
    }

    if (brief.reading) {
      it("has its readings recorded, so its checks replay them and never call a model", () => {
        assert.ok(existsSync(readingsOf(brief)), `${name} reads notes for real and has no readings.json; record them with npm run record-readings -w @knew/ephemeral -- --brief ${name}`);
      });
    }

    if (brief.arms.includes("baseline")) {
      const baseline = readFileSync(join(brief.dir, "BASELINE.md"), "utf8");
      it("hands the baseline the same product, with no knew in it", () => {
        assert.doesNotMatch(baseline, /knew|@popjoker/i, "BASELINE.md is the product built without knew, so it must not mention it");
        assert.deepEqual(briefLeaks(baseline, API, new Set(brief.allow)), [], "BASELINE.md says the package's names");
      });
    }
  });
}

/** A reference, broken one way: which arm's reference (knew by default) and which phase's (1 by default), which file, how, and the check that must fail. */
interface Mutation {
  what: string;
  arm?: Arm;
  phase?: Phase;
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

const ENDED = "a statement that has ended is no longer known";
const CORRECTED = "a correction replaces what it corrected, and the earlier word is still known as of before it";
const REPEATED = "a repeated statement is known once, and counts as heard again";
const STALE = "hours not heard for 45 days come back to be re-checked, and hours from 10 days ago are fine";
const ORDERED = "with the kind and hours known, what it is like comes next, then what to order";
const DROPPED = "a note about a place nobody added is dropped, and stays dropped";
const ALONE = "a notebook is its owner's alone";
const PRICED = "a price is kept like any other statement";
const PRICE_LAST = "the visit view asks how much it costs last";
const TONIGHT_FIRST = "tonight starts with when it is open, whatever else is unknown, and a place never added has none";
const TONIGHT_ORDER = "tonight asks what it is like, then how much it costs, and never what kind of place it is or what to order";
const TONIGHT_STALE = "tonight re-checks hours not heard for 45 days";

const MUTATIONS: Record<string, Mutation[]> = {
  // Each reading mutation leaves every prompt the reader is shown as it was, so the recorded readings still answer.
  // A note about a place nobody added has no mutation: in both arms the reader itself returns nothing about a place
  // not on the list, so no app logic stands between that note and the probe to break.
  reading: [
    {
      what: "a statement past its end date is still known",
      file: "src/app.ts",
      edit: swap("factsTrueAt(view.facts, asOf).map(", "view.facts.map("),
      fails: "something with an end date stops being known after it",
    },
    {
      what: "a place never added reads as one with nothing known",
      file: "src/app.ts",
      edit: swap("if (!view) return null;", "if (!view) return [];"),
      fails: "a notebook is its owner's alone",
    },
    {
      what: "a correction is kept beside what it corrected",
      arm: "baseline",
      file: "src/app.ts",
      edit: swap("if (replaced) replaced.kept.replacedAt = at;", ""),
      fails: "a correction replaces the hours it corrects, and the old hours are still known as of before it",
    },
    {
      what: "a repeat is kept twice",
      arm: "baseline",
      file: "src/app.ts",
      edit: swap("if (statement.repeats !== null && current[statement.repeats]) continue;", ""),
      fails: "the same thing said again in other words is kept once",
    },
    {
      what: "every new statement replaces the last one on its topic",
      arm: "baseline",
      file: "src/app.ts",
      edit: swap(
        "        if (replaced) replaced.kept.replacedAt = at;",
        "        if (replaced) replaced.kept.replacedAt = at;\n        for (const kept of place.kept) if (kept.topic === statement.topic && holds(kept, at)) kept.replacedAt = at;",
      ),
      fails: "two different things about one topic are both kept",
    },
    {
      what: "an end date is ignored",
      arm: "baseline",
      file: "src/app.ts",
      edit: swap("until: statement.until ? new Date(statement.until) : null,", "until: null,"),
      fails: "something with an end date stops being known after it",
    },
    {
      what: "every user shares one notebook",
      arm: "baseline",
      file: "src/app.ts",
      edit: swap("let places = notebooks.get(userId);\n    if (!places) notebooks.set(userId, (places = new Map()));", 'let places = notebooks.get("everyone");\n    if (!places) notebooks.set("everyone", (places = new Map()));'),
      fails: "a notebook is its owner's alone",
    },
  ],
  notebook: [
    {
      what: "tonight asks what kind of place it is first",
      phase: 2,
      file: "definitions/lenses/tonight.json",
      edit: json((lens) => lens.needs.unshift({ id: "kind-of-place", dimension: "kind-of-place", weight: 4 })),
      fails: TONIGHT_FIRST,
    },
    {
      what: "tonight wants to know what to order",
      phase: 2,
      file: "definitions/lenses/tonight.json",
      edit: json((lens) => lens.needs.push({ id: "order", dimension: "order", weight: 0.25 })),
      fails: TONIGHT_ORDER,
    },
    {
      what: "the visit view never asks the price",
      phase: 2,
      file: "definitions/lenses/visit.json",
      edit: json((lens) => (lens.needs = lens.needs.filter((need: { id: string }) => need.id !== "price"))),
      fails: PRICE_LAST,
    },
    {
      what: "the price outranks what to order",
      phase: 2,
      file: "definitions/lenses/visit.json",
      edit: json((lens) => (lens.needs.find((need: { id: string }) => need.id === "price").weight = 2)),
      fails: ORDERED,
    },
    {
      what: "both views pass over a re-check",
      phase: 2,
      file: "src/app.ts",
      edit: swap("const direction = readiness?.next[0];", 'const direction = readiness?.next.find((candidate) => candidate.kind === "learn");'),
      fails: TONIGHT_STALE,
    },
    {
      what: "a price is dropped",
      arm: "baseline",
      phase: 2,
      file: "src/app.ts",
      edit: swap("        if (!place) continue;", '        if (!place || statement.topic === "PRICE") continue;'),
      fails: PRICED,
    },
    {
      what: "tonight asks what kind of place it is first",
      arm: "baseline",
      phase: 2,
      file: "src/app.ts",
      edit: swap('tonight: ["HOURS", "VIBE", "PRICE"],', 'tonight: ["KIND", "HOURS", "VIBE", "PRICE"],'),
      fails: TONIGHT_FIRST,
    },
    {
      what: "tonight wants to know what to order",
      arm: "baseline",
      phase: 2,
      file: "src/app.ts",
      edit: swap('tonight: ["HOURS", "VIBE", "PRICE"],', 'tonight: ["HOURS", "VIBE", "PRICE", "ORDER"],'),
      fails: TONIGHT_ORDER,
    },
    {
      what: "the visit view never asks the price",
      arm: "baseline",
      phase: 2,
      file: "src/app.ts",
      edit: swap('visit: ["KIND", "HOURS", "VIBE", "ORDER", "PRICE"],', 'visit: ["KIND", "HOURS", "VIBE", "ORDER"],'),
      fails: PRICE_LAST,
    },
    {
      what: "stale hours are never re-checked",
      arm: "baseline",
      phase: 2,
      file: "src/app.ts",
      edit: swap('if (topic === "HOURS" && !held.some(', 'if (topic === "NEVER" && !held.some('),
      fails: TONIGHT_STALE,
    },
    {
      what: "an ended statement is still known",
      file: "src/app.ts",
      edit: swap("factsTrueAt(view.facts, asOf).map((fact) => fact.fact)", "view.facts.map((fact) => fact.fact)"),
      fails: ENDED,
    },
    {
      what: "a note's date is dropped",
      file: "src/app.ts",
      edit: swap("referenceAt: options.at ?? new Date(),", "referenceAt: new Date(),"),
      fails: STALE,
    },
    {
      what: "the next direction passes over a re-check",
      file: "src/app.ts",
      edit: swap("const direction = readiness?.next[0];", 'const direction = readiness?.next.find((candidate) => candidate.kind === "learn");'),
      fails: STALE,
    },
    {
      what: "hours never go stale",
      file: "definitions/vocabulary.json",
      edit: json((vocabulary) => delete vocabulary.factTypes.HOURS.revisitAfterDays),
      fails: STALE,
    },
    {
      what: "what to order outranks what it is like",
      file: "definitions/lenses/visit.json",
      edit: json((lens) => (lens.needs.find((need: { id: string }) => need.id === "order").weight = 2)),
      fails: ORDERED,
    },
    {
      what: "a note is left for the background sweep",
      file: "src/app.ts",
      edit: swap(
        "const outcome = await engine.extractNow(scope(userId), { maxEpisodes: 5, askedSourceRef: sourceRef });\n      if (outcome.askedIngested !== true) await engine.requestExtract(scope(userId));",
        "await engine.requestExtract(scope(userId));",
      ),
      fails: "a note is kept under its place, as it was said",
    },
    {
      what: "a place never added reads as one with nothing known",
      file: "src/app.ts",
      edit: swap("if (!view) return null;", "if (!view) return [];"),
      fails: "a place never added is unknown, and a new place starts with what kind of place it is",
    },
    {
      what: "every user shares one notebook",
      file: "src/app.ts",
      edit: swap("subjectId: userId", 'subjectId: "everyone"'),
      fails: ALONE,
    },
    {
      what: "a correction is kept beside what it corrected",
      arm: "baseline",
      file: "src/app.ts",
      edit: swap("if (replaced) replaced.replacedAt = at;", ""),
      fails: CORRECTED,
    },
    {
      what: "a correction forgets what came before it",
      arm: "baseline",
      file: "src/app.ts",
      edit: swap("if (replaced) replaced.replacedAt = at;", "if (replaced) place.kept.splice(place.kept.indexOf(replaced), 1);"),
      fails: CORRECTED,
    },
    {
      what: "a repeat is kept twice",
      arm: "baseline",
      file: "src/app.ts",
      edit: swap("            if (at > repeated.heardAt) repeated.heardAt = at;\n            continue;", "            if (at > repeated.heardAt) repeated.heardAt = at;"),
      fails: REPEATED,
    },
    {
      what: "an ended statement is still known",
      arm: "baseline",
      file: "src/app.ts",
      edit: swap(" && (kept.until === null || kept.until > at)", ""),
      fails: ENDED,
    },
    {
      what: "a note about a place nobody added is kept for later",
      arm: "baseline",
      file: "src/app.ts",
      edit: swap(
        "const place = places.get(statement.placeId);\n        if (!place) continue;",
        "const place = places.get(statement.placeId) ?? places.set(statement.placeId, { name: statement.placeId, kept: [] }).get(statement.placeId)!;",
      ),
      fails: DROPPED,
    },
    {
      what: "hours never go stale",
      arm: "baseline",
      file: "src/app.ts",
      edit: swap("const STALE_AFTER_DAYS = 30;", "const STALE_AFTER_DAYS = Number.POSITIVE_INFINITY;"),
      fails: STALE,
    },
    {
      what: "a note's date is dropped",
      arm: "baseline",
      file: "src/app.ts",
      edit: swap("const at = options.at ?? new Date();", "const at = new Date();"),
      fails: STALE,
    },
    {
      what: "what to order comes before what it is like",
      arm: "baseline",
      file: "src/app.ts",
      edit: swap(
        '      if (of("VIBE").length === 0) return { about: LABEL.VIBE, recheck: [] };\n      if (of("ORDER").length === 0) return { about: LABEL.ORDER, recheck: [] };',
        '      if (of("ORDER").length === 0) return { about: LABEL.ORDER, recheck: [] };\n      if (of("VIBE").length === 0) return { about: LABEL.VIBE, recheck: [] };',
      ),
      fails: ORDERED,
    },
    {
      what: "every user shares one notebook",
      arm: "baseline",
      file: "src/app.ts",
      edit: swap("let places = notebooks.get(userId);\n    if (!places) notebooks.set(userId, (places = new Map()));", 'let places = notebooks.get("everyone");\n    if (!places) notebooks.set("everyone", (places = new Map()));'),
      fails: ALONE,
    },
  ],
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
      edit: json((lens) => (lens.needs.find((need: { id: string }) => need.id === "what-they-love").enough = 3)),
      fails: "picks wait for five things about what they love or want, in any mix",
    },
    {
      what: "wishes do not count toward picks",
      file: "definitions/lenses/gift.json",
      edit: json((lens) => (lens.needs.find((need: { id: string }) => need.id === "what-they-love").types = ["INTEREST", "SKILL", "TASTE"])),
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
        'const knowsEnough = readiness.needs.find((need) => need.id === KNOWS_ENOUGH)?.state === "met";',
        "const knowsEnough = (readiness.needs.find((need) => need.id === KNOWS_ENOUGH)?.facts ?? 0) > 0;",
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
      what: "what it's like comes before the kind is known",
      file: "definitions/lenses/visit.json",
      edit: json((lens) => delete lens.needs.find((need: { id: string }) => need.id === "what-its-like").after),
      fails: "what it's like waits for what kind of place it is",
    },
    {
      what: "a note's date is dropped",
      file: "src/app.ts",
      edit: swap("referenceAt: options.at ?? new Date(),", "referenceAt: new Date(),"),
      fails: "hours noted 45 days ago come back to be re-checked, in knew's words",
    },
    {
      what: "the next direction passes over a re-check",
      file: "src/app.ts",
      edit: swap("const direction = readiness?.next[0];", 'const direction = readiness?.next.find((candidate) => candidate.kind === "learn");'),
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

  it("has mutations for every brief, in every arm", () => {
    for (const name of briefNames()) {
      for (const arm of loadBrief(name).arms) {
        const count = (MUTATIONS[name] ?? []).filter((mutation) => (mutation.arm ?? "knew") === arm).length;
        assert.ok(count > 0, `${name} has no ${arm} mutations, so nothing shows its checker can fail there`);
      }
    }
  });

  for (const [name, mutations] of Object.entries(MUTATIONS)) {
    mutations.forEach((mutation, index) => {
      it(`${name}${mutation.arm === "baseline" ? " (baseline)" : ""}${mutation.phase === 2 ? " (after the change)" : ""}: ${mutation.what}`, async () => {
        const arm = mutation.arm ?? "knew";
        const phase = mutation.phase ?? 1;
        const dir = join(MUTANTS, `${name}-${index}`);
        cpSync(referenceOf(loadBrief(name), arm, phase), dir, { recursive: true });
        replaying(loadBrief(name));
        const path = join(dir, mutation.file);
        const before = readFileSync(path, "utf8");
        const after = mutation.edit(before);
        assert.notEqual(after, before, "the mutation changed nothing");
        writeFileSync(path, after);
        const result = await checkInProcess(dir, name, { typecheck: false, appTests: false, arm, phase });
        const item = result.checks.find((check) => check.name === mutation.fails);
        assert.ok(item, `the ${name} checker has no check named "${mutation.fails}"; it ran: ${result.checks.map((check) => check.name).join("; ")}`);
        assert.equal(item.passed, false, `"${mutation.fails}" passed with ${mutation.what}`);
      });
    });
  }
});

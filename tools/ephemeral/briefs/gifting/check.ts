import { mustHonorFrom, readinessFor, type Fact, type IntelligenceScope, type Lens } from "@popjoker/knew";
import { person } from "@popjoker/knew/presets";
import { extracted, extraction, fakeIntelligence } from "@popjoker/knew/testing";
import {
  Checks,
  ensure,
  factOf,
  importApp,
  loadDefinitions,
  recording,
  standardChecks,
  type CheckOptions,
  type CheckResult,
  type Definitions,
} from "../../kit/check-kit.ts";

/**
 * gifting: a vocabulary extended from the person preset with its types left
 * alone, picks shown only once five things are known about what someone loves
 * or wants, and what to steer clear of and what they already have handed to
 * the picks as rules. The preset's types are read from the installed preset,
 * so the checker follows the preset rather than restating it; the keys it
 * names below are the preset's, which the brief describes and never spells.
 */

const LENS = "gift";
const AT = new Date("2026-06-01T12:00:00Z");
const PRESET = person.vocabulary();
/** The preset's types for what someone loves; with the brief's WISH, what counts toward picks. */
const LOVES = ["INTEREST", "TASTE"] as const;
/** The preset's types for what a pick must honor. */
const HONOR = ["AVOID", "HAS"] as const;

type FirstMove = { move: "ask-first"; about: string } | { move: "show-first"; page: string; honor: string[] };

interface Thoughtful {
  addPerson(userId: string, person: { id: string; name: string }): Promise<void>;
  addNote(userId: string, personId: string, text: string, options?: { at?: Date }): Promise<void>;
  firstMove(userId: string, personId: string): Promise<FirstMove | null>;
}

const shown = (value: unknown): string => JSON.stringify(value) ?? String(value);
const asSeed = ({ type, fact, createdAt, lastSaidAt }: Fact) => ({ type, fact, createdAt, lastSaidAt });

/** A spec as the engine reads it: keys sorted, and a false flag the same as none. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    inner === null || typeof inner !== "object" || Array.isArray(inner)
      ? inner
      : Object.fromEntries(
          Object.entries(inner as Record<string, unknown>)
            .filter(([, field]) => field !== false && field !== undefined)
            .sort(([a], [b]) => a.localeCompare(b)),
        ),
  );
}

/** The needs that count interests, tastes and wishes together, among those that apply to everyone. */
const picksNeeds = (lens: Lens) => lens.needs.filter((need) => need.when.length === 0 && [...LOVES, "WISH"].every((type) => need.types.includes(type)));

/** `n` things someone loves or wants, in a mix of the three types, said an hour before `at`. */
const lovesOrWants = (n: number, at: Date): Fact[] =>
  Array.from({ length: n }, (_, index) => factOf(["INTEREST", "TASTE", "WISH"][index % 3]!, `Something they love or want (${index + 1})`, at, 1 / 24));

async function definitionProbes(checks: Checks, definitions: Definitions, lens: Lens): Promise<void> {
  await checks.run("the vocabulary extends knew's person preset, keeping its types as they are", () => {
    const definition = definitions.vocabularyDefinition;
    ensure(
      definition.basedOn?.preset === "person",
      `the vocabulary is ${definition.basedOn ? `based on ${definition.basedOn.preset}` : "written from scratch"}, not extended from the person preset`,
    );
    const missing = Object.keys(PRESET.factTypes).filter((key) => !(key in definition.factTypes));
    ensure(missing.length === 0, `the preset's ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} gone`);
    const changed = Object.keys(PRESET.factTypes).filter((key) => canonical(definition.factTypes[key]) !== canonical(PRESET.factTypes[key]));
    ensure(changed.length === 0, `the preset's ${changed.join(", ")} changed, and the picks model was tuned on them as they are`);
    ensure(definition.basedOn.added.includes("WISH"), "WISH is not recorded as an addition to the preset");
  });

  await checks.run("picks wait for five things about what they love or want, in any mix", () => {
    const needs = picksNeeds(lens);
    ensure(needs.length > 0, "no need of the gift lens counts interests, tastes and wishes alike, so nothing counts them together");
    const standing = (n: number) =>
      readinessFor(lens, { fields: {} }, lovesOrWants(n, AT), AT).needs.filter((candidate) => needs.some((need) => need.id === candidate.id));
    const early = standing(4).filter((candidate) => candidate.state === "met");
    ensure(early.length === 0, `with four things known, ${early.map((candidate) => candidate.id).join(" and ")} is already met`);
    const late = standing(5).filter((candidate) => candidate.state !== "met");
    ensure(late.length === 0, `with five things known, ${late.map((candidate) => `${candidate.id} is ${candidate.state}`).join(" and ")}`);
  });

  await checks.run("what to steer clear of and what they already have are rules to honor", () => {
    ensure(HONOR.every((type) => type in PRESET.factTypes), "the person preset no longer has AVOID and HAS; this checker needs updating");
    const facts = [
      factOf("AVOID", "No alcohol, ever", AT, 3),
      factOf("HAS", "Owns every Studio Ghibli film", AT, 3),
      factOf("TASTE", "Loves anything matcha", AT, 3),
    ];
    const honored = mustHonorFrom(lens, facts, AT).map((item) => item.type);
    const missing = HONOR.filter((type) => !honored.includes(type));
    ensure(missing.length === 0, `the gift lens hands the picks ${shown(honored)} to honor, and not ${missing.join(" or ")}`);
  });
}

async function appProbes(checks: Checks, dir: string, definitions: Definitions): Promise<void> {
  const lens = definitions.lenses[LENS]!;
  const lenses = [lens, ...Object.values(definitions.lenses).filter((other) => other.id !== LENS)];
  const loaded: { createApp?: (engine: unknown) => unknown } = {};
  const ready = await checks.run("src/app.ts exports createApp(engine), with addPerson, addNote and firstMove", async () => {
    const module = await importApp(dir);
    ensure(typeof module.createApp === "function", `src/app.ts exports ${Object.keys(module).join(", ") || "nothing"}, and no createApp`);
    const createApp = module.createApp as (engine: unknown) => unknown;
    const app = createApp(recording(fakeIntelligence({ lenses })).engine) as Record<string, unknown> | null;
    for (const method of ["addPerson", "addNote", "firstMove"]) ensure(typeof app?.[method] === "function", `createApp(engine) returned no ${method}`);
    loaded.createApp = createApp;
  });
  const createApp = loaded.createApp;
  if (!ready || !createApp) return;

  const open = () => {
    const fake = fakeIntelligence({ lenses });
    const { engine, calls } = recording(fake);
    const app = createApp(engine) as Thoughtful;
    const placed = () => {
      const call = calls.filter((recorded) => recorded.method === "upsertEntity").at(-1);
      ensure(call, "addPerson never put the person on knew's roster");
      return { scope: call.args[0] as IntelligenceScope, id: (call.args[1] as { id: string }).id };
    };
    return { fake, app, placed };
  };

  await checks.run("someone new gets the gift lens's first direction, and someone never added gets null", async () => {
    const { fake, app, placed } = open();
    const unknown = await app.firstMove("ana", "dad");
    ensure(unknown === null, `before ana added dad, firstMove answered ${shown(unknown)}`);
    await app.addPerson("ana", { id: "dad", name: "Dad" });
    const { scope, id } = placed();
    const step = (await fake.readiness(scope, id, { lens: LENS }))?.next[0];
    ensure(step, "the gift lens has no direction for someone new");
    const expected = { move: "ask-first", about: step.label };
    const move = await app.firstMove("ana", "dad");
    ensure(shown(move) === shown(expected), `for someone new, expected ${shown(expected)}, got ${shown(move)}`);
  });

  await checks.run("the fifth thing known turns asking into showing, and four is not enough", async () => {
    const { fake, app, placed } = open();
    await app.addPerson("ana", { id: "dad", name: "Dad" });
    const { scope, id } = placed();
    for (let index = 1; index <= 5; index += 1) {
      fake.script({ extraction: extraction([extracted(id, ["INTEREST", "TASTE", "WISH"][(index - 1) % 3]!, `Something Dad loves or wants (${index})`)]) });
      await app.addNote("ana", "dad", `Note ${index} about Dad.`);
      const move = await app.firstMove("ana", "dad");
      const known = (await fake.getEntity(scope, id))?.facts.length ?? 0;
      const want = index < 5 ? "ask-first" : "show-first";
      ensure(move?.move === want, `after ${index} note(s), with ${known} thing(s) known to knew, firstMove was ${shown(move)}, not ${want}`);
    }
  });

  await checks.run("showing first hands over knew's page through the gift lens, and its rules", async () => {
    const { fake, app, placed } = open();
    await app.addPerson("ana", { id: "mia", name: "Mia" });
    const { scope, id } = placed();
    fake.seedFacts(scope, id, [
      { type: "AVOID", fact: "No alcohol, ever" },
      { type: "HAS", fact: "Owns every Studio Ghibli film" },
      ...lovesOrWants(5, new Date()).map(asSeed),
    ]);
    const brief = await fake.brief(scope, id, { lens: LENS });
    ensure(brief, "knew has no page about someone with seven things known");
    const move = await app.firstMove("ana", "mia");
    ensure(move?.move === "show-first", `with five things known, firstMove was ${shown(move)}`);
    ensure(move.page === brief.text, `page should be knew's page through the gift lens:\n${brief.text}\n…and is:\n${move.page}`);
    const want = brief.mustHonor.map((item) => item.fact).sort();
    const honor = Array.isArray(move.honor) ? [...move.honor].sort() : move.honor;
    ensure(shown(honor) === shown(want), `honor should be ${shown(want)}, and is ${shown(move.honor)}`);
  });
}

export async function check(dir: string, options: CheckOptions): Promise<CheckResult> {
  const checks = new Checks();
  const found: { definitions?: Definitions } = {};
  await checks.run("the definitions compile, under the ids the brief names", () => {
    const definitions = loadDefinitions(dir);
    ensure(definitions.vocabulary.id === "gifts", `the vocabulary is ${definitions.vocabulary.id}, not gifts`);
    ensure("WISH" in definitions.vocabulary.factTypes, "the vocabulary has no WISH type");
    ensure(LENS in definitions.lenses, `there is no gift lens; definitions/lenses holds ${Object.keys(definitions.lenses).join(", ") || "nothing"}`);
    found.definitions = definitions;
  });
  if (found.definitions) {
    await definitionProbes(checks, found.definitions, found.definitions.lenses[LENS]!);
    await appProbes(checks, dir, found.definitions);
  }
  await standardChecks(checks, dir, options);
  return checks.result();
}

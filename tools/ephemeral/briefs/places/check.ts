import { readinessFor, type CompiledNeed, type IntelligenceScope, type Lens, type Readiness } from "@popjoker/knew";
import { extracted, extraction, fakeIntelligence } from "@popjoker/knew/testing";
import {
  Checks,
  ensure,
  factOf,
  factsMeeting,
  importApp,
  loadDefinitions,
  recording,
  standardChecks,
  type CheckOptions,
  type CheckResult,
  type Definitions,
} from "../../kit/check-kit.ts";

/**
 * places: a vocabulary written from scratch for a kind that is not a person,
 * hours that go stale after about a month, and what kind of place before what
 * it is like.
 *
 * The definition probes run the package's own functions over the agent's own
 * definitions, by the ids the brief pins, and judge against bounds (45 days is
 * stale, 10 is not), never against the reference's numbers: a design that
 * names its dimensions or its needs differently passes. The app probes hand the
 * app the package's fake behind a recorder, built from the agent's own lenses,
 * and drive it the way Haunts would, reading the scope and ids the app chose
 * from what it called rather than guessing them.
 */

const LENS = "visit";
const DAY_MS = 86_400_000;
/** The definition probes' moment: fixed, so they read the same on any day. */
const AT = new Date("2026-06-01T12:00:00Z");

interface NextToLearn {
  about: string;
  recheck: string[];
}

interface Haunts {
  addPlace(userId: string, place: { id: string; name: string }): Promise<void>;
  addNote(userId: string, placeId: string, text: string, options?: { at?: Date }): Promise<void>;
  nextToLearn(userId: string, placeId: string): Promise<NextToLearn | null>;
}

/** The needs a type counts toward, among those that apply to every place: a probe's place has no fields. */
const countedBy = (lens: Lens, type: string): CompiledNeed[] => lens.needs.filter((need) => need.when.length === 0 && need.types.includes(type));
const among = (needs: CompiledNeed[]) => (id: string) => needs.some((need) => need.id === id);
const stepsOf = (readiness: Readiness): string => readiness.next.map((step) => `${step.kind} ${step.need}`).join(", ") || "nothing";
const shown = (value: unknown): string => JSON.stringify(value) ?? String(value);
const asSeed = ({ type, fact, createdAt, lastSaidAt }: { type: string; fact: string; createdAt: Date; lastSaidAt: Date | null }) => ({ type, fact, createdAt, lastSaidAt });

async function definitionProbes(checks: Checks, lens: Lens): Promise<void> {
  const hoursNeeds = countedBy(lens, "HOURS");
  const kindNeeds = countedBy(lens, "KIND");
  const vibeNeeds = countedBy(lens, "VIBE");
  const isHours = among(hoursNeeds);
  const isVibe = among(vibeNeeds);
  const hoursSaid = (daysAgo: number) =>
    Array.from({ length: Math.max(1, ...hoursNeeds.map((need) => need.enough)) }, (_, index) =>
      factOf("HOURS", `Open 8 to 6, closed Mondays (${index + 1})`, AT, daysAgo),
    );
  // Everything else the lens needs, already known, so only the hours are open.
  const rest = () => factsMeeting(lens, AT, { skip: (need) => isHours(need.id) });

  await checks.run("hours noted 45 days ago are due for a re-check", () => {
    ensure(hoursNeeds.length > 0, "no need of the visit lens counts HOURS, so when a place is open is never a direction");
    const hours = hoursSaid(45);
    const readiness = readinessFor(lens, { fields: {} }, [...rest(), ...hours], AT);
    const recheck = readiness.next.find((step) => step.kind === "revisit" && isHours(step.need));
    ensure(recheck, `with everything else known and the hours noted 45 days ago, the next steps are: ${stepsOf(readiness)}`);
    ensure(
      hours.every((fact) => recheck.factIds.includes(fact.id)),
      `the re-check of ${recheck.need} leaves out hours noted 45 days ago`,
    );
  });

  await checks.run("hours noted 10 days ago are fine", () => {
    ensure(hoursNeeds.length > 0, "no need of the visit lens counts HOURS");
    const readiness = readinessFor(lens, { fields: {} }, [...rest(), ...hoursSaid(10)], AT);
    const unmet = readiness.needs.filter((standing) => isHours(standing.id) && standing.state !== "met");
    ensure(unmet.length === 0, `with the hours noted 10 days ago, ${unmet.map((standing) => `${standing.id} is ${standing.state}`).join(" and ")}`);
  });

  await checks.run("what it's like waits for what kind of place it is", () => {
    ensure(kindNeeds.length > 0, "no need of the visit lens counts KIND");
    ensure(vibeNeeds.length > 0, "no need of the visit lens counts VIBE");
    const both = vibeNeeds.filter((need) => need.types.includes("KIND"));
    ensure(both.length === 0, `${both.map((need) => need.id).join(" and ")} counts KIND and VIBE alike, so the kind can never come first`);
    const early = readinessFor(lens, { fields: {} }, [], AT).next.find((step) => isVibe(step.need));
    ensure(!early, `with nothing known, the visit lens already points to "${early?.label}"`);
  });

  await checks.run("once the kind is known, what it's like is a direction", () => {
    ensure(kindNeeds.length > 0 && vibeNeeds.length > 0, "the visit lens needs a need counting KIND and one counting VIBE");
    const kinds = Array.from({ length: Math.max(...kindNeeds.map((need) => need.enough)) }, (_, index) =>
      factOf("KIND", `A café with a reading room (${index + 1})`, AT, 1 / 24),
    );
    const readiness = readinessFor(lens, { fields: {} }, kinds, AT);
    ensure(
      readiness.next.some((step) => step.kind === "learn" && isVibe(step.need)),
      `with the kind known, what it's like is no direction; the directions are: ${stepsOf(readiness)}`,
    );
  });
}

async function appProbes(checks: Checks, dir: string, definitions: Definitions): Promise<void> {
  const lens = definitions.lenses[LENS]!;
  // The visit lens first, so it is the default; any other lens the agent wrote rides along.
  const lenses = [lens, ...Object.values(definitions.lenses).filter((other) => other.id !== LENS)];
  const loaded: { createApp?: (engine: unknown) => unknown } = {};
  const ready = await checks.run("src/app.ts exports createApp(engine), with addPlace, addNote and nextToLearn", async () => {
    const module = await importApp(dir);
    ensure(typeof module.createApp === "function", `src/app.ts exports ${Object.keys(module).join(", ") || "nothing"}, and no createApp`);
    const createApp = module.createApp as (engine: unknown) => unknown;
    const app = createApp(recording(fakeIntelligence({ lenses })).engine) as Record<string, unknown> | null;
    for (const method of ["addPlace", "addNote", "nextToLearn"]) {
      ensure(typeof app?.[method] === "function", `createApp(engine) returned no ${method}`);
    }
    loaded.createApp = createApp;
  });
  const createApp = loaded.createApp;
  if (!ready || !createApp) return;

  /** A fresh Haunts over a fresh fake, so no probe leans on another's state. */
  const open = () => {
    const fake = fakeIntelligence({ lenses });
    const { engine, calls } = recording(fake);
    const app = createApp(engine) as Haunts;
    /** Where the app put the place it added last: the scope and the roster id it chose. */
    const placed = () => {
      const call = calls.filter((recorded) => recorded.method === "upsertEntity").at(-1);
      ensure(call, "addPlace never put the place on knew's roster");
      return { scope: call.args[0] as IntelligenceScope, id: (call.args[1] as { id: string }).id };
    };
    const firstStep = async (scope: IntelligenceScope, id: string) => (await fake.readiness(scope, id, { lens: LENS }))?.next[0] ?? null;
    return { fake, calls, app, placed, firstStep };
  };

  await checks.run("a new place gets the visit lens's first direction, and a place never added gets null", async () => {
    const { app, placed, firstStep } = open();
    const unknown = await app.nextToLearn("ana", "luna");
    ensure(unknown === null, `before ana added luna, nextToLearn answered ${shown(unknown)}`);
    await app.addPlace("ana", { id: "luna", name: "Café Luna" });
    const { scope, id } = placed();
    const expected = await firstStep(scope, id);
    ensure(expected, "the visit lens has no direction for a place nobody has noted anything about");
    const answer = await app.nextToLearn("ana", "luna");
    ensure(answer?.about === expected.label, `for a new place, expected about "${expected.label}", got ${shown(answer)}`);
    ensure(Array.isArray(answer.recheck) && answer.recheck.length === 0, `nothing has been noted, and recheck is ${shown(answer.recheck)}`);
  });

  await checks.run("a note is read before addNote resolves, filed under its place", async () => {
    const { fake, calls, app, placed, firstStep } = open();
    await app.addPlace("ana", { id: "luna", name: "Café Luna" });
    const { scope, id } = placed();
    fake.script({ extraction: extraction([extracted(id, "KIND", "A café with a reading room upstairs")]) });
    await app.addNote("ana", "luna", "Luna's a café with a reading room upstairs.");
    const recorded = calls.find((call) => call.method === "addEpisode");
    ensure(recorded, "addNote never recorded the note with knew");
    const hints = (recorded.args[1] as { entityHints?: string[] }).entityHints ?? [];
    ensure(hints.includes(id), `the note was recorded without naming the place it was written on (it named ${shown(hints)})`);
    const facts = (await fake.getEntity(scope, id))?.facts ?? [];
    ensure(facts.some((fact) => fact.type === "KIND"), "addNote resolved with the note still unread: knew had not extracted it");
    const expected = await firstStep(scope, id);
    const answer = await app.nextToLearn("ana", "luna");
    ensure(
      expected === null ? answer === null : answer?.about === expected.label,
      `with the kind noted, expected ${expected ? `about "${expected.label}"` : "null"}, got ${shown(answer)}`,
    );
  });

  await checks.run("hours noted 45 days ago come back to be re-checked, in knew's words", async () => {
    const { fake, app, placed, firstStep } = open();
    const hoursNeeds = countedBy(lens, "HOURS");
    ensure(hoursNeeds.length > 0, "no need of the visit lens counts HOURS");
    await app.addPlace("ana", { id: "nine", name: "Bar Nine" });
    const { scope, id } = placed();
    const said = new Date(Date.now() - 45 * DAY_MS);
    for (let index = 1; index <= Math.max(...hoursNeeds.map((need) => need.enough)); index += 1) {
      fake.script({ extraction: extraction([extracted(id, "HOURS", `Open 5pm to 1am, closed Sundays (${index})`)]) });
      await app.addNote("ana", "nine", `Nine opens at five and shuts at one, never on Sundays (${index}).`, { at: said });
    }
    // Everything else the lens needs, known an hour ago, so only the hours are open.
    const isHours = among(hoursNeeds);
    fake.seedFacts(scope, id, factsMeeting(lens, new Date(), { skip: (need) => isHours(need.id) }).map(asSeed));
    const expected = await firstStep(scope, id);
    ensure(
      expected?.kind === "revisit",
      `with the hours noted 45 days ago and everything else known, knew's next direction is ${expected ? `${expected.kind} ${expected.need}` : "nothing"}; was each note's date handed to knew?`,
    );
    const words = new Map(((await fake.getEntity(scope, id))?.facts ?? []).map((fact) => [fact.id, fact.fact]));
    const want = expected.factIds.map((factId) => words.get(factId) ?? factId).sort();
    const answer = await app.nextToLearn("ana", "nine");
    ensure(answer?.about === expected.label, `expected the re-check to be about "${expected.label}", got ${shown(answer)}`);
    const listed = Array.isArray(answer.recheck) ? [...answer.recheck].sort() : answer.recheck;
    ensure(shown(listed) === shown(want), `recheck should list ${shown(want)}, and lists ${shown(answer.recheck)}`);
  });

  await checks.run("a place with nothing left to find out has nothing next to learn", async () => {
    const { fake, app, placed, firstStep } = open();
    await app.addPlace("ana", { id: "luna", name: "Café Luna" });
    const { scope, id } = placed();
    fake.seedFacts(scope, id, factsMeeting(lens, new Date()).map(asSeed));
    const left = await firstStep(scope, id);
    ensure(left === null, `the probe could not meet every need: knew still has ${left?.kind} ${left?.need} to do`);
    const answer = await app.nextToLearn("ana", "luna");
    ensure(answer === null, `with everything known, nextToLearn answered ${shown(answer)}`);
  });

  await checks.run("a notebook is its owner's alone", async () => {
    const { calls, app } = open();
    await app.addPlace("ana", { id: "luna", name: "Café Luna" });
    await app.addPlace("ben", { id: "corner", name: "Corner Books" });
    const scopes = calls.filter((call) => call.method === "upsertEntity").map((call) => shown(call.args[0]));
    ensure(scopes.length === 2 && scopes[0] !== scopes[1], `ana's and ben's places went into one notebook: ${scopes.join(" and ")}`);
    const crossed = await app.nextToLearn("ben", "luna");
    ensure(crossed === null, `ben never added luna, and nextToLearn answered ben with ${shown(crossed)}`);
  });
}

export async function check(dir: string, options: CheckOptions): Promise<CheckResult> {
  const checks = new Checks();
  const found: { definitions?: Definitions } = {};
  await checks.run("the definitions compile, under the ids the brief names", () => {
    const definitions = loadDefinitions(dir);
    ensure(definitions.vocabulary.id === "places", `the vocabulary is ${definitions.vocabulary.id}, not places`);
    ensure(definitions.vocabulary.kind !== "person", "the vocabulary describes people, and Haunts' entities are places");
    const missing = ["KIND", "HOURS", "VIBE"].filter((type) => !(type in definitions.vocabulary.factTypes));
    ensure(missing.length === 0, `the vocabulary has no ${missing.join(" or ")} type`);
    ensure(LENS in definitions.lenses, `there is no visit lens; definitions/lenses holds ${Object.keys(definitions.lenses).join(", ") || "nothing"}`);
    found.definitions = definitions;
  });
  if (found.definitions) {
    const own = found.definitions.vocabularyDefinition;
    await checks.run("the vocabulary is Haunts' own, written from scratch", () => {
      ensure(!own.basedOn, `the vocabulary is extended from knew's ${own.basedOn?.preset} preset, and Haunts' notes don't fit it`);
    });
    await definitionProbes(checks, found.definitions.lenses[LENS]!);
    await appProbes(checks, dir, found.definitions);
  }
  await standardChecks(checks, dir, options);
  return checks.result();
}

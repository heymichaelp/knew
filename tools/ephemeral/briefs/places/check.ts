import { readinessFor, type CompiledAsk, type IntelligenceScope, type Lens, type Readiness } from "@popjoker/knew";
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
 * names its dimensions or its asks differently passes. The app probes hand the
 * app the package's fake behind a recorder, built from the agent's own lenses,
 * and drive it the way Haunts would, reading the scope and ids the app chose
 * from what it called rather than guessing them.
 */

const LENS = "visit";
const DAY_MS = 86_400_000;
/** The definition probes' moment: fixed, so they read the same on any day. */
const AT = new Date("2026-06-01T12:00:00Z");

interface NextQuestion {
  question: string;
  recheck: string[];
}

interface Haunts {
  addPlace(userId: string, place: { id: string; name: string }): Promise<void>;
  addNote(userId: string, placeId: string, text: string, options?: { at?: Date }): Promise<void>;
  nextQuestion(userId: string, placeId: string): Promise<NextQuestion | null>;
}

/** The asks a type answers, among those that apply to every place: a probe's place has no fields. */
const answeredBy = (lens: Lens, type: string): CompiledAsk[] => lens.asks.filter((ask) => ask.when.length === 0 && ask.answeredBy.includes(type));
const among = (asks: CompiledAsk[]) => (id: string) => asks.some((ask) => ask.id === id);
const stepsOf = (readiness: Readiness): string => readiness.next.map((step) => `${step.kind} ${step.ask}`).join(", ") || "nothing";
const shown = (value: unknown): string => JSON.stringify(value) ?? String(value);
const asSeed = ({ type, fact, createdAt, lastSaidAt }: { type: string; fact: string; createdAt: Date; lastSaidAt: Date | null }) => ({ type, fact, createdAt, lastSaidAt });

async function definitionProbes(checks: Checks, lens: Lens): Promise<void> {
  const hoursAsks = answeredBy(lens, "HOURS");
  const kindAsks = answeredBy(lens, "KIND");
  const vibeAsks = answeredBy(lens, "VIBE");
  const isHours = among(hoursAsks);
  const isVibe = among(vibeAsks);
  const hoursSaid = (daysAgo: number) =>
    Array.from({ length: Math.max(1, ...hoursAsks.map((ask) => ask.enough)) }, (_, index) =>
      factOf("HOURS", `Open 8 to 6, closed Mondays (${index + 1})`, AT, daysAgo),
    );
  // Everything else the lens asks, already known, so only the hours are in question.
  const rest = () => factsMeeting(lens, AT, { skip: (ask) => isHours(ask.id) });

  await checks.run("hours noted 45 days ago are due for a re-check", () => {
    ensure(hoursAsks.length > 0, "no ask of the visit lens is answered by HOURS, so nothing ever asks when a place is open");
    const hours = hoursSaid(45);
    const readiness = readinessFor(lens, { fields: {} }, [...rest(), ...hours], AT);
    const recheck = readiness.next.find((step) => step.kind === "revisit" && isHours(step.ask));
    ensure(recheck, `with everything else known and the hours noted 45 days ago, the next steps are: ${stepsOf(readiness)}`);
    ensure(
      hours.every((fact) => recheck.factIds.includes(fact.id)),
      `the re-check of ${recheck.ask} leaves out hours noted 45 days ago`,
    );
  });

  await checks.run("hours noted 10 days ago are fine", () => {
    ensure(hoursAsks.length > 0, "no ask of the visit lens is answered by HOURS");
    const readiness = readinessFor(lens, { fields: {} }, [...rest(), ...hoursSaid(10)], AT);
    const unmet = readiness.asks.filter((standing) => isHours(standing.id) && standing.state !== "met");
    ensure(unmet.length === 0, `with the hours noted 10 days ago, ${unmet.map((standing) => `${standing.id} is ${standing.state}`).join(" and ")}`);
  });

  await checks.run("what it's like waits for what kind of place it is", () => {
    ensure(kindAsks.length > 0, "no ask of the visit lens is answered by KIND");
    ensure(vibeAsks.length > 0, "no ask of the visit lens is answered by VIBE");
    const both = vibeAsks.filter((ask) => ask.answeredBy.includes("KIND"));
    ensure(both.length === 0, `${both.map((ask) => ask.id).join(" and ")} is answered by KIND and VIBE alike, so the kind can never come first`);
    const early = readinessFor(lens, { fields: {} }, [], AT).next.find((step) => isVibe(step.ask));
    ensure(!early, `with nothing known, the visit lens already asks "${early?.question}"`);
  });

  await checks.run("once the kind is known, what it's like is asked", () => {
    ensure(kindAsks.length > 0 && vibeAsks.length > 0, "the visit lens needs an ask answered by KIND and one answered by VIBE");
    const kinds = Array.from({ length: Math.max(...kindAsks.map((ask) => ask.enough)) }, (_, index) =>
      factOf("KIND", `A café with a reading room (${index + 1})`, AT, 1 / 24),
    );
    const readiness = readinessFor(lens, { fields: {} }, kinds, AT);
    ensure(
      readiness.next.some((step) => step.kind === "ask" && isVibe(step.ask)),
      `with the kind known, nothing asks what it's like; the next steps are: ${stepsOf(readiness)}`,
    );
  });
}

async function appProbes(checks: Checks, dir: string, definitions: Definitions): Promise<void> {
  const lens = definitions.lenses[LENS]!;
  // The visit lens first, so it is the default; any other lens the agent wrote rides along.
  const lenses = [lens, ...Object.values(definitions.lenses).filter((other) => other.id !== LENS)];
  const loaded: { createApp?: (engine: unknown) => unknown } = {};
  const ready = await checks.run("src/app.ts exports createApp(engine), with addPlace, addNote and nextQuestion", async () => {
    const module = await importApp(dir);
    ensure(typeof module.createApp === "function", `src/app.ts exports ${Object.keys(module).join(", ") || "nothing"}, and no createApp`);
    const createApp = module.createApp as (engine: unknown) => unknown;
    const app = createApp(recording(fakeIntelligence({ lenses })).engine) as Record<string, unknown> | null;
    for (const method of ["addPlace", "addNote", "nextQuestion"]) {
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

  await checks.run("a new place gets the visit lens's first question, and a place never added gets null", async () => {
    const { app, placed, firstStep } = open();
    const unknown = await app.nextQuestion("ana", "luna");
    ensure(unknown === null, `before ana added luna, nextQuestion answered ${shown(unknown)}`);
    await app.addPlace("ana", { id: "luna", name: "Café Luna" });
    const { scope, id } = placed();
    const expected = await firstStep(scope, id);
    ensure(expected, "the visit lens has nothing to ask about a place nobody has noted anything about");
    const answer = await app.nextQuestion("ana", "luna");
    ensure(answer?.question === expected.question, `for a new place, expected the question "${expected.question}", got ${shown(answer)}`);
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
    const answer = await app.nextQuestion("ana", "luna");
    ensure(
      expected === null ? answer === null : answer?.question === expected.question,
      `with the kind noted, expected ${expected ? `"${expected.question}"` : "null"}, got ${shown(answer)}`,
    );
  });

  await checks.run("hours noted 45 days ago come back to be re-checked, in knew's words", async () => {
    const { fake, app, placed, firstStep } = open();
    const hoursAsks = answeredBy(lens, "HOURS");
    ensure(hoursAsks.length > 0, "no ask of the visit lens is answered by HOURS");
    await app.addPlace("ana", { id: "nine", name: "Bar Nine" });
    const { scope, id } = placed();
    const said = new Date(Date.now() - 45 * DAY_MS);
    for (let index = 1; index <= Math.max(...hoursAsks.map((ask) => ask.enough)); index += 1) {
      fake.script({ extraction: extraction([extracted(id, "HOURS", `Open 5pm to 1am, closed Sundays (${index})`)]) });
      await app.addNote("ana", "nine", `Nine opens at five and shuts at one, never on Sundays (${index}).`, { at: said });
    }
    // Everything else the lens asks, known an hour ago, so only the hours are in question.
    const isHours = among(hoursAsks);
    fake.seedFacts(scope, id, factsMeeting(lens, new Date(), { skip: (ask) => isHours(ask.id) }).map(asSeed));
    const expected = await firstStep(scope, id);
    ensure(
      expected?.kind === "revisit",
      `with the hours noted 45 days ago and everything else known, knew's next step is ${expected ? `${expected.kind} ${expected.ask}` : "nothing"}; was each note's date handed to knew?`,
    );
    const words = new Map(((await fake.getEntity(scope, id))?.facts ?? []).map((fact) => [fact.id, fact.fact]));
    const want = expected.factIds.map((factId) => words.get(factId) ?? factId).sort();
    const answer = await app.nextQuestion("ana", "nine");
    ensure(answer?.question === expected.question, `expected the re-check "${expected.question}", got ${shown(answer)}`);
    const listed = Array.isArray(answer.recheck) ? [...answer.recheck].sort() : answer.recheck;
    ensure(shown(listed) === shown(want), `recheck should list ${shown(want)}, and lists ${shown(answer.recheck)}`);
  });

  await checks.run("a place with nothing left to find out has no next question", async () => {
    const { fake, app, placed, firstStep } = open();
    await app.addPlace("ana", { id: "luna", name: "Café Luna" });
    const { scope, id } = placed();
    fake.seedFacts(scope, id, factsMeeting(lens, new Date()).map(asSeed));
    const left = await firstStep(scope, id);
    ensure(left === null, `the probe could not meet every ask: knew still has ${left?.kind} ${left?.ask} to do`);
    const answer = await app.nextQuestion("ana", "luna");
    ensure(answer === null, `with everything known, nextQuestion answered ${shown(answer)}`);
  });

  await checks.run("a notebook is its owner's alone", async () => {
    const { calls, app } = open();
    await app.addPlace("ana", { id: "luna", name: "Café Luna" });
    await app.addPlace("ben", { id: "corner", name: "Corner Books" });
    const scopes = calls.filter((call) => call.method === "upsertEntity").map((call) => shown(call.args[0]));
    ensure(scopes.length === 2 && scopes[0] !== scopes[1], `ana's and ben's places went into one notebook: ${scopes.join(" and ")}`);
    const crossed = await app.nextQuestion("ben", "luna");
    ensure(crossed === null, `ben never added luna, and nextQuestion answered ben with ${shown(crossed)}`);
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
    await definitionProbes(checks, found.definitions.lenses[LENS]!);
    await appProbes(checks, dir, found.definitions);
  }
  await standardChecks(checks, dir, options);
  return checks.result();
}

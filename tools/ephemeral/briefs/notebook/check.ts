import type { Fact, Lens, NewFact } from "@popjoker/knew";
import { extracted, extraction, fakeIntelligence } from "@popjoker/knew/testing";
import {
  Checks,
  ensure,
  importApp,
  loadDefinitions,
  recording,
  standardChecks,
  type CheckOptions,
  type CheckResult,
} from "../../kit/check-kit.ts";

/**
 * notebook: a paired brief. The same product is built on knew (`BRIEF.md`)
 * and with no knew at all (`BASELINE.md`), and judged here by the same probes:
 * what an app has to get right once a notebook is a year old. A correction
 * replaces what it corrected and keeps the history; an as-of read is right; a
 * statement that has ended stops being known; a repeat is kept once and
 * counts as heard again; stale hours come back to be re-checked; notes about
 * places nobody added are dropped; one user's notebook never reaches another.
 *
 * It changes, too. After the build, the same session is handed `CHANGE.md`: a
 * fifth kind of statement, `PRICE`, a second planning view for tonight, and a
 * last step on the visit view. Phase 2 probes everything again, adjusted for
 * the change, and the new behaviour besides, so what the change cost and
 * whether it broke anything are both measured.
 *
 * Neither arm does a model's job. The probes script what each note says, as
 * statements, and each arm receives the same statements its own way: on knew,
 * as the package's fake extraction and reconciliation; in the baseline, from
 * the `read` function the app is handed. What is measured is what the app does
 * with them over time.
 */

type Topic = "KIND" | "HOURS" | "VIBE" | "ORDER" | "PRICE";
type Phase = 1 | 2;

/** One thing a note says about one place: a correction or a repeat names the earlier statement's exact text. */
interface Statement {
  placeId: string;
  topic: Topic;
  text: string;
  until: string | null;
  replaces: string | null;
  repeats: string | null;
}

interface NextToLearn {
  about: string;
  recheck: string[];
}

interface Haunts {
  addPlace(userId: string, place: { id: string; name: string }): Promise<void>;
  addNote(userId: string, placeId: string, text: string, options?: { at?: Date }): Promise<void>;
  known(userId: string, placeId: string, options?: { asOf?: Date }): Promise<string[] | null>;
  nextToLearn(userId: string, placeId: string): Promise<NextToLearn | null>;
  /** From the change on: the tonight view. */
  nextTonight?(userId: string, placeId: string): Promise<NextToLearn | null>;
}

/** A fresh app, and how to tell it what the next note says. */
interface Bench {
  app: Haunts;
  tell(statements: Statement[]): void;
}

const LABEL: Record<Topic, string> = {
  KIND: "What kind of place it is",
  HOURS: "When it is open",
  VIBE: "What it is like to be there",
  ORDER: "What to order",
  PRICE: "How much it costs",
};

const DAY_MS = 86_400_000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS);
const dateOf = (at: Date) => at.toISOString().slice(0, 10);
const shown = (value: unknown): string => JSON.stringify(value) ?? String(value);
const sorted = (texts: string[] | null) => (texts === null ? null : [...texts].sort());

const say = (placeId: string, topic: Topic, text: string, extra: Partial<Pick<Statement, "until" | "replaces" | "repeats">> = {}): Statement => ({
  placeId,
  topic,
  text,
  until: extra.until ?? null,
  replaces: extra.replaces ?? null,
  repeats: extra.repeats ?? null,
});

/**
 * The knew arm: the package's fake behind a recorder, built from the app's own
 * lenses. A statement becomes a scripted extracted fact; a correction or a
 * repeat becomes the reconcile decision a model would make, citing the earlier
 * fact by its text.
 */
function knewBench(createApp: (engine: unknown) => unknown, lenses: Lens[]): () => Bench {
  return () => {
    const fake = fakeIntelligence({ lenses });
    const { engine, calls } = recording(fake);
    const inner = createApp(engine) as Haunts;
    const roster = new Map<string, string>();
    const app: Haunts = {
      addPlace: async (userId, place) => {
        await inner.addPlace(userId, place);
        const call = calls.filter((recorded) => recorded.method === "upsertEntity").at(-1);
        if (call) roster.set(place.id, (call.args[1] as { id: string }).id);
      },
      addNote: (...args) => inner.addNote(...args),
      known: (...args) => inner.known(...args),
      nextToLearn: (...args) => inner.nextToLearn(...args),
      ...(typeof inner.nextTonight === "function" ? { nextTonight: (...args: [string, string]) => inner.nextTonight!(...args) } : {}),
    };
    const tell = (statements: Statement[]) =>
      fake.script({
        extraction: extraction(statements.map((statement) => extracted(roster.get(statement.placeId) ?? statement.placeId, statement.topic, statement.text, { invalidAt: statement.until }))),
        reconcile: (entity: { name: string; current: Fact[] }, incoming: NewFact[]) => ({
          decisions: incoming.flatMap((fact, newIndex) => {
            const statement = statements.find((candidate) => candidate.text === fact.fact);
            const earlier = statement?.replaces ?? statement?.repeats;
            const cited = earlier ? entity.current.find((current) => current.fact === earlier) : undefined;
            if (!statement || !cited) return [];
            return [{ newIndex, action: statement.replaces ? ("supersede" as const) : ("merge" as const), factId: cited.id, invalidAt: null }];
          }),
          summary: `About ${entity.name}.`,
        }),
      });
    return { app, tell };
  };
}

/** The baseline arm: the app's own `read`, answering each note with the statements told for it, in order. */
function baselineBench(createApp: (dependencies: unknown) => unknown): () => Bench {
  return () => {
    const queue: Statement[][] = [];
    const read = async () => (queue.shift() ?? []).map((statement) => ({ ...statement }));
    return { app: createApp({ read }) as Haunts, tell: (statements) => queue.push(statements) };
  };
}

/** Everything but the hours, said now: after the change, that takes a price too. */
const allButHours = (placeId: string, phase: Phase): Statement[] => [
  say(placeId, "KIND", "A cocktail bar"),
  say(placeId, "VIBE", "Loud after ten"),
  say(placeId, "ORDER", "The smoked old fashioned"),
  ...(phase === 2 ? [say(placeId, "PRICE", "Pricey")] : []),
];

async function probes(checks: Checks, open: () => Bench, phase: Phase): Promise<void> {
  await checks.run("a place never added is unknown, and a new place starts with what kind of place it is", async () => {
    const { app } = open();
    ensure((await app.known("ana", "luna")) === null, "known() answered for a place ana never added");
    ensure((await app.nextToLearn("ana", "luna")) === null, "nextToLearn() answered for a place ana never added");
    await app.addPlace("ana", { id: "luna", name: "Café Luna" });
    const known = await app.known("ana", "luna");
    ensure(shown(known) === "[]", `a new place should know nothing, and knows ${shown(known)}`);
    const next = await app.nextToLearn("ana", "luna");
    ensure(shown(next) === shown({ about: LABEL.KIND, recheck: [] }), `a new place should start with "${LABEL.KIND}", and got ${shown(next)}`);
  });

  await checks.run("a note is kept under its place, as it was said", async () => {
    const { app, tell } = open();
    await app.addPlace("ana", { id: "luna", name: "Café Luna" });
    tell([say("luna", "KIND", "A café with a reading room upstairs")]);
    await app.addNote("ana", "luna", "Luna's a café with a reading room upstairs.");
    const known = await app.known("ana", "luna");
    ensure(shown(known) === shown(["A café with a reading room upstairs"]), `known() should hold the note's one statement, and holds ${shown(known)}`);
  });

  await checks.run("a correction replaces what it corrected, and the earlier word is still known as of before it", async () => {
    const { app, tell } = open();
    await app.addPlace("ana", { id: "nine", name: "Bar Nine" });
    tell([say("nine", "HOURS", "Open 8 to 6")]);
    await app.addNote("ana", "nine", "Nine's open eight till six.", { at: daysAgo(20) });
    tell([say("nine", "HOURS", "Opens at 10 now", { replaces: "Open 8 to 6" })]);
    await app.addNote("ana", "nine", "Nine opens at ten now.", { at: daysAgo(5) });
    const now = await app.known("ana", "nine");
    ensure(shown(sorted(now)) === shown(["Opens at 10 now"]), `after the correction, known() should hold only the new hours, and holds ${shown(now)}`);
    const then = await app.known("ana", "nine", { asOf: daysAgo(10) });
    ensure(shown(sorted(then)) === shown(["Open 8 to 6"]), `as of ten days ago, before the correction, known() should hold the old hours, and holds ${shown(then)}`);
  });

  await checks.run("a statement that has ended is no longer known", async () => {
    const { app, tell } = open();
    await app.addPlace("ana", { id: "luna", name: "Café Luna" });
    tell([say("luna", "ORDER", "Dumpling pop-up on Fridays", { until: dateOf(daysAgo(2)) })]);
    await app.addNote("ana", "luna", "Luna has a dumpling pop-up on Fridays, until the start of the month.", { at: daysAgo(10) });
    const now = await app.known("ana", "luna");
    ensure(shown(now) === "[]", `the pop-up ended two days ago, and known() still holds ${shown(now)}`);
    const then = await app.known("ana", "luna", { asOf: daysAgo(5) });
    ensure(shown(then) === shown(["Dumpling pop-up on Fridays"]), `five days ago the pop-up was still on, and known() as of then holds ${shown(then)}`);
  });

  await checks.run("a repeated statement is known once, and counts as heard again", async () => {
    const { app, tell } = open();
    await app.addPlace("ana", { id: "nine", name: "Bar Nine" });
    tell([say("nine", "HOURS", "Open 5pm to 1am")]);
    await app.addNote("ana", "nine", "Nine opens at five and shuts at one.", { at: daysAgo(45) });
    tell([...allButHours("nine", phase), say("nine", "HOURS", "Open 5pm to 1am", { repeats: "Open 5pm to 1am" })]);
    await app.addNote("ana", "nine", "Nine: cocktail bar, loud after ten, get the smoked old fashioned. Still five till one.");
    const known = await app.known("ana", "nine");
    const hours = (known ?? []).filter((text) => text === "Open 5pm to 1am").length;
    ensure(hours === 1, `the hours were said twice and should be known once; known() holds ${shown(known)}`);
    const next = await app.nextToLearn("ana", "nine");
    ensure(next === null, `with everything known and the hours heard again today, nextToLearn() should be null, and is ${shown(next)}`);
  });

  await checks.run("hours not heard for 45 days come back to be re-checked, and hours from 10 days ago are fine", async () => {
    const { app, tell } = open();
    for (const [id, days] of [
      ["stale", 45],
      ["fresh", 10],
    ] as const) {
      await app.addPlace("ana", { id, name: `Bar ${id}` });
      tell([say(id, "HOURS", "Open 5pm to 1am")]);
      await app.addNote("ana", id, "Open five till one.", { at: daysAgo(days) });
      tell(allButHours(id, phase));
      await app.addNote("ana", id, "Cocktail bar, loud after ten, get the smoked old fashioned.");
    }
    const stale = await app.nextToLearn("ana", "stale");
    ensure(shown(stale) === shown({ about: LABEL.HOURS, recheck: ["Open 5pm to 1am"] }), `hours heard 45 days ago should come back to be re-checked, and nextToLearn() gave ${shown(stale)}`);
    const fresh = await app.nextToLearn("ana", "fresh");
    ensure(fresh === null, `hours heard 10 days ago are fine, and nextToLearn() gave ${shown(fresh)}`);
  });

  await checks.run("with the kind and hours known, what it is like comes next, then what to order", async () => {
    const { app, tell } = open();
    await app.addPlace("ana", { id: "luna", name: "Café Luna" });
    tell([say("luna", "KIND", "A café"), say("luna", "HOURS", "Open 8 to 6")]);
    await app.addNote("ana", "luna", "Luna's a café, open eight till six.");
    const first = await app.nextToLearn("ana", "luna");
    ensure(first?.about === LABEL.VIBE, `with the kind and hours known, expected "${LABEL.VIBE}", got ${shown(first)}`);
    tell([say("luna", "VIBE", "Quiet in the mornings")]);
    await app.addNote("ana", "luna", "Quiet in the mornings.");
    const second = await app.nextToLearn("ana", "luna");
    ensure(second?.about === LABEL.ORDER, `then expected "${LABEL.ORDER}", got ${shown(second)}`);
  });

  await checks.run("a note about a place nobody added is dropped, and stays dropped", async () => {
    const { app, tell } = open();
    await app.addPlace("ana", { id: "luna", name: "Café Luna" });
    tell([say("luna", "KIND", "A café"), say("corner", "KIND", "A record shop")]);
    await app.addNote("ana", "luna", "Luna's a café; the place on the corner is a record shop.");
    await app.addPlace("ana", { id: "corner", name: "Corner Records" });
    const corner = await app.known("ana", "corner");
    ensure(shown(corner) === "[]", `corner was not on ana's list when the note was read, and known() now holds ${shown(corner)}`);
    const luna = await app.known("ana", "luna");
    ensure(shown(luna) === shown(["A café"]), `luna's own statement should be kept, and known() holds ${shown(luna)}`);
  });

  await checks.run("a notebook is its owner's alone", async () => {
    const { app, tell } = open();
    await app.addPlace("ana", { id: "luna", name: "Café Luna" });
    tell([say("luna", "KIND", "A café")]);
    await app.addNote("ana", "luna", "Luna's a café.");
    ensure((await app.known("ben", "luna")) === null, "ben never added luna, and known() answered him");
    await app.addPlace("ben", { id: "luna", name: "Café Luna" });
    const known = await app.known("ben", "luna");
    ensure(shown(known) === "[]", `ben's luna should know nothing of ana's note, and knows ${shown(known)}`);
  });
  if (phase === 2) await changeProbes(checks, open);
}

/** What the change asked for: a price kept like any statement, the visit view's new last step, and the tonight view. */
async function changeProbes(checks: Checks, open: () => Bench): Promise<void> {
  await checks.run("a price is kept like any other statement", async () => {
    const { app, tell } = open();
    await app.addPlace("ana", { id: "luna", name: "Café Luna" });
    tell([say("luna", "PRICE", "Cheap")]);
    await app.addNote("ana", "luna", "Luna's cheap.");
    const known = await app.known("ana", "luna");
    ensure(shown(known) === shown(["Cheap"]), `known() should hold the price, and holds ${shown(known)}`);
  });

  await checks.run("the visit view asks how much it costs last", async () => {
    const { app, tell } = open();
    await app.addPlace("ana", { id: "nine", name: "Bar Nine" });
    tell([say("nine", "KIND", "A cocktail bar"), say("nine", "HOURS", "Open 5pm to 1am"), say("nine", "VIBE", "Loud after ten"), say("nine", "ORDER", "The smoked old fashioned")]);
    await app.addNote("ana", "nine", "Cocktail bar, five till one, loud after ten, get the smoked old fashioned.");
    const next = await app.nextToLearn("ana", "nine");
    ensure(shown(next) === shown({ about: LABEL.PRICE, recheck: [] }), `with all but the price known, nextToLearn() should ask "${LABEL.PRICE}", and gave ${shown(next)}`);
  });

  await checks.run("tonight starts with when it is open, whatever else is unknown, and a place never added has none", async () => {
    const { app } = open();
    ensure(typeof app.nextTonight === "function", "createApp returned no nextTonight");
    ensure((await app.nextTonight("ana", "luna")) === null, "nextTonight() answered for a place ana never added");
    await app.addPlace("ana", { id: "luna", name: "Café Luna" });
    const next = await app.nextTonight("ana", "luna");
    ensure(shown(next) === shown({ about: LABEL.HOURS, recheck: [] }), `tonight should start with "${LABEL.HOURS}", and gave ${shown(next)}`);
    ensure((await app.nextTonight("ben", "luna")) === null, "nextTonight() answered ben about ana's place");
  });

  await checks.run("tonight asks what it is like, then how much it costs, and never what kind of place it is or what to order", async () => {
    const { app, tell } = open();
    ensure(typeof app.nextTonight === "function", "createApp returned no nextTonight");
    await app.addPlace("ana", { id: "luna", name: "Café Luna" });
    tell([say("luna", "HOURS", "Open 8 to 6")]);
    await app.addNote("ana", "luna", "Open eight till six.");
    const first = await app.nextTonight("ana", "luna");
    ensure(first?.about === LABEL.VIBE, `with the hours known, tonight should ask "${LABEL.VIBE}", and gave ${shown(first)}`);
    tell([say("luna", "VIBE", "Quiet in the mornings")]);
    await app.addNote("ana", "luna", "Quiet in the mornings.");
    const second = await app.nextTonight("ana", "luna");
    ensure(second?.about === LABEL.PRICE, `then "${LABEL.PRICE}", and gave ${shown(second)}`);
    tell([say("luna", "PRICE", "Cheap")]);
    await app.addNote("ana", "luna", "Cheap.");
    const done = await app.nextTonight("ana", "luna");
    ensure(done === null, `with the hours, what it's like and the price known, tonight needs nothing more, and gave ${shown(done)}`);
  });

  await checks.run("tonight re-checks hours not heard for 45 days", async () => {
    const { app, tell } = open();
    ensure(typeof app.nextTonight === "function", "createApp returned no nextTonight");
    await app.addPlace("ana", { id: "nine", name: "Bar Nine" });
    tell([say("nine", "HOURS", "Open 5pm to 1am")]);
    await app.addNote("ana", "nine", "Open five till one.", { at: daysAgo(45) });
    tell([say("nine", "VIBE", "Loud after ten"), say("nine", "PRICE", "Pricey")]);
    await app.addNote("ana", "nine", "Loud after ten, and pricey.");
    const next = await app.nextTonight("ana", "nine");
    ensure(shown(next) === shown({ about: LABEL.HOURS, recheck: ["Open 5pm to 1am"] }), `tonight should re-check hours heard 45 days ago, and gave ${shown(next)}`);
  });
}

export async function check(dir: string, options: CheckOptions): Promise<CheckResult> {
  const checks = new Checks();
  const arm = options.arm ?? "knew";
  const phase: Phase = options.phase === 2 ? 2 : 1;
  const found: { lenses?: Lens[] } = {};
  if (arm === "knew") {
    await checks.run("the definitions compile, under the ids the brief names", () => {
      const definitions = loadDefinitions(dir);
      ensure(definitions.vocabulary.id === "notebook", `the vocabulary is ${definitions.vocabulary.id}, not notebook`);
      const types = phase === 2 ? (["KIND", "HOURS", "VIBE", "ORDER", "PRICE"] as const) : (["KIND", "HOURS", "VIBE", "ORDER"] as const);
      const missing = types.filter((type) => !(type in definitions.vocabulary.factTypes));
      ensure(missing.length === 0, `the vocabulary has no ${missing.join(" or ")} type`);
      const lens = definitions.lenses.visit;
      ensure(lens, `there is no visit lens; definitions/lenses holds ${Object.keys(definitions.lenses).join(", ") || "nothing"}`);
      if (phase === 2) ensure(definitions.lenses.tonight, `there is no tonight lens; definitions/lenses holds ${Object.keys(definitions.lenses).join(", ")}`);
      found.lenses = [lens, ...Object.values(definitions.lenses).filter((other) => other.id !== "visit")];
    });
  }
  const loaded: { createApp?: (dependency: unknown) => unknown } = {};
  if (arm === "baseline" || found.lenses) {
    await checks.run("src/app.ts exports createApp, with addPlace, addNote, known and nextToLearn", async () => {
      const module = await importApp(dir);
      ensure(typeof module.createApp === "function", `src/app.ts exports ${Object.keys(module).join(", ") || "nothing"}, and no createApp`);
      const createApp = module.createApp as (dependency: unknown) => unknown;
      const app = createApp(arm === "knew" ? recording(fakeIntelligence({ lenses: found.lenses! })).engine : { read: async () => [] }) as Record<string, unknown> | null;
      for (const method of ["addPlace", "addNote", "known", "nextToLearn"]) ensure(typeof app?.[method] === "function", `createApp returned no ${method}`);
      loaded.createApp = createApp;
    });
  }
  if (loaded.createApp) await probes(checks, arm === "knew" ? knewBench(loaded.createApp, found.lenses!) : baselineBench(loaded.createApp), phase);
  await standardChecks(checks, dir, options);
  return checks.result();
}

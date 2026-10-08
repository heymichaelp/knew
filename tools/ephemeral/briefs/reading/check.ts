import {
  attributeFacts,
  extractInput,
  extractSchemaFor,
  reconcileInput,
  reconcileSchema,
  systemExtra,
  type EpisodeInput,
  type IntelligenceScope,
  type Lens,
  type ReconcileDecisions,
  type RosterEntry,
  type Vocabulary,
} from "@popjoker/knew";
import { fakeIntelligence, type ScriptedTurn } from "@popjoker/knew/testing";
import { z } from "zod";
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
import { openReader, type Model } from "../../kit/reader.ts";

/**
 * reading: a paired brief whose notes are read for real. Both arms read
 * through the same model (`kit/reader.ts`). On knew, each note goes through
 * knew's own pipeline — its extraction and reconciliation prompts over the
 * agent's vocabulary, the package's input builders and schemas, and the
 * planner behind the fake — as the service would run it, minus Postgres. In
 * the baseline, the app is handed the model itself and writes its own prompts
 * and its own rules for what a note corrects, repeats or adds.
 *
 * The notes are casual and some are ambiguous on purpose: a correction, a
 * repeat in other words, two different things about one topic that are both
 * true, an end date, a place nobody added, news that must not replace what a
 * place is, a correction of what a place is. Probes judge meaning, not
 * wording: how many statements a topic holds, and what they mention.
 */

type Topic = "KIND" | "HOURS" | "VIBE" | "ORDER";

interface Statement {
  topic: string;
  text: string;
}

interface Haunts {
  addPlace(userId: string, place: { id: string; name: string }): Promise<void>;
  addNote(userId: string, placeId: string, text: string, options?: { at?: Date }): Promise<void>;
  known(userId: string, placeId: string, options?: { asOf?: Date }): Promise<Statement[] | null>;
}

const DAY_MS = 86_400_000;
/** Every note is dated before a fixed day, never today, so what the reader is shown is the same on any day and recorded readings keep answering. */
const BASE = new Date("2026-06-01T12:00:00Z").getTime();
const daysAgo = (days: number) => new Date(BASE - days * DAY_MS);
const shown = (value: unknown): string => JSON.stringify(value) ?? String(value);
const about = (known: Statement[] | null, topic: Topic) => (known ?? []).filter((statement) => statement.topic === topic);
const mentions = (statement: Statement, ...words: string[]) => words.some((word) => statement.text.toLowerCase().includes(word));

/**
 * The knew arm: the package's fake behind a recorder, built from the agent's
 * own vocabulary and lenses. Each note the app records is read, before the app
 * can extract it, by knew's own prompts through the reader, and the answer is
 * scripted into the fake, whose planner applies it as the service's would.
 */
function knewBench(createApp: (engine: unknown) => unknown, vocabulary: Vocabulary, lenses: Lens[], model: Model): () => Haunts {
  const extractSystem = [vocabulary.prompts.extract.text, ...systemExtra(vocabulary)].join("\n\n");
  const reconcileSystem = [vocabulary.prompts.reconcile.text, ...systemExtra(vocabulary)].join("\n\n");
  const extractShape = extractSchemaFor(vocabulary);
  const extractJson = z.toJSONSchema(extractShape);
  const reconcileJson = z.toJSONSchema(reconcileSchema);

  return () => {
    const fake = fakeIntelligence({ lenses });
    const { engine, calls } = recording(fake);
    const rosterOf = (scope: IntelligenceScope): RosterEntry[] => {
      const entries = new Map<string, RosterEntry>();
      for (const call of calls.filter((recorded) => recorded.method === "upsertEntity" && shown(recorded.args[0]) === shown(scope))) {
        const entity = call.args[1] as { id: string; name: string; fields?: Record<string, string | null> };
        entries.set(entity.id, { id: entity.id, name: entity.name, fields: entity.fields ?? {}, aliases: [] });
      }
      return [...entries.values()];
    };

    const read = async (scope: IntelligenceScope, input: EpisodeInput): Promise<ScriptedTurn> => {
      const referenceAt = input.referenceAt ?? new Date();
      const roster = rosterOf(scope);
      const extraction = extractShape.parse(
        await model({
          system: extractSystem,
          prompt: extractInput(vocabulary, { content: input.content, source: input.source, referenceAt, roster, hints: input.entityHints ?? [], inReplyTo: input.inReplyTo ?? null }),
          schema: extractJson,
        }),
      );
      const decisions = new Map<string, ReconcileDecisions>();
      const { byEntity } = attributeFacts(extraction.facts, new Set(roster.map((entry) => entry.id)));
      for (const [entityId, incoming] of byEntity) {
        const view = await fake.getEntity(scope, entityId);
        const held = (view?.facts ?? []).filter((fact) => !fact.expiredAt);
        if (held.length === 0) continue;
        // The model is shown stand-in ids, numbered in order, so what it is asked never depends on how many facts
        // the fake minted before; its answer is mapped back to the real ones.
        const standIn = (index: number) => `00000000-0000-4000-a000-${String(index + 1).padStart(12, "0")}`;
        const current = held.map((fact, index) => ({ ...fact, id: standIn(index) }));
        const real = new Map(held.map((fact, index) => [standIn(index), fact.id]));
        const entry = roster.find((candidate) => candidate.id === entityId)!;
        const answer = reconcileSchema.parse(
          await model({
            system: reconcileSystem,
            prompt: reconcileInput(vocabulary, {
              entity: { name: entry.name, fields: entry.fields },
              referenceAt,
              current,
              incoming: incoming.map((fact) => ({ type: fact.type, fact: fact.fact, validAt: fact.validAt ?? null, invalidAt: fact.invalidAt ?? null })),
              summary: view?.summary ?? "",
            }),
            schema: reconcileJson,
          }),
        );
        decisions.set(entry.name, { ...answer, decisions: answer.decisions.map((decision) => ({ ...decision, factId: decision.factId ? (real.get(decision.factId) ?? decision.factId) : null })) });
      }
      return { extraction, reconcile: (entity) => decisions.get(entity.name) ?? { decisions: [], summary: `About ${entity.name}.` } };
    };

    // The app sees the contract; recording an episode also reads it, so the app's own extraction finds the reading waiting.
    const reading: unknown = new Proxy(engine, {
      get(target, property, receiver) {
        if (property !== "addEpisode") return Reflect.get(target, property, receiver);
        return async (scope: IntelligenceScope, input: EpisodeInput) => {
          const result = await target.addEpisode(scope, input);
          if (result.kind === "recorded") fake.script(await read(scope, input));
          return result;
        };
      },
    });
    return createApp(reading) as Haunts;
  };
}

/** The baseline arm: the app is handed the model, and reads its notes itself. */
const baselineBench = (createApp: (dependencies: unknown) => unknown, model: Model) => () => createApp({ model }) as Haunts;

async function probes(checks: Checks, open: () => Haunts): Promise<void> {
  await checks.run("a correction replaces the hours it corrects, and the old hours are still known as of before it", async () => {
    const app = open();
    await app.addPlace("ana", { id: "nine", name: "Bar Nine" });
    await app.addNote("ana", "nine", "Bar Nine is open 8 till 6 every day.", { at: daysAgo(20) });
    await app.addNote("ana", "nine", "Bar Nine changed its hours: it opens at 10 now, still shuts at 6.", { at: daysAgo(5) });
    const now = about(await app.known("ana", "nine"), "HOURS");
    ensure(now.length === 1 && mentions(now[0]!, "10", "ten"), `after the correction, the hours should be one statement about opening at 10, and are ${shown(now)}`);
    const then = about(await app.known("ana", "nine", { asOf: daysAgo(10) }), "HOURS");
    ensure(then.length === 1 && mentions(then[0]!, "8", "eight"), `as of ten days ago, the hours should be the old 8 till 6, and are ${shown(then)}`);
  });

  await checks.run("the same thing said again in other words is kept once", async () => {
    const app = open();
    await app.addPlace("ana", { id: "luna", name: "Café Luna" });
    await app.addNote("ana", "luna", "Luna is a café with a reading room upstairs.", { at: daysAgo(30) });
    await app.addNote("ana", "luna", "Popped into Luna again, still my favourite café. Reading room upstairs and all.", { at: daysAgo(1) });
    const kind = about(await app.known("ana", "luna"), "KIND");
    ensure(kind.length === 1, `what kind of place Luna is was said twice and should be kept once; known holds ${shown(kind)}`);
  });

  await checks.run("two different things about one topic are both kept", async () => {
    const app = open();
    await app.addPlace("ana", { id: "nine", name: "Bar Nine" });
    await app.addNote("ana", "nine", "Nine gets really loud after ten.", { at: daysAgo(12) });
    await app.addNote("ana", "nine", "Nine is calm and quiet before eight, good for a proper chat.", { at: daysAgo(2) });
    const vibe = about(await app.known("ana", "nine"), "VIBE");
    ensure(vibe.length === 2, `loud after ten and quiet before eight are both true; known holds ${shown(vibe)}`);
  });

  await checks.run("something with an end date stops being known after it", async () => {
    const app = open();
    await app.addPlace("ana", { id: "luna", name: "Café Luna" });
    await app.addNote("ana", "luna", "Luna is doing a dumpling pop-up on Fridays until the end of February.", { at: new Date("2026-02-10T12:00:00Z") });
    const during = (await app.known("ana", "luna", { asOf: new Date("2026-02-20T12:00:00Z") })) ?? [];
    ensure(during.some((statement) => mentions(statement, "dumpling")), `on 20 February the pop-up is on, and known holds ${shown(during)}`);
    const after = (await app.known("ana", "luna", { asOf: new Date("2026-03-10T12:00:00Z") })) ?? [];
    ensure(!after.some((statement) => mentions(statement, "dumpling")), `on 10 March the pop-up is over, and known still holds ${shown(after)}`);
  });

  await checks.run("a note about a place nobody added is dropped, and stays dropped", async () => {
    const app = open();
    await app.addPlace("ana", { id: "luna", name: "Café Luna" });
    await app.addNote("ana", "luna", "Luna's a café. The shop on the corner sells vinyl records.", { at: daysAgo(3) });
    await app.addPlace("ana", { id: "corner", name: "Corner Records" });
    const corner = await app.known("ana", "corner");
    ensure(shown(corner) === "[]", `the corner shop was not on ana's list when the note was read, and known now holds ${shown(corner)}`);
    ensure(about(await app.known("ana", "luna"), "KIND").length === 1, "Luna's own statement was not kept");
  });

  await checks.run("news about what a place serves does not replace what kind of place it is", async () => {
    const app = open();
    await app.addPlace("ana", { id: "luna", name: "Café Luna" });
    await app.addNote("ana", "luna", "Luna is a café.", { at: daysAgo(20) });
    await app.addNote("ana", "luna", "Luna does wine and small plates in the evenings now.", { at: daysAgo(2) });
    const kind = about(await app.known("ana", "luna"), "KIND");
    ensure(kind.some((statement) => mentions(statement, "café", "cafe", "coffee")), `Luna is still a café; known's kind holds ${shown(kind)}`);
  });

  await checks.run("a correction of what kind of place it is replaces it", async () => {
    const app = open();
    await app.addPlace("ana", { id: "nine", name: "Bar Nine" });
    await app.addNote("ana", "nine", "Nine is a cocktail bar.", { at: daysAgo(20) });
    await app.addNote("ana", "nine", "I had Nine wrong: it's a wine bar, not a cocktail bar.", { at: daysAgo(2) });
    const kind = about(await app.known("ana", "nine"), "KIND");
    ensure(kind.length === 1 && mentions(kind[0]!, "wine"), `Nine is a wine bar, corrected; known's kind holds ${shown(kind)}`);
  });

  await checks.run("a notebook is its owner's alone", async () => {
    const app = open();
    await app.addPlace("ana", { id: "luna", name: "Café Luna" });
    await app.addNote("ana", "luna", "Luna's a café.", { at: daysAgo(3) });
    ensure((await app.known("ben", "luna")) === null, "ben never added luna, and known answered him");
    await app.addPlace("ben", { id: "luna", name: "Café Luna" });
    const known = await app.known("ben", "luna");
    ensure(shown(known) === "[]", `ben's luna should know nothing of ana's note, and knows ${shown(known)}`);
  });
}

export async function check(dir: string, options: CheckOptions): Promise<CheckResult> {
  const checks = new Checks();
  const arm = options.arm ?? "knew";
  const reader = openReader();
  try {
    const found: { vocabulary?: Vocabulary; lenses?: Lens[] } = {};
    if (arm === "knew") {
      await checks.run("the definitions compile, under the ids the brief names", () => {
        const definitions = loadDefinitions(dir);
        ensure(definitions.vocabulary.id === "places", `the vocabulary is ${definitions.vocabulary.id}, not places`);
        const missing = (["KIND", "HOURS", "VIBE", "ORDER"] as const).filter((type) => !(type in definitions.vocabulary.factTypes));
        ensure(missing.length === 0, `the vocabulary has no ${missing.join(" or ")} type`);
        const lens = definitions.lenses.visit;
        ensure(lens, `there is no visit lens; definitions/lenses holds ${Object.keys(definitions.lenses).join(", ") || "nothing"}`);
        found.vocabulary = definitions.vocabulary;
        found.lenses = [lens, ...Object.values(definitions.lenses).filter((other) => other.id !== "visit")];
      });
    }
    const loaded: { createApp?: (dependency: unknown) => unknown } = {};
    if (arm === "baseline" || found.lenses) {
      await checks.run("src/app.ts exports createApp, with addPlace, addNote and known", async () => {
        const module = await importApp(dir);
        ensure(typeof module.createApp === "function", `src/app.ts exports ${Object.keys(module).join(", ") || "nothing"}, and no createApp`);
        const createApp = module.createApp as (dependency: unknown) => unknown;
        const app = createApp(arm === "knew" ? recording(fakeIntelligence({ lenses: found.lenses! })).engine : { model: reader.model }) as Record<string, unknown> | null;
        for (const method of ["addPlace", "addNote", "known"]) ensure(typeof app?.[method] === "function", `createApp returned no ${method}`);
        loaded.createApp = createApp;
      });
    }
    if (loaded.createApp) {
      await probes(checks, arm === "knew" ? knewBench(loaded.createApp, found.vocabulary!, found.lenses!, reader.model) : baselineBench(loaded.createApp, reader.model));
    }
    await standardChecks(checks, dir, options);
  } finally {
    reader.close();
  }
  return { ...checks.result(), reading: reader.spent() };
}

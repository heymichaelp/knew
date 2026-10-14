import { test } from "node:test";
import { localIntelligence } from "../src/local.ts";
import type { Model } from "../src/model.ts";
import { contractSuite, fakeIntelligence, fixtureAdapter, fixtureGiftLens, fixtureLens, fixtureVisitLens, type ScriptedTurn } from "../src/testing.ts";
import type { Fact, Move, ProposedDirection } from "../src/types.ts";

/**
 * The contract, twice: on the fake, and on `localIntelligence` with a model
 * function in place of a provider. The fake is the local driver with a
 * script, so the second run is what proves the reading path a real model
 * takes — the prompts sent, the answers checked against the schemas — gives
 * the same answers. Each case gets its own driver, so nothing leaks.
 */

let n = 0;
contractSuite({
  test,
  scripted: true,
  open: async () => {
    const fake = fakeIntelligence();
    n += 1;
    return {
      intelligence: fake,
      scope: { clientId: "fake", subjectId: `subject-${n}` },
      otherScope: { clientId: "fake", subjectId: `subject-${n}-other` },
      script: (turn) => fake.script(turn),
      close: async () => {},
    };
  },
});

/**
 * A model that answers from a script, reading what it is asked the way a
 * model would: the reconcile, next and move prompts' own lines give the
 * entity's name, its facts by id, the new facts in order, the directions open
 * and the moves open under the adapter named.
 */
function scriptedModel(turns: ScriptedTurn[]): Model {
  let current: ScriptedTurn | undefined;
  const factOf = ([id, type, fact]: string[]): Fact => ({
    id: id!, entityId: "", objectId: null, type: type!, fact: fact!, attributes: {}, validAt: null, invalidAt: null,
    createdAt: new Date(0), lastSaidAt: null, expiredAt: null, supersededById: null, episodeIds: [],
  });
  return async (request) => {
    if (request.task === "extract") {
      current = turns.shift();
      if (!current) throw new Error("unscripted extract call");
      return { output: JSON.stringify(current.extraction), model: "scripted" };
    }
    const lines = request.prompt.split("\n");
    const name = lines[0]!.replace(/^(About this|Directions for this|Moves of kind \S+ for this) [^:]+: /, "").replace(/ \([^)]*\)$/, "");
    const section = (heading: string) => {
      const start = lines.findIndex((line) => line.startsWith(heading));
      const out: string[][] = [];
      for (const line of lines.slice(start + 1)) {
        if (!line.startsWith("- ")) break;
        out.push(line.slice(2).split(" | "));
      }
      return out;
    };
    if (request.task === "next") {
      const open: ProposedDirection[] = section("Open directions").map(([id, dimension, label, from]) => {
        const grounds = (from ?? "nothing").replace(/ \(lapsed\)$/, "");
        return {
          id: id!, entityId: "", dimension: dimension!, label: label!, factIds: grounds === "nothing" ? [] : grounds.split(", "),
          episodeId: null, proposedAt: new Date(0), status: "open", answeredBy: null, resolvedAt: null,
        };
      });
      const shown = { name, learned: section("Just learned").map(factOf), known: section("Also known").map(factOf), open };
      return { output: current?.next?.(shown) ?? { answered: [], withdrawn: [], proposed: [] }, model: "scripted" };
    }
    if (request.task === "move") {
      const adapter = /^Moves of kind (\S+) /.exec(lines[0]!)![1]!;
      const open: Move[] = section("Open moves").map(([id, label, fields, from]) => ({
        id: id!, entityId: "", adapter, label: label!,
        fields: fields === "none" ? {} : Object.fromEntries(fields!.split("; ").map((pair) => pair.split(": ")).map(([key, value]) => [key!, value === "null" ? null : value!])),
        factIds: (from ?? "").replace(/ \(lapsed\)$/, "").split(", ").filter(Boolean),
        episodeId: "", proposedAt: new Date(0), status: "open", resolvedAt: null,
      }));
      const shown = { name, learned: section("Just learned").map(factOf), known: section("Also known").map(factOf), open };
      return { output: current?.move?.(adapter, shown) ?? { closed: [], proposed: [] }, model: "scripted" };
    }
    const facts = section("Current facts").map(factOf);
    const incoming = section("New facts").map(([, type, fact]) => ({ type: type!, fact: fact! }));
    return { output: current?.reconcile?.({ name, current: facts }, incoming) ?? { decisions: [], summary: `About ${name}.` }, model: "scripted" };
  };
}

contractSuite({
  test: (name, run) => test(`local driver, ${name}`, run),
  scripted: true,
  open: async () => {
    const turns: ScriptedTurn[] = [];
    const local = localIntelligence({ lenses: [fixtureLens(), fixtureVisitLens(), fixtureGiftLens()], adapters: [fixtureAdapter()], model: scriptedModel(turns), background: false });
    n += 1;
    return {
      intelligence: local,
      scope: { clientId: "local", subjectId: `subject-${n}` },
      otherScope: { clientId: "local", subjectId: `subject-${n}-other` },
      script: (turn) => turns.push(turn),
      close: async () => {},
    };
  },
});

/*
  The showcase examples are sketches: the calls are simplified to show the idea, and the
  values under them are real. This file is what the sketch runs on: a notebook in memory,
  the engine's own reads, and a model whose reading of each note is scripted. The real
  calls are in the guide.
*/
import {
  compileLens,
  compileVocabulary,
  extendLens,
  localIntelligence,
  type LensDefinition,
  type LocalIntelligence,
  type Model,
  type VocabularyDefinition,
} from "@popjoker/knew";

/** Records a value for the page, shown under the line that produced it. */
export type Show = (value: unknown) => void;

export interface ScriptedFact {
  type: string;
  fact: string;
  validAt?: string;
  attributes?: Record<string, unknown>;
}

export interface Reading {
  /** A phrase from the note this reading is the answer to. */
  note: string;
  /** About whom, by name. */
  about: string;
  facts: ScriptedFact[];
}

const idOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-");

/** The model, scripted: the facts each note is read into, each kept as new. */
export function scriptedModel(readings: Reading[]): Model {
  return async (request) => {
    if (request.task === "extract") {
      const reading = readings.find((candidate) => request.prompt.includes(candidate.note));
      if (!reading) throw new Error("the showcase scripted no reading for this note");
      const output = {
        facts: reading.facts.map((fact) => ({
          entityId: idOf(reading.about),
          type: fact.type,
          fact: fact.fact,
          attributes: fact.attributes ?? null,
          validAt: fact.validAt ?? null,
          invalidAt: null,
        })),
        aliases: [],
        unresolvedNames: [],
        fieldUpdates: [],
      };
      return { output, model: "scripted" };
    }
    const incoming = request.prompt.split("New facts")[1]?.split("\n\n")[0] ?? "";
    const decisions = [...incoming.matchAll(/^- (\d+) \|/gm)].map(([, index]) => ({
      newIndex: Number(index),
      action: "add" as const,
      factId: null,
      invalidAt: null,
    }));
    return { output: { decisions, summary: "" }, model: "scripted" };
  };
}

const scope = { clientId: "showcase", subjectId: "me" };

/** The day a note was written when a sketch doesn't say: fixed, so the page is the same on every build. */
const WRITTEN = "2026-10-04";

/**
 * One knower's notebook, behind the sketch's calls. `lens` adds a goal by its
 * dimensions' labels; `person` and `place` put someone or somewhere on the
 * list and return what the sketch calls on them.
 */
export function sketch(vocabulary: VocabularyDefinition, lenses: LensDefinition[], readings: Reading[]) {
  const compiled = compileVocabulary(vocabulary);
  const all = [...lenses];
  let knew: LocalIntelligence | undefined;
  const open = () =>
    (knew ??= localIntelligence({ lenses: all.map((lens) => compileLens(lens, compiled)), model: scriptedModel(readings) }));

  const entity = (name: string) => {
    const id = idOf(name);
    const ready = open().upsertEntity(scope, { id, name });
    // A sketch reads as of its latest note, unless it names a day.
    let latest = WRITTEN;
    const read = async (options: { lens?: string; on?: string } = {}) => {
      await ready;
      const asOf = new Date(options.on ?? latest);
      return open().readiness(scope, id, { ...(options.lens ? { lens: options.lens } : {}), asOf });
    };
    return {
      /** Something the knower wrote about them, read into facts. */
      async note(content: string, options: { on?: string } = {}) {
        await ready;
        await open().addEpisode(scope, {
          source: "note",
          content,
          entityHints: [id],
          referenceAt: new Date(options.on ?? WRITTEN),
        });
        latest = options.on ?? WRITTEN;
        await open().settled();
      },
      /** The page: what is known, by dimension. */
      async page() {
        await ready;
        return (await open().brief(scope, id, { asOf: new Date(latest) }))?.text;
      },
      /** What is missing, most valuable first: the top three directions, as of the latest note. */
      async next(lens?: string) {
        return (await read(lens ? { lens } : {}))?.next.slice(0, 3).map((direction) => direction.label);
      },
      /** What must be honoured, whatever else is known. */
      async mustHonor() {
        await ready;
        return (await open().brief(scope, id, { asOf: new Date(latest) }))?.mustHonor.map((fact) => fact.fact);
      },
      /** What is known but due to be heard again, as of a day. */
      async revisit(options: { on: string }) {
        return (await read(options))?.next.filter((direction) => direction.kind === "revisit").map((direction) => direction.label);
      },
    };
  };

  return {
    /** A goal over the vocabulary: its needs weighed by their dimensions' labels. */
    lens(id: string, goal: { goal: string; weigh: Record<string, number> }) {
      const byLabel = Object.fromEntries(Object.entries(vocabulary.dimensions).map(([key, spec]) => [spec.label, key]));
      const needs = Object.fromEntries(
        Object.entries(goal.weigh).map(([label, weight]) => {
          const dimension = byLabel[label];
          if (!dimension) throw new Error(`no dimension is labelled ${label}`);
          return [dimension, { weight }];
        }),
      );
      all.unshift(extendLens(lenses[0]!, { id, version: 1, objective: goal.goal, needs }));
    },
    person: entity,
    place: entity,
  };
}

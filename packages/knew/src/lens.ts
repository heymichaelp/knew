import { z } from "zod";
import { ENGINE_DEFAULTS } from "./defaults.ts";
import { FIELD_RE, ID_RE, KEY_RE } from "./patterns.ts";
import { asFactType, factType, whoLabel, type Vocabulary } from "./vocabulary.ts";

/**
 * A LENS is a direction over what is known, for an objective: the sentence
 * that says what the knower wants to be able to do, the asks that are its
 * knowledge requirements — weighted, so the gaps have an order and the top
 * one is the next question — the types a reader must hold in view while
 * acting, and how the page reads. Several lenses read one vocabulary's facts.
 * Writing never names a lens, so changing one never touches an episode or a
 * fact: a lens is the cheap half to change, a vocabulary the expensive one.
 *
 * Everything a lens leaves out has a default. The sections are the
 * vocabulary's dimensions, in order; the asks are each dimension's question;
 * the pinned types are the ones the vocabulary pins; and every ask weighs 1
 * and is met by one fresh fact (`ENGINE_DEFAULTS`).
 *
 * Like a vocabulary, a lens is DATA A CLIENT REGISTERS, validated by
 * `lensDefinitionSchema` and compiled against its vocabulary by
 * `compileLens`, which names every reference that does not resolve.
 */

export interface AskSpec {
  /** `^[a-z][a-z0-9-]{1,63}$`, unique within the lens. */
  id: string;
  /** The question, as the knower would be asked it. Default: its
   *  dimension's question. */
  question?: string;
  /** The dimension whose facts answer it. An ask names a dimension or the
   *  types that answer it, never both. */
  dimension?: string;
  /** Fact types a current fact of which answers it. */
  answeredBy?: string[];
  /** Applies only when every clause matches one of the entity's fields
   *  (case-insensitive). Absent: applies to everyone. */
  when?: Array<{ field: string; equals: string[] }>;
  /** How much it matters to the objective, relative to the other asks: more
   *  than 0, at most 1,000. Default 1. */
  weight?: number;
  /** How many current facts, each said within its type's revisit window, meet
   *  it — facts, not tellings. Default 1. */
  enough?: number;
  /** Asks that must be answered first: this one is not offered until they
   *  are. Coarse before fine. */
  after?: string[];
}

export interface SectionSpec {
  heading: string;
  /** The dimensions whose facts it holds. */
  dimensions: string[];
}

export interface LensDefinition {
  /** The client's name for it: `^[a-z][a-z0-9-]{1,31}$`. */
  id: string;
  /** Bumped by the client when anything below changes. */
  version: number;
  /** What the knower wants to be able to do relative to the entity, in one
   *  sentence. A reader writes toward it; the asks are what it needs known. */
  objective?: string;
  /** The vocabulary it reads, by id. */
  vocabulary: string;
  /** The page's first line. `{who}` becomes the name, with the vocabulary's
   *  prompt fields in parentheses when there are any. */
  header: string;
  /** The heading for facts past their own end date. */
  overHeading: string;
  /** The page's sections, in reading order. Default: one per dimension,
   *  headed by its label. Given, they hold every dimension exactly once. */
  sections?: SectionSpec[];
  /** The fact types a reader must honor rather than weigh. Default: the ones
   *  the vocabulary pins. */
  pinned?: string[];
  /** Attribute names whose value is shown in brackets after a fact line. */
  attributeTags?: string[];
  /** The knowledge the objective needs. Default: one ask per dimension that
   *  has a question. */
  asks?: AskSpec[];
}

const askSpecSchema = z.object({
  id: z.string().regex(KEY_RE),
  question: z.string().min(1).optional(),
  dimension: z.string().regex(KEY_RE).optional(),
  answeredBy: z.array(z.string()).min(1).optional(),
  when: z.array(z.object({ field: z.string().regex(FIELD_RE), equals: z.array(z.string().min(1)).min(1) })).optional(),
  weight: z.number().positive().max(1000).optional(),
  enough: z.number().int().min(1).optional(),
  after: z.array(z.string().regex(KEY_RE)).min(1).optional(),
});

/** The first circle in the asks' `after` graph, as ids, or null. */
function circleIn(asks: ReadonlyArray<{ id: string; after?: string[] | undefined }>): string[] | null {
  const after = new Map(asks.map((ask) => [ask.id, ask.after ?? []]));
  const state = new Map<string, "visiting" | "done">();
  const path: string[] = [];
  const visit = (id: string): string[] | null => {
    if (state.get(id) === "done") return null;
    if (state.get(id) === "visiting") return [...path.slice(path.indexOf(id)), id];
    state.set(id, "visiting");
    path.push(id);
    for (const next of after.get(id) ?? []) {
      if (!after.has(next)) continue;
      const circle = visit(next);
      if (circle) return circle;
    }
    path.pop();
    state.set(id, "done");
    return null;
  };
  for (const ask of asks) {
    const circle = visit(ask.id);
    if (circle) return circle;
  }
  return null;
}

export const lensDefinitionSchema: z.ZodType<LensDefinition> = z
  .object({
    id: z.string().regex(ID_RE),
    version: z.number().int().min(1),
    objective: z.string().min(1).optional(),
    vocabulary: z.string().regex(ID_RE),
    header: z.string().includes("{who}"),
    overHeading: z.string().min(1),
    sections: z
      .array(z.object({ heading: z.string().min(1), dimensions: z.array(z.string().regex(KEY_RE)).min(1) }))
      .min(1)
      .optional(),
    pinned: z.array(z.string()).optional(),
    attributeTags: z.array(z.string()).optional(),
    asks: z.array(askSpecSchema).optional(),
  })
  .superRefine((lens, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: "custom", message });
    const asks = lens.asks ?? [];
    const ids = new Set<string>();
    for (const ask of asks) {
      if (ids.has(ask.id)) issue(`ask ${ask.id} is listed twice`);
      ids.add(ask.id);
      if ((ask.dimension === undefined) === (ask.answeredBy === undefined)) {
        issue(`ask ${ask.id} names a dimension or the types that answer it — one, not both and not neither`);
      }
      if (ask.answeredBy !== undefined && ask.question === undefined) {
        issue(`ask ${ask.id} is answered by types, so it must say what it asks`);
      }
    }
    for (const ask of asks) {
      const seen = new Set<string>();
      for (const target of ask.after ?? []) {
        if (seen.has(target)) issue(`ask ${ask.id} waits on ${target} twice`);
        seen.add(target);
        if (target === ask.id) issue(`ask ${ask.id} waits on itself`);
        else if (!ids.has(target)) issue(`ask ${ask.id} waits on ${target}, which is not an ask`);
      }
    }
    const circle = circleIn(asks.map((ask) => ({ id: ask.id, after: (ask.after ?? []).filter((target) => target !== ask.id) })));
    if (circle) issue(`asks ${circle.join(" → ")} wait on each other in a circle`);
    const placed = new Set<string>();
    for (const section of lens.sections ?? []) {
      for (const dimension of section.dimensions) {
        if (placed.has(dimension)) issue(`dimension ${dimension} is in two sections`);
        placed.add(dimension);
      }
    }
  }) as z.ZodType<LensDefinition>;

/** Validate a definition's own shape, as a client sends it. Throws with every
 *  problem named. References into the vocabulary are checked by `compileLens`. */
export function parseLensDefinition(input: unknown): LensDefinition {
  return lensDefinitionSchema.parse(input);
}

/** Every reference in a lens its vocabulary does not resolve, named. Empty
 *  when the lens reads its vocabulary cleanly. */
export function lensProblems(definition: LensDefinition, vocabulary: Vocabulary): string[] {
  const problems: string[] = [];
  if (definition.vocabulary !== vocabulary.id) {
    problems.push(`it reads vocabulary ${definition.vocabulary}, and was given ${vocabulary.id}`);
  }
  const dimensions = new Map(vocabulary.dimensions.map((d) => [d.id, d]));
  if (definition.sections) {
    const placed = new Set(definition.sections.flatMap((section) => section.dimensions));
    for (const dimension of placed) {
      if (!dimensions.has(dimension)) problems.push(`a section holds dimension ${dimension}, which the vocabulary does not have`);
    }
    for (const dimension of dimensions.keys()) {
      if (!placed.has(dimension)) problems.push(`dimension ${dimension} is in no section, so its facts would never be on the page`);
    }
  }
  for (const type of definition.pinned ?? []) {
    if (!(type in vocabulary.factTypes)) problems.push(`pinned names ${type}, which is not a fact type`);
  }
  const attributes = new Set(vocabulary.extractAttributes.map((field) => field.name));
  for (const tag of definition.attributeTags ?? []) {
    if (!attributes.has(tag)) problems.push(`attributeTags names ${tag}, which no type carries`);
  }
  for (const ask of definition.asks ?? []) {
    if (ask.dimension !== undefined) {
      const dimension = dimensions.get(ask.dimension);
      if (!dimension) problems.push(`ask ${ask.id} asks about dimension ${ask.dimension}, which the vocabulary does not have`);
      else if (ask.question === undefined && dimension.question === null) {
        problems.push(`ask ${ask.id} has no question, and dimension ${ask.dimension} has none to lend it`);
      }
    }
    for (const type of ask.answeredBy ?? []) {
      if (!(type in vocabulary.factTypes)) problems.push(`ask ${ask.id} is answered by ${type}, which is not a fact type`);
    }
    for (const clause of ask.when ?? []) {
      if (!vocabulary.fields.includes(clause.field)) {
        problems.push(`ask ${ask.id} applies when ${clause.field} matches, which is not one of the vocabulary's fields`);
      }
    }
  }
  return problems;
}

export interface CompiledAsk {
  id: string;
  question: string;
  /** The dimension it asks about, or null when it names its types. */
  dimension: string | null;
  /** The types whose facts answer it: its own list, or every type in its
   *  dimension. */
  answeredBy: readonly string[];
  when: ReadonlyArray<{ field: string; equals: readonly string[] }>;
  weight: number;
  enough: number;
  after: readonly string[];
}

export interface CompiledSection {
  heading: string;
  dimensions: readonly string[];
}

export interface Lens {
  definition: LensDefinition;
  id: string;
  version: number;
  objective: string | null;
  vocabulary: Vocabulary;
  header: string;
  overHeading: string;
  sections: readonly CompiledSection[];
  /** Which section, by index, holds each dimension. */
  sectionOfDimension: ReadonlyMap<string, number>;
  pinned: ReadonlySet<string>;
  attributeTags: readonly string[];
  asks: readonly CompiledAsk[];
}

/** Compile a validated definition against the vocabulary it reads. Throws
 *  with every unresolved reference named. */
export function compileLens(definition: LensDefinition, vocabulary: Vocabulary): Lens {
  const problems = lensProblems(definition, vocabulary);
  if (problems.length > 0) throw new Error(`lens ${definition.id}@${definition.version}: ${problems.join("; ")}`);
  const sections: CompiledSection[] =
    definition.sections?.map((section) => ({ heading: section.heading, dimensions: [...section.dimensions] })) ??
    vocabulary.dimensions.map((dimension) => ({ heading: dimension.label, dimensions: [dimension.id] }));
  const sectionOfDimension = new Map<string, number>();
  sections.forEach((section, index) => {
    for (const dimension of section.dimensions) sectionOfDimension.set(dimension, index);
  });
  const question = new Map(vocabulary.dimensions.map((d) => [d.id, d.question]));
  const typesIn = (dimension: string) => vocabulary.factTypeKeys.filter((key) => vocabulary.factTypes[key]!.dimension === dimension);
  const specs: AskSpec[] =
    definition.asks ??
    vocabulary.dimensions.filter((dimension) => dimension.question !== null).map((dimension) => ({ id: dimension.id, dimension: dimension.id }));
  return {
    definition,
    id: definition.id,
    version: definition.version,
    objective: definition.objective ?? null,
    vocabulary,
    header: definition.header,
    overHeading: definition.overHeading,
    sections,
    sectionOfDimension,
    pinned: new Set(definition.pinned ?? vocabulary.factTypeKeys.filter((key) => vocabulary.factTypes[key]!.pinned)),
    attributeTags: definition.attributeTags ?? [],
    asks: specs.map((ask) => ({
      id: ask.id,
      question: ask.question ?? question.get(ask.dimension!)!,
      dimension: ask.dimension ?? null,
      answeredBy: ask.answeredBy ? [...ask.answeredBy] : typesIn(ask.dimension!),
      when: (ask.when ?? []).map((clause) => ({ field: clause.field, equals: [...clause.equals] })),
      weight: ask.weight ?? ENGINE_DEFAULTS.weight,
      enough: ask.enough ?? ENGINE_DEFAULTS.enough,
      after: [...(ask.after ?? [])],
    })),
  };
}

/** Validate and compile in one step. */
export function lensFrom(input: unknown, vocabulary: Vocabulary): Lens {
  return compileLens(parseLensDefinition(input), vocabulary);
}

/** Whether a reader must honor a fact of this stored type rather than weigh
 *  it. A retired type reads as the fallback, as everywhere. */
export function isPinnedFactType(lens: Lens, type: string): boolean {
  return lens.pinned.has(asFactType(lens.vocabulary, type));
}

/** The index of the section a fact of this stored type is printed under. */
export function sectionIndexOf(lens: Lens, type: string): number {
  return lens.sectionOfDimension.get(factType(lens.vocabulary, type).dimension)!;
}

/** The first line of the page, from the lens's template. */
export function briefHeader(lens: Lens, entity: { name: string; fields: Readonly<Record<string, string | null>> }): string {
  return lens.header.replaceAll("{who}", whoLabel(lens.vocabulary, entity));
}

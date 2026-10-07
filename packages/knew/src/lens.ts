import { z } from "zod";
import { ENGINE_DEFAULTS } from "./defaults.ts";
import { FIELD_RE, ID_RE, KEY_RE } from "./patterns.ts";
import { asFactType, factType, whoLabel, type Vocabulary } from "./vocabulary.ts";

/**
 * A LENS reads what is understood about an entity for one objective: the
 * sentence saying what the knower wants to do, the needs that objective puts
 * on their understanding (weighted, so the next direction is the most
 * valuable one), the types a reader must hold in view, and how the page
 * reads. Several lenses read one vocabulary's facts. Writing never names a
 * lens, so a lens is cheap to change.
 *
 * Everything a lens leaves out has a default: one section per dimension, in
 * order; one need per dimension; the vocabulary's pinned types; and every
 * need weighs 1 and is met by one fresh fact (`ENGINE_DEFAULTS`).
 *
 * Like a vocabulary, a lens is DATA A CLIENT REGISTERS, validated by
 * `lensDefinitionSchema` and compiled against its vocabulary by
 * `compileLens`, which names every reference that does not resolve.
 */

/** Something the objective needs understood about the entity. */
export interface NeedSpec {
  /** `^[a-z][a-z0-9-]{1,63}$`, unique within the lens. */
  id: string;
  /** What to understand, as a reader calls it. Default: its dimension's
   *  label. Required when the need names its types. */
  label?: string;
  /** The dimension whose facts count toward it. A need names a dimension or
   *  its types, never both. */
  dimension?: string;
  /** The fact types whose current facts count toward it. */
  types?: string[];
  /** Applies only when every clause matches one of the entity's fields
   *  (case-insensitive). Absent: applies to everyone. */
  when?: Array<{ field: string; equals: string[] }>;
  /** How much it matters to the objective, relative to the other needs: more
   *  than 0, at most 1,000. Default 1. */
  weight?: number;
  /** How many current facts, each said within its type's revisit window, meet
   *  it. Default 1. */
  enough?: number;
  /** Needs that must be met first: this one is not a direction until they
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
  /** What the objective needs understood. Default: one need per dimension. */
  needs?: NeedSpec[];
}

const needSpecSchema = z.object({
  id: z.string().regex(KEY_RE),
  label: z.string().min(1).optional(),
  dimension: z.string().regex(KEY_RE).optional(),
  types: z.array(z.string()).min(1).optional(),
  when: z.array(z.object({ field: z.string().regex(FIELD_RE), equals: z.array(z.string().min(1)).min(1) })).optional(),
  weight: z.number().positive().max(1000).optional(),
  enough: z.number().int().min(1).optional(),
  after: z.array(z.string().regex(KEY_RE)).min(1).optional(),
});

/** The first circle in the needs' `after` graph, as ids, or null. */
function circleIn(needs: ReadonlyArray<{ id: string; after?: string[] | undefined }>): string[] | null {
  const after = new Map(needs.map((need) => [need.id, need.after ?? []]));
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
  for (const need of needs) {
    const circle = visit(need.id);
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
    needs: z.array(needSpecSchema).optional(),
  })
  .superRefine((lens, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: "custom", message });
    const needs = lens.needs ?? [];
    const ids = new Set<string>();
    for (const need of needs) {
      if (ids.has(need.id)) issue(`need ${need.id} is listed twice`);
      ids.add(need.id);
      if ((need.dimension === undefined) === (need.types === undefined)) {
        issue(`need ${need.id} names a dimension or its types — one, not both and not neither`);
      }
      if (need.types !== undefined && need.label === undefined) {
        issue(`need ${need.id} names its types, so it must have a label`);
      }
    }
    for (const need of needs) {
      const seen = new Set<string>();
      for (const target of need.after ?? []) {
        if (seen.has(target)) issue(`need ${need.id} waits on ${target} twice`);
        seen.add(target);
        if (target === need.id) issue(`need ${need.id} waits on itself`);
        else if (!ids.has(target)) issue(`need ${need.id} waits on ${target}, which is not a need`);
      }
    }
    const circle = circleIn(needs.map((need) => ({ id: need.id, after: (need.after ?? []).filter((target) => target !== need.id) })));
    if (circle) issue(`needs ${circle.join(" → ")} wait on each other in a circle`);
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
  for (const need of definition.needs ?? []) {
    if (need.dimension !== undefined && !dimensions.has(need.dimension)) {
      problems.push(`need ${need.id} names dimension ${need.dimension}, which the vocabulary does not have`);
    }
    for (const type of need.types ?? []) {
      if (!(type in vocabulary.factTypes)) problems.push(`need ${need.id} counts ${type}, which is not a fact type`);
    }
    for (const clause of need.when ?? []) {
      if (!vocabulary.fields.includes(clause.field)) {
        problems.push(`need ${need.id} applies when ${clause.field} matches, which is not one of the vocabulary's fields`);
      }
    }
  }
  return problems;
}

export interface CompiledNeed {
  id: string;
  label: string;
  /** Its dimension, or null when it names its types. */
  dimension: string | null;
  /** The types whose facts count toward it: its own list, or every type in
   *  its dimension. */
  types: readonly string[];
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
  needs: readonly CompiledNeed[];
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
  const label = new Map(vocabulary.dimensions.map((d) => [d.id, d.label]));
  const typesIn = (dimension: string) => vocabulary.factTypeKeys.filter((key) => vocabulary.factTypes[key]!.dimension === dimension);
  const specs: NeedSpec[] = definition.needs ?? vocabulary.dimensions.map((dimension) => ({ id: dimension.id, dimension: dimension.id }));
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
    needs: specs.map((need) => ({
      id: need.id,
      label: need.label ?? label.get(need.dimension!)!,
      dimension: need.dimension ?? null,
      types: need.types ? [...need.types] : typesIn(need.dimension!),
      when: (need.when ?? []).map((clause) => ({ field: clause.field, equals: [...clause.equals] })),
      weight: need.weight ?? ENGINE_DEFAULTS.weight,
      enough: need.enough ?? ENGINE_DEFAULTS.enough,
      after: [...(need.after ?? [])],
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

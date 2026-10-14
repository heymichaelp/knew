import { z } from "zod";
import { ENGINE_DEFAULTS } from "./defaults.ts";
import { FIELD_RE, ID_RE, KEY_RE } from "./patterns.ts";
import type { Vocabulary } from "./vocabulary.ts";

/**
 * An ADAPTER is one kind of move an app may make about an entity, as data a
 * client registers: a moment to mark, a search to run, whatever its product
 * does with what is known. Once a note is read, the model is asked, under each
 * adapter, which open moves of that kind no longer stand and what the kind
 * calls for now, and a proposal the engine keeps rests on facts the note's
 * entity holds. knew performs none of them: a move is the app's to act on.
 *
 * Like a lens, an adapter reads one vocabulary and is the cheap half to
 * change; unlike a lens, it is used at write time, by the `move` call. The
 * core names no kind; the presets ship two (`person.moments`,
 * `person.watches`), and a product's own is `extendAdapter` or a definition
 * of its own.
 */

export interface MoveFieldSpec {
  /** What the field holds, written for the model. */
  description: string;
  /** `text` (default), a `date` (`YYYY-MM-DD`), or an `enum` of `values`. */
  kind?: "text" | "date" | "enum";
  values?: string[];
}

export interface AdapterDefinition {
  /** The client's name for it: `^[a-z][a-z0-9-]{1,31}$`. Stored on every move it proposes. */
  id: string;
  version: number;
  /** The vocabulary it reads. */
  vocabulary: string;
  /** One move of this kind, as a reader calls it: "moment", "search". Singular. */
  noun: string;
  /** What to propose and what never to, written for the model in the
   *  charter's voice. Markdown. */
  instructions: string;
  /** Fields a move carries beside its label, each filled by the model or
   *  left null. At most six. */
  fields?: Record<string, MoveFieldSpec>;
  /** Open moves per entity. Default `ENGINE_DEFAULTS.movesPerEntity`. */
  perEntity?: number;
  /** When a move nobody acted on leaves the list: `afterDays` from when it
   *  was proposed (default `ENGINE_DEFAULTS.moveLapseDays`), or, when the
   *  adapter names a `date` field and the move has a day in it, once that day
   *  has passed, which then governs. */
  lapse?: { afterDays?: number; field?: string };
  /** The dimensions a move may rest on, by id. Default: every one about the
   *  entity or the relationship. Never one about the knower. */
  dimensions?: string[];
}

const MAX_FIELDS = 6;

const fieldSpecSchema = z
  .object({
    description: z.string().min(1),
    kind: z.enum(["text", "date", "enum"]).optional(),
    values: z.array(z.string().min(1)).min(1).optional(),
  })
  .refine((spec) => (spec.kind === "enum") === (spec.values !== undefined), {
    message: "an enum field names its values, and only an enum does",
  });

export const adapterDefinitionSchema: z.ZodType<AdapterDefinition> = z
  .object({
    id: z.string().regex(ID_RE),
    version: z.number().int().min(1),
    vocabulary: z.string().regex(ID_RE),
    noun: z.string().min(1),
    instructions: z.string().min(1),
    fields: z.record(z.string().regex(FIELD_RE), fieldSpecSchema).optional(),
    perEntity: z.number().int().min(1).optional(),
    lapse: z.object({ afterDays: z.number().int().min(1).optional(), field: z.string().regex(FIELD_RE).optional() }).optional(),
    dimensions: z.array(z.string().regex(KEY_RE)).min(1).optional(),
  })
  .superRefine((adapter, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: "custom", message });
    const fields = adapter.fields ?? {};
    if (Object.keys(fields).length > MAX_FIELDS) issue(`an adapter carries at most ${MAX_FIELDS} fields`);
    const field = adapter.lapse?.field;
    if (field !== undefined) {
      const spec = fields[field];
      if (!spec) issue(`lapse names field ${field}, which the adapter does not have`);
      else if (spec.kind !== "date") issue(`lapse names field ${field}, which is not a date`);
    }
  }) as z.ZodType<AdapterDefinition>;

/** Validate a definition's own shape, as a client sends it. Throws with every
 *  problem named. References into the vocabulary are checked by `compileAdapter`. */
export function parseAdapterDefinition(input: unknown): AdapterDefinition {
  return adapterDefinitionSchema.parse(input);
}

/** Every reference in an adapter its vocabulary does not resolve, named. */
export function adapterProblems(definition: AdapterDefinition, vocabulary: Vocabulary): string[] {
  const problems: string[] = [];
  if (definition.vocabulary !== vocabulary.id) {
    problems.push(`it reads vocabulary ${definition.vocabulary}, and was given ${vocabulary.id}`);
  }
  const dimensions = new Map(vocabulary.dimensions.map((dimension) => [dimension.id, dimension]));
  for (const id of definition.dimensions ?? []) {
    const dimension = dimensions.get(id);
    if (!dimension) problems.push(`it names dimension ${id}, which the vocabulary does not have`);
    else if (dimension.about === "knower") problems.push(`it names dimension ${id}, which is about the knower; nothing is proposed about the knower`);
  }
  return problems;
}

export interface CompiledMoveField {
  name: string;
  description: string;
  kind: "text" | "date" | "enum";
  values: readonly string[] | null;
}

export interface Adapter {
  definition: AdapterDefinition;
  id: string;
  version: number;
  vocabulary: Vocabulary;
  noun: string;
  instructions: string;
  fields: readonly CompiledMoveField[];
  perEntity: number;
  lapse: { afterDays: number; field: string | null };
  /** The dimensions a move may rest on. */
  dimensions: readonly string[];
}

/** Compile a validated definition against the vocabulary it reads. Throws
 *  with every unresolved reference named. */
export function compileAdapter(definition: AdapterDefinition, vocabulary: Vocabulary): Adapter {
  const problems = adapterProblems(definition, vocabulary);
  if (problems.length > 0) throw new Error(`adapter ${definition.id}@${definition.version}: ${problems.join("; ")}`);
  return {
    definition,
    id: definition.id,
    version: definition.version,
    vocabulary,
    noun: definition.noun,
    instructions: definition.instructions,
    fields: Object.entries(definition.fields ?? {}).map(([name, spec]) => ({
      name,
      description: spec.description,
      kind: spec.kind ?? "text",
      values: spec.values ? [...spec.values] : null,
    })),
    perEntity: definition.perEntity ?? ENGINE_DEFAULTS.movesPerEntity,
    lapse: { afterDays: definition.lapse?.afterDays ?? ENGINE_DEFAULTS.moveLapseDays, field: definition.lapse?.field ?? null },
    dimensions: definition.dimensions ?? vocabulary.dimensions.filter((dimension) => dimension.about !== "knower").map((dimension) => dimension.id),
  };
}

/** Validate and compile in one step. */
export function adapterFrom(input: unknown, vocabulary: Vocabulary): Adapter {
  return compileAdapter(parseAdapterDefinition(input), vocabulary);
}

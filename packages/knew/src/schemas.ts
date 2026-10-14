import { z } from "zod";
import type { Adapter } from "./adapter.ts";
import type { Vocabulary } from "./vocabulary.ts";

/**
 * The model calls' output schemas. Deliberately permissive — no length
 * caps, nullable rather than optional — because one over-long string must
 * never void a whole episode. Length discipline is the prompt's job; the
 * planner trims at use.
 *
 * The attributes object spells every attribute any type carries as an
 * explicit nullable key rather than an open record, because a structured
 * output endpoint can reject the `propertyNames` keyword a record compiles
 * to. `compiledSchemaProblems` guards every vocabulary's compiled schema.
 */
export function extractSchemaFor(vocabulary: Vocabulary) {
  const attributeShape: Record<string, z.ZodTypeAny> = {};
  for (const field of vocabulary.extractAttributes) attributeShape[field.name] = field.schema.nullable();
  return z.object({
    facts: z.array(
      z.object({
        entityId: z.string(),
        type: z.enum(vocabulary.factTypeKeys as [string, ...string[]]),
        fact: z.string(),
        /** Every attribute any type carries, each nullable: the fact's own
         *  type keeps the ones it defines and the rest are dropped at write. */
        attributes: z.object(attributeShape).nullable(),
        /** YYYY, YYYY-MM or YYYY-MM-DD; null when not said. */
        validAt: z.string().nullable(),
        invalidAt: z.string().nullable(),
      }),
    ),
    /** Other names the knower used for an entry on the roster. */
    aliases: z.array(z.object({ entityId: z.string(), alias: z.string() })),
    /** Names mentioned that are not on the roster — never given facts. */
    unresolvedNames: z.array(z.string()),
    /** Changes to fields the knower owns; proposed, never written. A
     *  vocabulary with no fields takes any field name here, because the one
     *  schema that accepts none (`never`, compiled to `not`) is refused by
     *  the structured-output endpoints; `cleanProposals` drops every update
     *  naming a field the vocabulary does not have. */
    fieldUpdates: z.array(
      z.object({
        entityId: z.string(),
        field: vocabulary.fields.length > 0 ? z.enum(vocabulary.fields as [string, ...string[]]) : z.string(),
        value: z.string(),
      }),
    ),
  });
}

export type Extraction = z.infer<ReturnType<typeof extractSchemaFor>>;

export const reconcileSchema = z.object({
  decisions: z.array(
    z.object({
      /** Index into the new facts as numbered in the input. */
      newIndex: z.number().int(),
      action: z.enum(["add", "merge", "supersede", "drop"]),
      /** The current fact merged into or superseded; null for add/drop. */
      factId: z.string().nullable(),
      /** When the superseded fact stopped being true, if the knower said. */
      invalidAt: z.string().nullable(),
    }),
  ),
  summary: z.string(),
});

export type Reconciliation = z.infer<typeof reconcileSchema>;

/**
 * The `next` call's answer: which open directions the new facts answered,
 * which to withdraw, and what to learn next, each inside one dimension of the
 * entity or the relationship. The knower's dimensions are not offered. The
 * enum is never empty: the fallback type's dimension is about the entity.
 */
export function nextSchemaFor(vocabulary: Vocabulary) {
  const dimensions = vocabulary.dimensions.filter((dimension) => dimension.about !== "knower").map((dimension) => dimension.id);
  return z.object({
    answered: z.array(z.object({ directionId: z.string(), factId: z.string() })),
    withdrawn: z.array(z.string()),
    proposed: z.array(
      z.object({
        dimension: z.enum(dimensions as [string, ...string[]]),
        /** A topic, never a question: the planner refuses a label ending in `?`. */
        label: z.string(),
        /** The facts it grows from, by id; empty for a basic. */
        factIds: z.array(z.string()),
      }),
    ),
  });
}

export type NextAnswer = z.infer<ReturnType<typeof nextSchemaFor>>;

/** What the `move` call answers, under one adapter. */
export interface MoveAnswer {
  closed: Array<{ moveId: string; reason: "done" | "answered" | "stale" }>;
  proposed: Array<{ label: string; factIds: string[]; fields?: Record<string, string | null> }>;
}

/**
 * The `move` call's answer schema for one adapter: which open moves no longer
 * stand, and what to propose, each with the adapter's fields as an object of
 * nullable keys (never a record, which a structured-output endpoint refuses).
 * An adapter with no fields leaves the key out, since an empty object is
 * untested on the device.
 */
export function moveSchemaFor(adapter: Adapter) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of adapter.fields) shape[field.name] = (field.values ? z.enum(field.values as [string, ...string[]]) : z.string()).nullable();
  const row = {
    /** A topic or a gesture in one line, never a question: the planner refuses a label ending in `?`. */
    label: z.string(),
    /** The facts it rests on, by id; never empty. */
    factIds: z.array(z.string()),
    ...(adapter.fields.length > 0 ? { fields: z.object(shape) } : {}),
  };
  return z.object({
    closed: z.array(z.object({ moveId: z.string(), reason: z.enum(["done", "answered", "stale"]) })),
    proposed: z.array(z.object(row)),
  });
}

/** Keywords a structured-output endpoint may refuse. A vocabulary whose
 *  compiled schema carries one would fail every live episode: `not` is what
 *  `never` compiles to, and the first live lens with no routing fields found
 *  it. */
export const REFUSED_SCHEMA_KEYWORDS = ["propertyNames", "patternProperties", "not"] as const;

export function compiledSchemaProblems(schema: z.ZodTypeAny): string[] {
  const compiled = JSON.stringify(z.toJSONSchema(schema));
  return REFUSED_SCHEMA_KEYWORDS.filter((keyword) => compiled.includes(`"${keyword}"`));
}

import { z } from "zod";
import type { Lens } from "./lens.ts";

/**
 * The two model calls' output schemas. Deliberately permissive — no length
 * caps, nullable rather than optional — because one over-long string must
 * never void a whole episode. Length discipline is the prompt's job; the
 * planner trims at use.
 *
 * The attributes object spells every attribute any type carries as an
 * explicit nullable key rather than an open record, because a structured
 * output endpoint can reject the `propertyNames` keyword a record compiles
 * to. `compiledSchemaProblems` guards every lens's compiled schema.
 */
export function extractSchemaFor(lens: Lens) {
  const attributeShape: Record<string, z.ZodTypeAny> = {};
  for (const field of lens.extractAttributes) attributeShape[field.name] = field.schema.nullable();
  return z.object({
    facts: z.array(
      z.object({
        personId: z.string(),
        type: z.enum(lens.factTypeKeys as [string, ...string[]]),
        fact: z.string(),
        /** Every attribute any type carries, each nullable: the fact's own
         *  type keeps the ones it defines and the rest are dropped at write. */
        attributes: z.object(attributeShape).nullable(),
        /** YYYY, YYYY-MM or YYYY-MM-DD; null when not said. */
        validAt: z.string().nullable(),
        invalidAt: z.string().nullable(),
      }),
    ),
    /** Other names the person used for someone on the roster. */
    aliases: z.array(z.object({ personId: z.string(), alias: z.string() })),
    /** People mentioned who are not on the roster — never given facts. */
    unresolvedNames: z.array(z.string()),
    /** Changes to fields the person owns; proposed, never written. A lens
     *  with no routing fields gets a schema that accepts none. */
    fieldUpdates: z.array(
      z.object({
        personId: z.string(),
        field: lens.routingFields.length > 0 ? z.enum(lens.routingFields as [string, ...string[]]) : z.never(),
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
      /** When the superseded fact stopped being true, if the person said. */
      invalidAt: z.string().nullable(),
    }),
  ),
  summary: z.string(),
});

export type Reconciliation = z.infer<typeof reconcileSchema>;

/** Keywords a structured-output endpoint may refuse. A lens whose compiled
 *  schema carries one would fail every live episode. */
export const REFUSED_SCHEMA_KEYWORDS = ["propertyNames", "patternProperties"] as const;

export function compiledSchemaProblems(schema: z.ZodTypeAny): string[] {
  const compiled = JSON.stringify(z.toJSONSchema(schema));
  return REFUSED_SCHEMA_KEYWORDS.filter((keyword) => compiled.includes(`"${keyword}"`));
}

import { z } from "zod";
import type { LensDefinition } from "./lens.ts";
import { KEY_RE } from "./patterns.ts";
import type { AttributeSpec, VocabularyDefinition } from "./vocabulary.ts";

/**
 * The 0.x lens — taxonomy and reading in one object — and the mechanical move
 * that splits it into a vocabulary and a lens. A client, or the service for
 * every lens it stored, runs `fromLegacyLens` once; the vocabulary renders
 * the same page and reports the same gaps the 0.x lens did, because each
 * section becomes a dimension with the section's heading as its label, and
 * the lens leaves its sections, pinned types and asks to the defaults that
 * reproduce them.
 *
 * Kept only to read 0.x JSON. Nothing in the engine reads a legacy lens.
 */

export interface LegacyFactTypeSpec {
  description: string;
  section: string;
  attributes?: AttributeSpec[];
  pinned?: boolean;
  enduring?: boolean;
}

export interface LegacyAskSpec {
  id: string;
  question: string;
  when?: Array<{ field: string; equals: string[] }>;
  answeredBy: string[];
}

/** A lens as 0.x registered it. */
export interface LegacyLensDefinition {
  id: string;
  version: number;
  factTypes: Record<string, LegacyFactTypeSpec>;
  briefSections: Array<{ section: string; heading: string }>;
  briefHeader: string;
  overHeading: string;
  fallbackType: string;
  sourceLabels?: Record<string, string>;
  routingFields: string[];
  promptFields?: string[];
  briefAttributeTags?: string[];
  entityKinds?: string[];
  charter: string;
  asks?: LegacyAskSpec[];
  prompts?: { extract?: string; reconcile?: string };
  extractAttributeKeys?: string[];
}

/** The 0.x schema, shape only: a definition it accepts is one 0.x stored.
 *  The split is validated by the 1.0 schemas it produces. */
export const legacyLensDefinitionSchema: z.ZodType<LegacyLensDefinition> = z.object({
  id: z.string(),
  version: z.number().int().min(1),
  factTypes: z.record(
    z.string(),
    z.object({
      description: z.string().min(1),
      section: z.string().min(1),
      attributes: z
        .array(
          z.object({
            name: z.string(),
            kind: z.enum(["string", "boolean", "number", "enum"]),
            values: z.array(z.string()).optional(),
            optional: z.boolean().optional(),
          }),
        )
        .optional(),
      pinned: z.boolean().optional(),
      enduring: z.boolean().optional(),
    }),
  ),
  briefSections: z.array(z.object({ section: z.string().min(1), heading: z.string().min(1) })).min(1),
  briefHeader: z.string(),
  overHeading: z.string(),
  fallbackType: z.string(),
  sourceLabels: z.record(z.string(), z.string()).optional(),
  routingFields: z.array(z.string()),
  promptFields: z.array(z.string()).optional(),
  briefAttributeTags: z.array(z.string()).optional(),
  entityKinds: z.array(z.string()).optional(),
  charter: z.string(),
  asks: z
    .array(
      z.object({
        id: z.string(),
        question: z.string(),
        when: z.array(z.object({ field: z.string(), equals: z.array(z.string()) })).optional(),
        answeredBy: z.array(z.string()),
      }),
    )
    .optional(),
  prompts: z.object({ extract: z.string().optional(), reconcile: z.string().optional() }).optional(),
  extractAttributeKeys: z.array(z.string()).optional(),
}) as z.ZodType<LegacyLensDefinition>;

/** A section id as a dimension id. 0.x took any string; a dimension id has a
 *  pattern, so one that misses it is slugged, and marked so it cannot
 *  collide with a section that already fit. Dimension ids are never stored
 *  on a fact, so renaming one costs nothing. */
function dimensionIdFor(section: string, taken: Set<string>): string {
  let id = section;
  if (!KEY_RE.test(id)) {
    const slug = section.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    id = `section-${slug || "unnamed"}`.slice(0, 64).replace(/-+$/, "");
  }
  let unique = id;
  for (let n = 2; taken.has(unique); n += 1) unique = `${id}-${n}`;
  taken.add(unique);
  return unique;
}

/**
 * Split a 0.x lens into a vocabulary and a lens over it. Both keep the 0.x id
 * and version, so episodes stamped under the old lens name the new
 * vocabulary.
 *
 * A section no type uses is dropped — a dimension holds at least one type,
 * and an empty section never printed anything. The first of `entityKinds` is
 * the kind (`person` when there were none); 1.0 reads one kind per
 * vocabulary.
 */
export function fromLegacyLens(input: unknown): { vocabulary: VocabularyDefinition; lens: LensDefinition } {
  const legacy = legacyLensDefinitionSchema.parse(input);
  const used = new Set(Object.values(legacy.factTypes).map((type) => type.section));
  const taken = new Set<string>();
  const dimensionOf = new Map<string, string>();
  const dimensions: VocabularyDefinition["dimensions"] = {};
  for (const { section, heading } of legacy.briefSections) {
    if (!used.has(section) || dimensionOf.has(section)) continue;
    const id = dimensionIdFor(section, taken);
    dimensionOf.set(section, id);
    dimensions[id] = { label: heading };
  }
  const factTypes: VocabularyDefinition["factTypes"] = {};
  for (const [key, type] of Object.entries(legacy.factTypes)) {
    factTypes[key] = {
      description: type.description,
      // A type in a section the brief had no heading for never parsed in 0.x;
      // its own section id is kept so the 1.0 schema names the problem.
      dimension: dimensionOf.get(type.section) ?? type.section,
      ...(type.attributes ? { attributes: type.attributes } : {}),
      ...(type.pinned !== undefined ? { pinned: type.pinned } : {}),
      ...(type.enduring !== undefined ? { enduring: type.enduring } : {}),
    };
  }
  const vocabulary: VocabularyDefinition = {
    id: legacy.id,
    version: legacy.version,
    kind: legacy.entityKinds?.[0] ?? "person",
    factTypes,
    dimensions,
    fallbackType: legacy.fallbackType,
    fields: legacy.routingFields,
    ...(legacy.promptFields ? { promptFields: legacy.promptFields } : {}),
    charter: legacy.charter,
    ...(legacy.sourceLabels ? { sourceLabels: legacy.sourceLabels } : {}),
    ...(legacy.prompts ? { prompts: legacy.prompts } : {}),
    ...(legacy.extractAttributeKeys ? { extractAttributeKeys: legacy.extractAttributeKeys } : {}),
  };
  const lens: LensDefinition = {
    id: legacy.id,
    version: legacy.version,
    vocabulary: legacy.id,
    header: legacy.briefHeader,
    overHeading: legacy.overHeading,
    ...(legacy.briefAttributeTags ? { attributeTags: legacy.briefAttributeTags } : {}),
    // 0.x had no asks field at all for a lens without questions; the default
    // would ask every dimension's question, and a migrated dimension has none,
    // so an empty list says the same thing more plainly.
    asks: (legacy.asks ?? []).map((ask) => ({
      id: ask.id,
      question: ask.question,
      answeredBy: ask.answeredBy,
      ...(ask.when ? { when: ask.when } : {}),
    })),
  };
  return { vocabulary, lens };
}

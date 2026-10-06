import { z } from "zod";
import type { LensDefinition } from "./lens.ts";
import { ID_RE, KEY_RE } from "./patterns.ts";
import type { AttributeSpec, VocabularyDefinition } from "./vocabulary.ts";

/**
 * The 0.x lens — taxonomy and reading in one object — and the mechanical move
 * that splits it into a vocabulary and a lens. A client, or the service for
 * every lens it stored, runs `fromLegacyLens` once. Each section becomes a
 * dimension with the section's heading as its label, and the lens leaves its
 * sections, pinned types and asks to the defaults that reproduce them, so the
 * result reports the same gaps the 0.x lens did and renders the same page —
 * byte for byte, unless the 0.x lens had a heading no type used (0.x counted
 * its heading against the page budget, so the 1.0 page has a little more
 * room) or listed a section twice (0.x printed its facts under both headings).
 * Every such difference is named in the result's `notes`.
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

const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** A section id as a dimension id. 0.x took any string; a dimension id has a
 *  pattern, so one that misses it is slugged, and marked so it cannot
 *  collide with a section that already fit. Dimension ids are never stored
 *  on a fact, so renaming one costs nothing. */
function dimensionIdFor(section: string, taken: Set<string>): string {
  let id = section;
  if (!KEY_RE.test(id)) id = `section-${slug(section) || "unnamed"}`.slice(0, 64).replace(/-+$/, "");
  let unique = id;
  for (let n = 2; taken.has(unique); n += 1) unique = `${id}-${n}`;
  taken.add(unique);
  return unique;
}

/** A 0.x entity kind as a 1.0 `kind`, which has the id pattern. */
function kindFor(raw: string): string {
  if (ID_RE.test(raw)) return raw;
  const id = slug(raw).slice(0, 32).replace(/-+$/, "");
  return ID_RE.test(id) ? id : `kind-${id || "unnamed"}`.slice(0, 32).replace(/-+$/, "");
}

/**
 * Split a 0.x lens into a vocabulary and a lens over it. Both keep the 0.x id
 * and version, so episodes stamped under the old lens name the new
 * vocabulary.
 *
 * A section no type uses is dropped — a dimension holds at least one type,
 * and an empty section never printed anything. The first of `entityKinds` is
 * the kind (`person` when there were none), slugged to the id pattern; 1.0
 * reads one kind per vocabulary, so any other kind is dropped. `notes` names
 * every change of that sort, in words a person can act on.
 */
export function fromLegacyLens(input: unknown): { vocabulary: VocabularyDefinition; lens: LensDefinition; notes: string[] } {
  const legacy = legacyLensDefinitionSchema.parse(input);
  const notes: string[] = [];
  const used = new Set(Object.values(legacy.factTypes).map((type) => type.section));
  const taken = new Set<string>();
  const dimensionOf = new Map<string, string>();
  const dimensions: VocabularyDefinition["dimensions"] = {};
  const seen = new Set<string>();
  for (const { section, heading } of legacy.briefSections) {
    if (seen.has(section)) {
      const id = dimensionOf.get(section);
      if (id) notes.push(`section ${section} was listed twice; its facts now print once, under "${dimensions[id]!.label}"`);
      continue;
    }
    seen.add(section);
    if (!used.has(section)) {
      notes.push(`section ${section} ("${heading}") holds no type, so it is not a dimension; the page no longer budgets for its heading`);
      continue;
    }
    const id = dimensionIdFor(section, taken);
    if (id !== section) notes.push(`section ${section} is dimension ${id}: a dimension id matches ${KEY_RE}`);
    dimensionOf.set(section, id);
    dimensions[id] = { label: heading };
  }
  const rawKind = legacy.entityKinds?.[0] ?? "person";
  const kind = kindFor(rawKind);
  if (kind !== rawKind) notes.push(`entity kind ${rawKind} is kind ${kind}: a kind matches ${ID_RE}`);
  const dropped = (legacy.entityKinds ?? []).slice(1);
  if (dropped.length > 0) notes.push(`entity kinds ${dropped.join(", ")} are dropped: a 1.0 vocabulary describes one kind, ${kind}`);
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
    kind,
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
  return { vocabulary, lens, notes };
}

import type { Subject } from "./types.ts";
import { z, type ZodTypeAny } from "zod";
import { FIELD_RE, ID_RE, KEY_RE, TYPE_KEY_RE } from "./patterns.ts";
import { EXTRACT_V2, RECONCILE_V2 } from "./prompts/index.ts";

/**
 * A VOCABULARY is what extraction writes in: the kinds of fact there are
 * about one kind of thing — a person, a place, a thing — the dimensions of it
 * they inform, the fields an entity carries, and the charter that decides
 * what is worth keeping. Facts are stored in its terms, so every lens over it
 * reads the same ledger, and a vocabulary is the expensive half to change: a
 * new version may be worth a replay. A lens is the cheap half (`lens.ts`).
 *
 * A vocabulary is DATA A CLIENT REGISTERS — written from scratch, or from a
 * preset with `extendVocabulary` — validated by `vocabularyDefinitionSchema`,
 * stored by the service per client and version, and compiled here into what
 * the engine reads (`Vocabulary`). The core names no domain; starter content
 * lives in `@popjoker/knew/presets`, and only when a client asks for it.
 */

export interface AttributeSpec {
  name: string;
  kind: "string" | "boolean" | "number" | "enum";
  /** For `enum`: the closed values. */
  values?: string[];
  optional?: boolean;
}

export interface FactTypeSpec {
  /** What the type means. This IS the extraction vocabulary — the prompt
   *  renders these and never restates them. */
  description: string;
  /** A `dimensions` key: the facet of an entity this kind of fact informs. */
  dimension: string;
  /** The type's structured payload. Most types have none. */
  attributes?: AttributeSpec[];
  /** What a reader must honor rather than merely consider: always on the
   *  page, ahead of everything else, and returned as `mustHonor`. The set
   *  every lens starts from; a lens may name its own. */
  pinned?: boolean;
  /**
   * A fact about WHO someone is. News about where or when never makes one
   * false, so only a fact of the SAME type may replace it; a different kind
   * of fact is added beside it. Enforced by the planner, not trusted to the
   * prompt.
   */
  enduring?: boolean;
  /**
   * Days after it was last said that a current fact of this type is due for a
   * revisit: worth confirming again. Nothing on the page changes — a revisit
   * is a direction, never a judgment that the fact stopped being true —
   * so an enduring type refuses one: time never makes it false, and a revisit
   * of "never bring up Jamie" would tell the knower to bring up Jamie.
   * Default: never.
   */
  revisitAfterDays?: number;
}

/** The knower's own entry, on every roster: facts about the person writing attach here. */
export const KNOWER_ID = "self";

export interface DimensionSpec {
  /** What a reader calls it: the section heading a lens starts from, and the
   *  label of a need of it. */
  label: string;
  /** What it is about. Default: the entity. */
  about?: Subject;
}

export interface VocabularyDefinition {
  /** The client's name for it: `^[a-z][a-z0-9-]{1,31}$`. */
  id: string;
  /** Bumped when anything below changes. Stamped on every episode extracted
   *  under it. */
  version: number;
  /** What every entity it describes is: `person`, `place`, `thing`. */
  kind: string;
  /** Every kind of fact there is, by type key. */
  factTypes: Record<string, FactTypeSpec>;
  /** The facets of an entity, in the order a reader takes them in — what
   *  must never be crossed first. Each holds at least one type. */
  dimensions: Record<string, DimensionSpec>;
  /** The type a retired or unknown type string reads as. */
  fallbackType: string;
  /** Fields the entity owns on the roster, which extraction may only propose
   *  changes to. May be empty. */
  fields: string[];
  /** Which fields are shown beside a name in prompts and the page's header.
   *  Default none. */
  promptFields?: string[];
  /** The charter: how "worth remembering" is judged here. Markdown. */
  charter: string;
  /** How the extraction prompt names where an episode came from. A source
   *  absent here is named by its own string. */
  sourceLabels?: Record<string, string>;
  /** The client's own wording of the task prompts. Absent, the engine's
   *  defaults apply. */
  prompts?: { extract?: string; reconcile?: string };
  /** The order of attribute keys in the extraction schema. Default: the
   *  order they are first met walking `factTypes`. */
  extractAttributeKeys?: string[];
  /** The first base it was extended from (a preset, or any vocabulary), which
   *  of that base's types and dimensions it changed or dropped, and which it
   *  added. Stamped by `extendVocabulary`. */
  basedOn?: { preset: string; version: number; changed: string[]; added: string[] };
}

const attributeSpecSchema = z
  .object({
    name: z.string().regex(FIELD_RE),
    kind: z.enum(["string", "boolean", "number", "enum"]),
    values: z.array(z.string().min(1)).min(1).optional(),
    optional: z.boolean().optional(),
  })
  .refine((spec) => (spec.kind === "enum") === (spec.values !== undefined), {
    message: "an enum attribute names its values, and only an enum does",
  });

export const vocabularyDefinitionSchema: z.ZodType<VocabularyDefinition> = z
  .object({
    id: z.string().regex(ID_RE),
    version: z.number().int().min(1),
    kind: z.string().regex(ID_RE),
    factTypes: z.record(
      z.string().regex(TYPE_KEY_RE),
      z.object({
        description: z.string().min(1),
        dimension: z.string().regex(KEY_RE),
        attributes: z.array(attributeSpecSchema).optional(),
        pinned: z.boolean().optional(),
        enduring: z.boolean().optional(),
        revisitAfterDays: z.number().int().min(1).optional(),
      }),
    ),
    dimensions: z.record(
      z.string().regex(KEY_RE),
      z.object({ label: z.string().min(1), about: z.enum(["entity", "relationship", "knower"]).optional() }),
    ),
    fallbackType: z.string(),
    fields: z.array(z.string().regex(FIELD_RE)),
    promptFields: z.array(z.string()).optional(),
    charter: z.string().min(1),
    sourceLabels: z.record(z.string(), z.string()).optional(),
    prompts: z.object({ extract: z.string().min(1).optional(), reconcile: z.string().min(1).optional() }).optional(),
    extractAttributeKeys: z.array(z.string()).optional(),
    basedOn: z
      .object({ preset: z.string().regex(ID_RE), version: z.number().int().min(1), changed: z.array(z.string()), added: z.array(z.string()) })
      .optional(),
  })
  .superRefine((vocabulary, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: "custom", message });
    if (Object.keys(vocabulary.factTypes).length === 0) issue("a vocabulary needs at least one fact type");
    if (!(vocabulary.fallbackType in vocabulary.factTypes)) {
      issue(`fallbackType ${vocabulary.fallbackType} is not one of the fact types`);
    } else {
      // A retired type on an entity reads as the fallback, so the fallback must be about the entity too.
      const about = vocabulary.dimensions[vocabulary.factTypes[vocabulary.fallbackType]!.dimension]?.about ?? "entity";
      if (about !== "entity") issue(`fallbackType ${vocabulary.fallbackType} is about the ${about}, and a fact that fits no other type is about the entity`);
    }
    const dimensions = new Set(Object.keys(vocabulary.dimensions));
    const informed = new Set<string>();
    const attributeNames = new Set<string>();
    for (const [key, type] of Object.entries(vocabulary.factTypes)) {
      if (!dimensions.has(type.dimension)) issue(`${key} informs dimension ${type.dimension}, which the vocabulary does not have`);
      informed.add(type.dimension);
      if (type.enduring && type.revisitAfterDays !== undefined) {
        issue(`${key} is enduring — time never makes it false — so it is never due for a revisit`);
      }
      const seen = new Set<string>();
      for (const attribute of type.attributes ?? []) {
        if (seen.has(attribute.name)) issue(`${key} names attribute ${attribute.name} twice`);
        seen.add(attribute.name);
        attributeNames.add(attribute.name);
      }
    }
    for (const dimension of dimensions) {
      if (!informed.has(dimension)) issue(`dimension ${dimension} has no fact types, so nothing could ever be known about it`);
    }
    for (const field of vocabulary.promptFields ?? []) {
      if (!vocabulary.fields.includes(field)) issue(`promptFields names ${field}, which is not one of the fields`);
    }
    for (const name of vocabulary.extractAttributeKeys ?? []) {
      if (!attributeNames.has(name)) issue(`extractAttributeKeys names ${name}, which no type carries`);
    }
  }) as z.ZodType<VocabularyDefinition>;

/** Validate a definition as a client sends it. Throws with every problem named. */
export function parseVocabularyDefinition(input: unknown): VocabularyDefinition {
  return vocabularyDefinitionSchema.parse(input);
}

export interface AttributeField {
  name: string;
  values: readonly string[] | null;
  /** The field's own schema, optionality stripped — what the extraction
   *  schema makes nullable. */
  schema: ZodTypeAny;
}

export interface CompiledFactType {
  description: string;
  dimension: string;
  pinned: boolean;
  enduring: boolean;
  revisitAfterDays: number | null;
  attributeFields: readonly AttributeField[];
  /** Parses a stored attributes object: what fits is kept, the rest dropped. */
  attributes: ZodTypeAny;
}

export interface CompiledDimension {
  id: string;
  label: string;
  about: Subject;
}

export interface Vocabulary {
  definition: VocabularyDefinition;
  id: string;
  version: number;
  kind: string;
  factTypes: Record<string, CompiledFactType>;
  factTypeKeys: readonly string[];
  /** In the order a reader takes them in. */
  dimensions: readonly CompiledDimension[];
  /** Every attribute any type carries, once, in extraction-schema order. */
  extractAttributes: readonly AttributeField[];
  fallbackType: string;
  sourceLabels: Readonly<Record<string, string>>;
  fields: readonly string[];
  promptFields: readonly string[];
  charter: string;
  prompts: { extract: { ref: string; text: string }; reconcile: { ref: string; text: string } };
}

/** The engine's own task prompts, by ref. v1 stays embedded so an episode
 *  stamped with it can still say what read it. */
export const DEFAULT_PROMPT_REFS = { extract: "extract.v2", reconcile: "reconcile.v2" } as const;

function baseSchema(spec: AttributeSpec): ZodTypeAny {
  switch (spec.kind) {
    case "string":
      return z.string();
    case "boolean":
      return z.boolean();
    case "number":
      return z.number();
    case "enum":
      return z.enum(spec.values as [string, ...string[]]);
  }
}

/** Compile a validated definition into what the engine reads. */
export function compileVocabulary(definition: VocabularyDefinition): Vocabulary {
  const factTypes: Record<string, CompiledFactType> = {};
  const met = new Map<string, AttributeField>();
  for (const [key, spec] of Object.entries(definition.factTypes)) {
    const attributeFields: AttributeField[] = (spec.attributes ?? []).map((attribute) => ({
      name: attribute.name,
      values: attribute.kind === "enum" ? (attribute.values ?? []) : null,
      schema: baseSchema(attribute),
    }));
    for (const field of attributeFields) if (!met.has(field.name)) met.set(field.name, field);
    const shape: Record<string, ZodTypeAny> = {};
    for (const attribute of spec.attributes ?? []) {
      shape[attribute.name] = attribute.optional ? baseSchema(attribute).optional() : baseSchema(attribute);
    }
    factTypes[key] = {
      description: spec.description,
      dimension: spec.dimension,
      pinned: spec.pinned === true,
      enduring: spec.enduring === true,
      revisitAfterDays: spec.revisitAfterDays ?? null,
      attributeFields,
      // Not strict: an attribute that belongs to another type is dropped,
      // not a reason to lose the ones that do belong.
      attributes: z.object(shape),
    };
  }
  const extractAttributes: AttributeField[] = [];
  for (const name of definition.extractAttributeKeys ?? []) extractAttributes.push(met.get(name)!);
  for (const field of met.values()) if (!extractAttributes.includes(field)) extractAttributes.push(field);
  const own = definition.prompts ?? {};
  return {
    definition,
    id: definition.id,
    version: definition.version,
    kind: definition.kind,
    factTypes,
    factTypeKeys: Object.keys(factTypes),
    dimensions: Object.entries(definition.dimensions).map(([id, spec]) => ({ id, label: spec.label, about: spec.about ?? "entity" })),
    extractAttributes,
    fallbackType: definition.fallbackType,
    sourceLabels: definition.sourceLabels ?? {},
    fields: definition.fields,
    promptFields: definition.promptFields ?? [],
    charter: definition.charter,
    prompts: {
      extract: own.extract
        ? { ref: `vocabulary:${definition.id}@${definition.version}:extract`, text: own.extract }
        : { ref: DEFAULT_PROMPT_REFS.extract, text: EXTRACT_V2 },
      reconcile: own.reconcile
        ? { ref: `vocabulary:${definition.id}@${definition.version}:reconcile`, text: own.reconcile }
        : { ref: DEFAULT_PROMPT_REFS.reconcile, text: RECONCILE_V2 },
    },
  };
}

/** Validate and compile in one step. */
export function vocabularyFrom(input: unknown): Vocabulary {
  return compileVocabulary(parseVocabularyDefinition(input));
}

/** A stored type string, narrowed. A retired or unknown type reads as the
 *  vocabulary's fallback rather than failing the load. */
export function asFactType(vocabulary: Vocabulary, type: string): string {
  return type in vocabulary.factTypes ? type : vocabulary.fallbackType;
}

export function factType(vocabulary: Vocabulary, type: string): CompiledFactType {
  return vocabulary.factTypes[asFactType(vocabulary, type)]!;
}

/** Whether a stored type is enduring: replaceable only by its own type. */
export function isEnduringFactType(vocabulary: Vocabulary, type: string): boolean {
  return type in vocabulary.factTypes && vocabulary.factTypes[type]!.enduring;
}

/** A fact's attributes, validated against its type. Anything that does not fit
 *  is dropped to `{}` rather than stored half-right. */
export function parseFactAttributes(vocabulary: Vocabulary, type: string, attributes: unknown): Record<string, unknown> {
  const parsed = factType(vocabulary, type).attributes.safeParse(attributes ?? {});
  return parsed.success ? (parsed.data as Record<string, unknown>) : {};
}

/**
 * The type list as the extraction prompt reads it — one line per type, with
 * its attributes. The vocabulary is the only place a type is described.
 */
/** How the type list tells the model where a fact of each subject attaches. */
const ATTACH: Record<Subject, string> = {
  entity: "",
  relationship: " (About the relationship between the writer and an entry: attach it to that entry.)",
  knower: ` (About the writer: attach it to ${KNOWER_ID}.)`,
};

export function factTypeVocabulary(vocabulary: Vocabulary): string {
  return vocabulary.factTypeKeys
    .map((key) => {
      const definition = vocabulary.factTypes[key]!;
      const names = definition.attributeFields.map((field) => field.name);
      const attrs = names.length > 0 ? ` Attributes: ${names.join(", ")}.` : "";
      return `- ${key}: ${definition.description}${attrs}${ATTACH[subjectOf(vocabulary, key)]}`;
    })
    .join("\n");
}

/** What a stored type is about, through its dimension; a retired type reads as the fallback, as everywhere. */
export function subjectOf(vocabulary: Vocabulary, type: string): Subject {
  const dimension = factType(vocabulary, type).dimension;
  return vocabulary.dimensions.find((candidate) => candidate.id === dimension)?.about ?? "entity";
}

/** One fact type as a screen shows it: plain data, safe to hand to a client. */
export interface FactTypeGlossaryEntry {
  description: string;
  /** The dimension it informs, by id and as a reader calls it, and what it is about. */
  dimension: { id: string; label: string; about: Subject };
  pinned: boolean;
  enduring: boolean;
  revisitAfterDays: number | null;
  attributes: Array<{ name: string; values: string[] | null }>;
}

export function factTypeGlossary(vocabulary: Vocabulary): Record<string, FactTypeGlossaryEntry> {
  const dimensionOf = new Map(vocabulary.dimensions.map((d) => [d.id, d]));
  return Object.fromEntries(
    vocabulary.factTypeKeys.map((key) => {
      const definition = vocabulary.factTypes[key]!;
      return [
        key,
        {
          description: definition.description,
          dimension: {
            id: definition.dimension,
            label: dimensionOf.get(definition.dimension)?.label ?? definition.dimension,
            about: dimensionOf.get(definition.dimension)?.about ?? "entity",
          },
          pinned: definition.pinned,
          enduring: definition.enduring,
          revisitAfterDays: definition.revisitAfterDays,
          attributes: definition.attributeFields.map((field) => ({
            name: field.name,
            values: field.values ? [...field.values] : null,
          })),
        },
      ];
    }),
  );
}

/** The charter and the type list, as the system context both model calls
 *  carry beside the task prompt. */
export function systemExtra(vocabulary: Vocabulary): string[] {
  return [vocabulary.charter, `## Fact types\n\n${factTypeVocabulary(vocabulary)}`];
}

/** "Linda (mother)" — a name with the vocabulary's prompt fields, when any are set. */
export function whoLabel(vocabulary: Vocabulary, entity: { name: string; fields: Readonly<Record<string, string | null>> }): string {
  const shown = vocabulary.promptFields
    .map((field) => entity.fields[field])
    .filter((value): value is string => typeof value === "string" && value.trim() !== "");
  return shown.length > 0 ? `${entity.name} (${shown.join(", ")})` : entity.name;
}

import { z, type ZodTypeAny } from "zod";
import { EXTRACT_V1, RECONCILE_V1 } from "./prompts/index.ts";

/**
 * A LENS is the pack of data the engine reads on a client's behalf: the fact
 * types with their pinned and enduring flags, the brief's section order and
 * header, the charter that decides what is worth remembering, the fields a
 * person owns, the questions worth answering about a person, and optionally
 * the client's own wording of the two task prompts. The engine's code is the
 * same for every lens; adding a type or a question is adding an entry, never
 * a branch.
 *
 * A lens is DATA A CLIENT REGISTERS, not content this package ships. It is
 * plain JSON (`LensDefinition`), validated by `lensDefinitionSchema`, stored
 * by the service per client and version, and compiled here into what the
 * engine reads (`Lens`). Nothing in this package knows any particular domain.
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
  /** A `briefSections[].section`. */
  section: string;
  /** The type's structured payload. Most types have none. */
  attributes?: AttributeSpec[];
  /** Always rendered, ahead of everything else, however long the ledger:
   *  what a reader must honor rather than merely consider. */
  pinned?: boolean;
  /**
   * A fact about WHO someone is. News about where or when never makes one
   * false, so only a fact of the SAME type may replace it; a different kind
   * of fact is added beside it. Enforced by the planner, not trusted to the
   * prompt.
   */
  enduring?: boolean;
}

/**
 * A question worth answering about a person — the forward-looking half of a
 * lens. The engine reports, per person, which asks the ledger does not yet
 * answer (`gapsFor`), so a client knows what to learn next and a reader
 * knows what the page is missing.
 */
export interface AskSpec {
  /** `^[a-z][a-z0-9-]{1,63}$`, unique within the lens. */
  id: string;
  /** The question, as the person would be asked it. */
  question: string;
  /** Applies only when every clause matches one of the person's routing
   *  fields (case-insensitive). Absent: applies to everyone. */
  when?: Array<{ field: string; equals: string[] }>;
  /** Fact types a current fact of which answers it. */
  answeredBy: string[];
}

export interface LensDefinition {
  /** The client's name for it: `^[a-z][a-z0-9-]{1,31}$`. */
  id: string;
  /** Bumped by the client when anything below changes. Stamped on every
   *  episode extracted under it. */
  version: number;
  factTypes: Record<string, FactTypeSpec>;
  /** In the order the engine reads them: what must never be crossed first. */
  briefSections: Array<{ section: string; heading: string }>;
  /** The page's first line. `{who}` becomes the name, with the prompt fields
   *  in parentheses when there are any. */
  briefHeader: string;
  /** The heading for facts past their own end date. */
  overHeading: string;
  /** The type a retired or unknown type string reads as. */
  fallbackType: string;
  /** How the extraction prompt names where an episode came from. A source
   *  absent here is named by its own string. */
  sourceLabels?: Record<string, string>;
  /** Fields the person owns on the roster, which extraction may only propose
   *  changes to. May be empty. */
  routingFields: string[];
  /** Which routing fields are shown beside a name in prompts and the brief
   *  header. Default none. */
  promptFields?: string[];
  /** Attribute names whose value is shown in brackets after a fact line. */
  briefAttributeTags?: string[];
  /** What an entity may be. Default `["person"]`. */
  entityKinds?: string[];
  /** The charter: how "worth remembering" is judged here. Markdown. */
  charter: string;
  /** The questions worth answering about a person. Default none. */
  asks?: AskSpec[];
  /** The client's own wording of the task prompts. Absent, the engine's
   *  defaults apply. */
  prompts?: { extract?: string; reconcile?: string };
  /** The order of attribute keys in the extraction schema. Default: the
   *  order they are first met walking `factTypes`. */
  extractAttributeKeys?: string[];
}

const ID_RE = /^[a-z][a-z0-9-]{1,31}$/;
const ASK_ID_RE = /^[a-z][a-z0-9-]{1,63}$/;
const TYPE_KEY_RE = /^[A-Z][A-Z0-9_]{1,31}$/;
const FIELD_RE = /^[a-z][a-z0-9_]{0,31}$/;

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

const askSpecSchema = z.object({
  id: z.string().regex(ASK_ID_RE),
  question: z.string().min(1),
  when: z.array(z.object({ field: z.string().regex(FIELD_RE), equals: z.array(z.string().min(1)).min(1) })).optional(),
  answeredBy: z.array(z.string()).min(1),
});

export const lensDefinitionSchema: z.ZodType<LensDefinition> = z
  .object({
    id: z.string().regex(ID_RE),
    version: z.number().int().min(1),
    factTypes: z.record(
      z.string().regex(TYPE_KEY_RE),
      z.object({
        description: z.string().min(1),
        section: z.string().min(1),
        attributes: z.array(attributeSpecSchema).optional(),
        pinned: z.boolean().optional(),
        enduring: z.boolean().optional(),
      }),
    ),
    briefSections: z.array(z.object({ section: z.string().min(1), heading: z.string().min(1) })).min(1),
    briefHeader: z.string().includes("{who}"),
    overHeading: z.string().min(1),
    fallbackType: z.string(),
    sourceLabels: z.record(z.string(), z.string()).optional(),
    routingFields: z.array(z.string().regex(FIELD_RE)),
    promptFields: z.array(z.string()).optional(),
    briefAttributeTags: z.array(z.string()).optional(),
    entityKinds: z.array(z.string().min(1)).min(1).optional(),
    charter: z.string().min(1),
    asks: z.array(askSpecSchema).optional(),
    prompts: z.object({ extract: z.string().min(1).optional(), reconcile: z.string().min(1).optional() }).optional(),
    extractAttributeKeys: z.array(z.string()).optional(),
  })
  .superRefine((lens, ctx) => {
    const types = Object.keys(lens.factTypes);
    if (types.length === 0) ctx.addIssue({ code: "custom", message: "a lens needs at least one fact type" });
    if (!(lens.fallbackType in lens.factTypes)) {
      ctx.addIssue({ code: "custom", message: `fallbackType ${lens.fallbackType} is not one of the fact types` });
    }
    const sections = new Set(lens.briefSections.map((s) => s.section));
    const attributeNames = new Set<string>();
    for (const [key, type] of Object.entries(lens.factTypes)) {
      if (!sections.has(type.section)) {
        ctx.addIssue({ code: "custom", message: `${key} sits in section ${type.section}, which the brief has no heading for` });
      }
      const seen = new Set<string>();
      for (const attribute of type.attributes ?? []) {
        if (seen.has(attribute.name)) ctx.addIssue({ code: "custom", message: `${key} names attribute ${attribute.name} twice` });
        seen.add(attribute.name);
        attributeNames.add(attribute.name);
      }
    }
    for (const field of lens.promptFields ?? []) {
      if (!lens.routingFields.includes(field)) {
        ctx.addIssue({ code: "custom", message: `promptFields names ${field}, which is not a routing field` });
      }
    }
    for (const tag of lens.briefAttributeTags ?? []) {
      if (!attributeNames.has(tag)) ctx.addIssue({ code: "custom", message: `briefAttributeTags names ${tag}, which no type carries` });
    }
    for (const name of lens.extractAttributeKeys ?? []) {
      if (!attributeNames.has(name)) ctx.addIssue({ code: "custom", message: `extractAttributeKeys names ${name}, which no type carries` });
    }
    const askIds = new Set<string>();
    for (const ask of lens.asks ?? []) {
      if (askIds.has(ask.id)) ctx.addIssue({ code: "custom", message: `ask ${ask.id} is listed twice` });
      askIds.add(ask.id);
      for (const type of ask.answeredBy) {
        if (!(type in lens.factTypes)) ctx.addIssue({ code: "custom", message: `ask ${ask.id} is answered by ${type}, which is not a fact type` });
      }
      for (const clause of ask.when ?? []) {
        if (!lens.routingFields.includes(clause.field)) {
          ctx.addIssue({ code: "custom", message: `ask ${ask.id} applies when ${clause.field} matches, which is not a routing field` });
        }
      }
    }
  }) as z.ZodType<LensDefinition>;

/** Validate a definition as a client sends it. Throws with every problem named. */
export function parseLensDefinition(input: unknown): LensDefinition {
  return lensDefinitionSchema.parse(input);
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
  section: string;
  pinned: boolean;
  enduring: boolean;
  attributeFields: readonly AttributeField[];
  /** Parses a stored attributes object: what fits is kept, the rest dropped. */
  attributes: ZodTypeAny;
}

export interface Lens {
  definition: LensDefinition;
  id: string;
  version: number;
  factTypes: Record<string, CompiledFactType>;
  factTypeKeys: readonly string[];
  /** Every attribute any type carries, once, in extraction-schema order. */
  extractAttributes: readonly AttributeField[];
  briefSections: ReadonlyArray<{ section: string; heading: string }>;
  overHeading: string;
  fallbackType: string;
  sourceLabels: Readonly<Record<string, string>>;
  routingFields: readonly string[];
  promptFields: readonly string[];
  briefAttributeTags: readonly string[];
  entityKinds: readonly string[];
  charter: string;
  asks: readonly AskSpec[];
  prompts: { extract: { ref: string; text: string }; reconcile: { ref: string; text: string } };
}

export const DEFAULT_PROMPT_REFS = { extract: "extract.v1", reconcile: "reconcile.v1" } as const;

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
export function compileLens(definition: LensDefinition): Lens {
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
      section: spec.section,
      pinned: spec.pinned === true,
      enduring: spec.enduring === true,
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
    factTypes,
    factTypeKeys: Object.keys(factTypes),
    extractAttributes,
    briefSections: definition.briefSections,
    overHeading: definition.overHeading,
    fallbackType: definition.fallbackType,
    sourceLabels: definition.sourceLabels ?? {},
    routingFields: definition.routingFields,
    promptFields: definition.promptFields ?? [],
    briefAttributeTags: definition.briefAttributeTags ?? [],
    entityKinds: definition.entityKinds ?? ["person"],
    charter: definition.charter,
    asks: definition.asks ?? [],
    prompts: {
      extract: own.extract
        ? { ref: `lens:${definition.id}@${definition.version}:extract`, text: own.extract }
        : { ref: DEFAULT_PROMPT_REFS.extract, text: EXTRACT_V1 },
      reconcile: own.reconcile
        ? { ref: `lens:${definition.id}@${definition.version}:reconcile`, text: own.reconcile }
        : { ref: DEFAULT_PROMPT_REFS.reconcile, text: RECONCILE_V1 },
    },
  };
}

/** Validate and compile in one step. */
export function lensFrom(input: unknown): Lens {
  return compileLens(parseLensDefinition(input));
}

/** A stored type string, narrowed. A retired or unknown type reads as the
 *  lens's fallback rather than failing the load. */
export function asFactType(lens: Lens, type: string): string {
  return type in lens.factTypes ? type : lens.fallbackType;
}

export function factType(lens: Lens, type: string): CompiledFactType {
  return lens.factTypes[asFactType(lens, type)]!;
}

/** Whether a stored type is enduring: replaceable only by its own type. */
export function isEnduringFactType(lens: Lens, type: string): boolean {
  return type in lens.factTypes && lens.factTypes[type]!.enduring;
}

export function isPinnedFactType(lens: Lens, type: string): boolean {
  return factType(lens, type).pinned;
}

/** A fact's attributes, validated against its type. Anything that does not fit
 *  is dropped to `{}` rather than stored half-right. */
export function parseFactAttributes(lens: Lens, type: string, attributes: unknown): Record<string, unknown> {
  const parsed = factType(lens, type).attributes.safeParse(attributes ?? {});
  return parsed.success ? (parsed.data as Record<string, unknown>) : {};
}

/**
 * The type list as the extraction prompt reads it — one line per type, with
 * its attributes. The lens is the only place a type is described.
 */
export function factTypeVocabulary(lens: Lens): string {
  return lens.factTypeKeys
    .map((key) => {
      const definition = lens.factTypes[key]!;
      const names = definition.attributeFields.map((field) => field.name);
      const attrs = names.length > 0 ? ` Attributes: ${names.join(", ")}.` : "";
      return `- ${key}: ${definition.description}${attrs}`;
    })
    .join("\n");
}

/** One fact type as a screen shows it: plain data, safe to hand to a client. */
export interface FactTypeGlossaryEntry {
  description: string;
  /** The brief section's heading, as the engine reads it. */
  section: string;
  pinned: boolean;
  enduring: boolean;
  attributes: Array<{ name: string; values: string[] | null }>;
}

export function factTypeGlossary(lens: Lens): Record<string, FactTypeGlossaryEntry> {
  const heading = new Map(lens.briefSections.map((s) => [s.section, s.heading]));
  return Object.fromEntries(
    lens.factTypeKeys.map((key) => {
      const definition = lens.factTypes[key]!;
      return [
        key,
        {
          description: definition.description,
          section: heading.get(definition.section) ?? definition.section,
          pinned: definition.pinned,
          enduring: definition.enduring,
          attributes: definition.attributeFields.map((field) => ({
            name: field.name,
            values: field.values ? [...field.values] : null,
          })),
        },
      ];
    }),
  );
}

/** The charter and the vocabulary, as the system context both model calls
 *  carry beside the task prompt. */
export function systemExtra(lens: Lens): string[] {
  return [lens.charter, `## Fact types\n\n${factTypeVocabulary(lens)}`];
}

/** "Linda (mother)" — a name with the lens's prompt fields, when any are set. */
export function whoLabel(lens: Lens, person: { name: string; fields: Readonly<Record<string, string | null>> }): string {
  const shown = lens.promptFields
    .map((field) => person.fields[field])
    .filter((value): value is string => typeof value === "string" && value.trim() !== "");
  return shown.length > 0 ? `${person.name} (${shown.join(", ")})` : person.name;
}

/** The first line of the page, from the lens's template. */
export function briefHeader(lens: Lens, person: { name: string; fields: Readonly<Record<string, string | null>> }): string {
  return lens.definition.briefHeader.replaceAll("{who}", whoLabel(lens, person));
}

/**
 * Everything on this site that describes the engine is read out of the engine.
 *
 * The vocabulary and lens field lists come from their zod schemas, the
 * defaults from `ENGINE_DEFAULTS`, the contract case list from
 * contractCases(), the API surface from the client's own methods, the presets
 * page from every preset the package exports, and the worked example is the
 * package's own person preset. None of it is transcribed, so none of it can
 * drift. The tests in test/ fail the build if the prose beside any of it falls
 * behind.
 */
import {
  compileLens,
  compileVocabulary,
  ENGINE_DEFAULTS,
  intelligenceClient,
  lensDefinitionSchema,
  parseLensDefinition,
  parseVocabularyDefinition,
  readinessFor,
  SUBJECT_HEADER,
  vocabularyDefinitionSchema,
  type CompiledNeed,
  type Lens,
  type Vocabulary,
} from "@popjoker/knew";
import * as presets from "@popjoker/knew/presets";
import { contractCases } from "@popjoker/knew/testing";
import * as z from "zod";

export { SUBJECT_HEADER };

/* ---------------------------------------------------------- the definitions */

type JsonSchemaNode = {
  type?: string | string[];
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
  items?: JsonSchemaNode;
  additionalProperties?: JsonSchemaNode | boolean;
  propertyNames?: JsonSchemaNode;
  pattern?: string;
  enum?: unknown[];
  minItems?: number;
  minLength?: number;
  minimum?: number;
  exclusiveMinimum?: number;
  anyOf?: JsonSchemaNode[];
  default?: unknown;
};

/**
 * A definition schema as JSON Schema. `unrepresentable: "any"` keeps the
 * superRefine cross-checks from throwing; `io: "input"` describes what a client
 * writes rather than what the parse returns.
 */
const asJsonSchema = (schema: z.ZodType) => z.toJSONSchema(schema, { unrepresentable: "any", io: "input" }) as JsonSchemaNode;

export const vocabularyJsonSchema = asJsonSchema(vocabularyDefinitionSchema);
export const lensJsonSchema = asJsonSchema(lensDefinitionSchema);

/** A one-line type for a schema node, in the shape a reader would write it. */
export function typeOf(node: JsonSchemaNode | undefined): string {
  if (!node) return "unknown";
  if (node.anyOf?.length) return node.anyOf.map(typeOf).join(" | ");
  if (node.enum?.length) return node.enum.map((v) => JSON.stringify(v)).join(" | ");
  if (Array.isArray(node.type)) return node.type.join(" | ");
  switch (node.type) {
    case "array":
      return `${typeOf(node.items)}[]`;
    case "object": {
      if (node.properties) return `{ ${Object.keys(node.properties).join(", ")} }`;
      const value = typeof node.additionalProperties === "object" ? typeOf(node.additionalProperties) : "unknown";
      return `Record<string, ${value}>`;
    }
    case "integer":
      return "number";
    default:
      return node.type ?? "unknown";
  }
}

/** The constraint a reader would otherwise have to discover by being rejected. */
export function constraintOf(node: JsonSchemaNode | undefined): string | null {
  if (!node) return null;
  const parts: string[] = [];
  const key = node.type === "object" ? node.propertyNames : node.type === "array" ? node.items : node;
  if (key?.pattern) parts.push(`matches ${key.pattern}`);
  if (node.minItems) parts.push(`at least ${node.minItems}`);
  if (node.minLength) parts.push("non-empty");
  if (node.minimum !== undefined) parts.push(`>= ${node.minimum}`);
  if (node.exclusiveMinimum !== undefined) parts.push(`> ${node.exclusiveMinimum}`);
  if (node.default !== undefined) parts.push(`defaults to ${JSON.stringify(node.default)}`);
  return parts.length ? parts.join(", ") : null;
}

export interface DefinitionField {
  readonly name: string;
  readonly required: boolean;
  readonly type: string;
  readonly constraint: string | null;
}

function fieldsOf(node: JsonSchemaNode): DefinitionField[] {
  const properties = node.properties ?? {};
  const required = new Set(node.required ?? []);
  return Object.entries(properties).map(([name, child]) => ({
    name,
    required: required.has(name),
    type: typeOf(child),
    constraint: constraintOf(child),
  }));
}

/**
 * The fields one level inside a field that holds objects — a record of them
 * (`factTypes.*`) or a list of them (`needs[]`) — by that path. A plain object
 * field (`prompts`, `basedOn`) is explained by its own note.
 */
function nestedFieldsOf(node: JsonSchemaNode): Record<string, DefinitionField[]> {
  const nested: Record<string, DefinitionField[]> = {};
  for (const [name, child] of Object.entries(node.properties ?? {})) {
    const record = typeof child.additionalProperties === "object" ? child.additionalProperties : undefined;
    if (child.type === "object" && record?.properties) nested[`${name}.*`] = fieldsOf(record);
    if (child.type === "array" && child.items?.properties) nested[`${name}[]`] = fieldsOf(child.items);
  }
  return nested;
}

/** Every field of a vocabulary definition, in schema order. */
export function vocabularyFields(): DefinitionField[] {
  return fieldsOf(vocabularyJsonSchema);
}

/** Every field of a lens definition, in schema order. */
export function lensFields(): DefinitionField[] {
  return fieldsOf(lensJsonSchema);
}

export function vocabularyNestedFields(): Record<string, DefinitionField[]> {
  return nestedFieldsOf(vocabularyJsonSchema);
}

export function lensNestedFields(): Record<string, DefinitionField[]> {
  return nestedFieldsOf(lensJsonSchema);
}

/* ------------------------------------------------------------- the defaults */

export interface EngineDefault {
  readonly name: keyof typeof ENGINE_DEFAULTS;
  readonly value: string;
}

/** What the engine assumes when a definition says nothing, as shipped. */
export function engineDefaults(): EngineDefault[] {
  return (Object.entries(ENGINE_DEFAULTS) as Array<[keyof typeof ENGINE_DEFAULTS, number | null]>).map(([name, value]) => ({
    name,
    value: value === null ? "never" : value.toLocaleString("en-US"),
  }));
}

/* -------------------------------------------------------------- the presets */

export interface PresetType {
  readonly key: string;
  readonly description: string;
  /** Each attribute as a reader would write it: `level: beginner | serious | expert`. */
  readonly attributes: readonly string[];
  /** What sets it apart, if anything: pinned, enduring, a revisit window, the fallback. */
  readonly marks: readonly string[];
}

export interface PresetDimension {
  readonly id: string;
  readonly label: string;
  /** The types that inform it, in the vocabulary's order. */
  readonly types: readonly PresetType[];
}

export interface PresetOutline {
  /** What it is imported as from `@popjoker/knew/presets`. */
  readonly name: string;
  readonly vocabulary: Vocabulary;
  /** The taxonomy: each dimension in reading order, with the types that inform it. */
  readonly dimensions: readonly PresetDimension[];
  /** The starter lens, compiled, so every default it leaves to the engine is filled in. */
  readonly lens: Lens;
  /** The starter lens's first direction for an entity nothing is known about: its label. */
  readonly firstDirection: string | null;
}

function outlineOf(name: string, preset: (typeof presets)[keyof typeof presets]): PresetOutline {
  const vocabulary = compileVocabulary(parseVocabularyDefinition(preset.vocabulary()));
  const lens = compileLens(parseLensDefinition(preset.lens()), vocabulary);
  const typeOf = (key: string): PresetType => {
    const type = vocabulary.factTypes[key]!;
    return {
      key,
      description: type.description,
      attributes: (vocabulary.definition.factTypes[key]!.attributes ?? []).map(
        (attribute) => `${attribute.name}: ${attribute.kind === "enum" ? (attribute.values ?? []).join(" | ") : attribute.kind}`,
      ),
      marks: [
        type.pinned ? "pinned" : null,
        type.enduring ? "enduring" : null,
        type.revisitAfterDays === null ? null : `revisit after ${type.revisitAfterDays} days`,
        key === vocabulary.fallbackType ? "fallback" : null,
      ].filter((mark) => mark !== null),
    };
  };
  return {
    name,
    vocabulary,
    dimensions: vocabulary.dimensions.map((dimension) => ({
      id: dimension.id,
      label: dimension.label,
      types: vocabulary.factTypeKeys.filter((key) => vocabulary.factTypes[key]!.dimension === dimension.id).map(typeOf),
    })),
    lens,
    // Nothing is known, so the moment asked at does not matter.
    firstDirection: readinessFor(lens, { fields: {} }, [], new Date(0)).next[0]?.label ?? null,
  };
}

/** Every preset the package exports, in export order. A new one is on the page the day it ships. */
export function presetOutlines(): PresetOutline[] {
  return Object.entries(presets).map(([name, preset]) => outlineOf(name, preset));
}

/**
 * What sets a need apart from the rest, as `Inline` text: a weight when the
 * needs differ in weight, a count of facts other than the engine's default,
 * the needs it waits for, and whom it applies to. Empty for a need that leaves
 * all of it to the defaults.
 */
export function needMarks(need: CompiledNeed, sameWeight: boolean): string[] {
  return [
    sameWeight ? null : `weighs ${need.weight}`,
    need.enough === ENGINE_DEFAULTS.enough ? null : `met by ${need.enough} facts`,
    need.after.length === 0 ? null : `after ${need.after.map((id) => `\`${id}\``).join(" and ")}`,
    ...need.when.map((clause) => `only when \`${clause.field}\` is ${clause.equals.map((value) => `“${value}”`).join(" or ")}`),
  ].filter((mark) => mark !== null);
}

/* ------------------------------------------------------- the worked examples */

/** The person preset, as a client imports it. */
export const personVocabulary = presets.person.vocabulary();

/* ----------------------------------------------------------- the contract  */

export interface ContractCaseSummary {
  readonly name: string;
  readonly scripted: boolean;
}

/** The cases a driver must pass, as the suite itself lists them. */
export function contractCaseSummaries(): ContractCaseSummary[] {
  return contractCases().map(({ name, scripted }) => ({ name, scripted }));
}

/* ------------------------------------------------------------- the client  */

/**
 * The method names the HTTP client exposes at runtime. The API page's route
 * table is checked against this, so a new method cannot ship undocumented.
 */
export function clientMethods(): string[] {
  const client = intelligenceClient({ baseUrl: "https://api.knew.dev", serviceKey: "documentation" });
  return Object.keys(client).sort();
}

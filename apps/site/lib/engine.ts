/**
 * Everything on this site that describes the engine is read out of the engine.
 *
 * The vocabulary and lens field lists come from their zod schemas, the
 * defaults from `ENGINE_DEFAULTS`, the contract case list from
 * contractCases(), the API surface from the client's own methods, and the
 * worked example is the package's own person preset. None of it is
 * transcribed, so none of it can drift. The tests in test/ fail the build if
 * the prose beside any of it falls behind.
 */
import { ENGINE_DEFAULTS, intelligenceClient, lensDefinitionSchema, SUBJECT_HEADER, vocabularyDefinitionSchema } from "@popjoker/knew";
import { person } from "@popjoker/knew/presets";
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
 * (`factTypes.*`) or a list of them (`asks[]`) — by that path. A plain object
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

/* ------------------------------------------------------- the worked examples */

/** The person preset, as a client imports it. */
export const personVocabulary = person.vocabulary();
export const personLens = person.lens();

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

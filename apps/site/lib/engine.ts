/**
 * Everything on this site that describes the engine is read out of the engine.
 *
 * The lens field list comes from the zod schema, the contract case list comes
 * from contractCases(), the API surface comes from the client's own methods,
 * and the worked example is the fixture lens the package tests itself with.
 * None of it is transcribed, so none of it can drift. The tests in test/
 * fail the build if the prose beside any of it falls behind.
 */
import { intelligenceClient, lensDefinitionSchema, SUBJECT_HEADER } from "@popjoker/knew";
import { contractCases, fixtureLensDefinition } from "@popjoker/knew/testing";
import * as z from "zod";

export { SUBJECT_HEADER };

/* ---------------------------------------------------------------- the lens */

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
  anyOf?: JsonSchemaNode[];
  default?: unknown;
};

/**
 * The lens schema as JSON Schema. `unrepresentable: "any"` keeps the
 * superRefine cross-checks from throwing; `io: "input"` describes what a client
 * writes rather than what the parse returns.
 */
export const lensJsonSchema = z.toJSONSchema(lensDefinitionSchema, {
  unrepresentable: "any",
  io: "input",
}) as JsonSchemaNode;

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
  if (node.default !== undefined) parts.push(`defaults to ${JSON.stringify(node.default)}`);
  return parts.length ? parts.join(", ") : null;
}

export interface LensField {
  readonly name: string;
  readonly required: boolean;
  readonly type: string;
  readonly constraint: string | null;
}

/** Every field of a lens definition, in schema order. */
export function lensFields(): LensField[] {
  const properties = lensJsonSchema.properties ?? {};
  const required = new Set(lensJsonSchema.required ?? []);
  return Object.entries(properties).map(([name, node]) => ({
    name,
    required: required.has(name),
    type: typeOf(node),
    constraint: constraintOf(node),
  }));
}

/* ------------------------------------------------------- the worked example */

export const fixtureLens = fixtureLensDefinition();

/* ----------------------------------------------------------- the contract  */

export interface ContractCaseSummary {
  readonly name: string;
  readonly scripted: boolean;
}

/** The ten cases a driver must pass, as the suite itself lists them. */
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

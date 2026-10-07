import * as core from "@popjoker/knew";
import * as presets from "@popjoker/knew/presets";
import * as testing from "@popjoker/knew/testing";
import { z } from "zod";

/** Every key at any depth of a JSON schema's `properties`. */
function propertyNames(node: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(node)) {
    for (const item of node) propertyNames(item, into);
  } else if (typeof node === "object" && node !== null) {
    for (const [key, value] of Object.entries(node)) {
      if (key === "properties" && typeof value === "object" && value !== null) for (const name of Object.keys(value)) into.add(name);
      propertyNames(value, into);
    }
  }
  return into;
}

const asJsonSchema = (schema: z.ZodType) => z.toJSONSchema(schema, { unrepresentable: "any", io: "input" });

/**
 * The package's names: every runtime export of its three entry points, and
 * every property of its two definition schemas. A brief must say none of them
 * (`briefLeaks`); a finding is grouped by the first one it mentions (`findings.ts`).
 */
export function packageNames(): Set<string> {
  return new Set([
    ...Object.keys(core),
    ...Object.keys(presets),
    ...Object.keys(testing),
    ...propertyNames(asJsonSchema(core.vocabularyDefinitionSchema)),
    ...propertyNames(asJsonSchema(core.lensDefinitionSchema)),
  ]);
}

import { ModelContextError, ModelUnavailableError } from "./fallback.ts";
import type { Model } from "./model.ts";

/**
 * `@popjoker/knew/apple`: knew's two calls answered by Apple's on-device
 * model (Foundation Models, iOS 26 and macOS 26 with Apple Intelligence). No
 * key, no network: the note, what is known and the answer never leave the
 * device. With `localIntelligence` or `statelessIntelligence`, the whole
 * engine runs on the phone.
 *
 * The model is reached through Swift, so the app supplies `respond`: a native
 * bridge that passes the call to `apple/KnewFoundationModels.swift`, shipped
 * in this package. This file does the JavaScript half — the schema in the
 * shape Apple's guided generation takes, the context budget, the answer back
 * in the shape knew checks, and Apple's errors as ones knew acts on.
 *
 * The on-device model reads about 4,096 tokens in all — instructions, input
 * and answer together. A short note against a small roster fits; a long one,
 * or reconciling against many facts, may not. Such a request is refused here
 * before the call (`ModelContextError`), so `fallbackModel` can hand it to the
 * app's own key, or the episode waits.
 */

/** A schema as Apple's guided generation takes it: no nulls, optional fields instead. */
export type AppleSchema =
  | { kind: "object"; name: string; properties: Array<{ name: string; schema: AppleSchema; optional: boolean }> }
  | { kind: "array"; items: AppleSchema }
  | { kind: "string"; choices?: string[]; name?: string }
  | { kind: "integer" }
  | { kind: "number" }
  | { kind: "boolean" };

export interface AppleCall {
  /** The task, the charter and the vocabulary: `LanguageModelSession(instructions:)`. */
  instructions: string;
  /** What was said, or what is known: `respond(to:)`. */
  prompt: string;
  /** What `respond(to:schema:)` must produce; the bridge sends it to Swift as JSON. */
  schema: AppleSchema;
}

export interface AppleModelOptions {
  /** The app's native bridge to `KnewFoundationModels.respond`: the answer as a JSON string, or a rejection with a `code`. */
  respond: (call: AppleCall) => Promise<string>;
  /** The model's context window, in tokens. Default 4,096. */
  contextTokens?: number;
  /** Kept free for the answer. Default 1,000. */
  reserveForAnswer?: number;
}

/** Apple's model refused or failed for a reason other than size or availability. */
export class AppleModelError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AppleModelError";
  }
}

type JsonSchema = {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  anyOf?: JsonSchema[];
};

/** The schema without its nulls: what is left, and whether null was allowed. */
function withoutNull(node: JsonSchema): { node: JsonSchema; nullable: boolean } {
  if (node.anyOf) {
    const rest = node.anyOf.filter((option) => option.type !== "null");
    if (rest.length === 1 && rest.length < node.anyOf.length) return { node: rest[0]!, nullable: true };
    if (rest.length !== 1) throw new Error("a union other than T | null has no form Apple's guided generation takes");
  }
  if (Array.isArray(node.type)) {
    const types = node.type.filter((type) => type !== "null");
    if (types.length !== 1) throw new Error(`a field of types ${node.type.join(", ")} has no form Apple's guided generation takes`);
    return { node: { ...node, type: types[0]! }, nullable: types.length < node.type.length };
  }
  return { node, nullable: false };
}

/** A JSON Schema, in the shape `DynamicGenerationSchema` is built from. */
export function appleSchemaOf(schema: Record<string, unknown>, name = "Answer"): AppleSchema {
  const walk = (raw: JsonSchema, path: string): AppleSchema => {
    const { node } = withoutNull(raw);
    switch (node.type) {
      case "object":
        return {
          kind: "object",
          name: path,
          properties: Object.entries(node.properties ?? {}).map(([key, child]) => ({
            name: key,
            schema: walk(child, `${path}_${key}`),
            optional: withoutNull(child).nullable || !(node.required ?? []).includes(key),
          })),
        };
      case "array":
        if (!node.items) throw new Error(`${path} is an array of nothing`);
        return { kind: "array", items: walk(node.items, `${path}_item`) };
      case "string":
        return node.enum ? { kind: "string", choices: node.enum.map(String), name: path } : { kind: "string" };
      case "integer":
        return { kind: "integer" };
      case "number":
        return { kind: "number" };
      case "boolean":
        return { kind: "boolean" };
      default:
        throw new Error(`${path} has no type Apple's guided generation takes`);
    }
  };
  return walk(schema as JsonSchema, name);
}

/** An answer with every field Apple left out that knew allows to be null, set to null. */
export function withNulls(schema: Record<string, unknown>, answer: unknown): unknown {
  const walk = (raw: JsonSchema, value: unknown): unknown => {
    const { node } = withoutNull(raw);
    if (value === null || value === undefined) return value;
    if (node.type === "object" && typeof value === "object" && !Array.isArray(value)) {
      const out: Record<string, unknown> = { ...(value as Record<string, unknown>) };
      for (const [key, child] of Object.entries(node.properties ?? {})) {
        if (out[key] === undefined && withoutNull(child).nullable) out[key] = null;
        else if (out[key] !== undefined) out[key] = walk(child, out[key]);
      }
      return out;
    }
    if (node.type === "array" && Array.isArray(value) && node.items) return value.map((item) => walk(node.items!, item));
    return value;
  };
  return walk(schema as JsonSchema, answer);
}

/** Tokens a text costs, roughly: English runs about four characters a token; 3.5 errs toward too many. */
export const estimateTokens = (text: string) => Math.ceil(text.length / 3.5);

export function appleModel(options: AppleModelOptions): Model {
  const budget = (options.contextTokens ?? 4_096) - (options.reserveForAnswer ?? 1_000);
  return async (request) => {
    const schema = appleSchemaOf(request.schema);
    const tokens = estimateTokens(request.system) + estimateTokens(request.prompt) + estimateTokens(JSON.stringify(schema));
    if (tokens > budget) {
      throw new ModelContextError(`the ${request.task} request is about ${tokens} tokens, past the ${budget} the on-device model has room for`, tokens, budget);
    }
    if (request.signal?.aborted) throw request.signal.reason ?? new Error("aborted");
    let text: string;
    try {
      text = await options.respond({ instructions: request.system, prompt: request.prompt, schema });
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      const message = error instanceof Error ? error.message : String(error);
      if (code === "context") throw new ModelContextError(`the on-device model ran out of room for the ${request.task} request`, tokens, budget);
      if (code === "unavailable" || code === "unsupported-language") throw new ModelUnavailableError(message, code);
      throw new AppleModelError(typeof code === "string" ? code : "failed", message);
    }
    let answer: unknown;
    try {
      answer = JSON.parse(text);
    } catch {
      throw new AppleModelError("failed", `the on-device model's ${request.task} answer is not JSON`);
    }
    return { output: withNulls(request.schema, answer), model: "apple-foundation-models", usage: { costUsd: 0, costSource: "estimated" } };
  };
}

import { z } from "zod";
import type { Adapter } from "./adapter.ts";
import {
  conditionsOf,
  extractInput,
  moveInput,
  nextInput,
  promptFor,
  reconcileInput,
  resolveFactHandles,
  type NewFactForReconcile,
  type PromptConditions,
} from "./extract-io.ts";
import type { ReconcileDecisions } from "./reconcile.ts";
import { extractSchemaFor, moveSchemaFor, nextSchemaFor, reconcileSchema, type Extraction, type MoveAnswer, type NextAnswer } from "./schemas.ts";
import type { Fact, ModelCall, ModelUsage, Move, ProposedDirection, RosterEntry } from "./types.ts";
import { moveSystemExtra, nextSystemExtra, systemExtra, type Vocabulary } from "./vocabulary.ts";

/**
 * THE MODEL IS THE APP'S. knew makes four kinds of call — EXTRACT (what was
 * just said, and what it is about), RECONCILE (how that changes what is known
 * about one entry), NEXT (what to learn about that entry now) and MOVE (what
 * one adapter's kind of move calls for about it) — and an app supplies the
 * function that answers them: its own key with a provider's SDK
 * (`@popjoker/knew/anthropic`), a model on the device (`@popjoker/knew/apple`),
 * or anything else that can answer a prompt with JSON matching a schema. knew
 * holds no key and opens no connection of its own.
 */

export interface ModelRequest {
  /** Which call: an app may route each to its own model. */
  task: "extract" | "reconcile" | "next" | "move";
  /** The task's instructions, the vocabulary's charter and its fact types;
   *  for `next`, its dimensions too; for `move`, the adapter's instructions
   *  and the dimensions it names. The same for every call of a task (under
   *  one adapter), so worth caching. */
  system: string;
  /** What was said, or what is known and what is new. */
  prompt: string;
  /** The JSON Schema the answer must match. */
  schema: Record<string, unknown>;
  /** Aborted when the caller's deadline or the call's timeout passes. */
  signal?: AbortSignal;
}

export interface ModelAnswer {
  /** The answer: an object, or a string of JSON (a code fence around it is tolerated). */
  output: unknown;
  /** Which model answered, for the record. */
  model?: string;
  /** What it cost, when the provider says. A missing cost is unpriced, never free. */
  usage?: Partial<ModelUsage>;
}

export type Model = (request: ModelRequest) => Promise<ModelAnswer>;

/** The model answered something that is not what the task asked for. */
export class ModelAnswerError extends Error {
  constructor(
    public readonly task: ModelRequest["task"],
    detail: string,
  ) {
    super(`the model's ${task} answer is not usable: ${detail}`);
    this.name = "ModelAnswerError";
  }
}

const asJsonSchema = (schema: z.ZodType) => {
  const { $schema: _marker, ...shape } = z.toJSONSchema(schema) as Record<string, unknown>;
  return shape;
};

/** An answer as an object: parsed if it came as text, a code fence stripped. */
function objectOf(task: ModelRequest["task"], output: unknown): unknown {
  if (typeof output !== "string") return output;
  const start = output.indexOf("{");
  const end = output.lastIndexOf("}");
  if (start === -1 || end <= start) throw new ModelAnswerError(task, "no JSON object in it");
  try {
    return JSON.parse(output.slice(start, end + 1));
  } catch {
    throw new ModelAnswerError(task, "its JSON does not parse");
  }
}

function usageOf(usage: Partial<ModelUsage> | undefined): ModelUsage {
  return {
    inputTokens: usage?.inputTokens ?? null,
    outputTokens: usage?.outputTokens ?? null,
    cacheReadTokens: usage?.cacheReadTokens ?? null,
    cacheWriteTokens: usage?.cacheWriteTokens ?? null,
    costUsd: usage?.costUsd ?? null,
    costSource: usage?.costUsd == null ? null : (usage.costSource ?? "estimated"),
  };
}

/** What the calls are given, besides the vocabulary. */
export interface ExtractArgs {
  content: string;
  observed?: string | null;
  inReplyTo?: string | null;
  source: string;
  referenceAt: Date;
  roster: RosterEntry[];
  hints: readonly string[];
}

export interface ReconcileArgs {
  entity: { name: string; fields: Readonly<Record<string, string | null>> };
  referenceAt: Date;
  current: Fact[];
  incoming: NewFactForReconcile[];
  summary: string;
}

export interface NextArgs {
  entity: { name: string; fields: Readonly<Record<string, string | null>> };
  /** When this was learned: the note's date, or now for an entity just added. */
  referenceAt: Date;
  /** The entity's current facts. */
  facts: Fact[];
  /** The knower's current facts. */
  knower: Fact[];
  /** The facts this note added or retold, by id; empty when the entity was just added. */
  learned: readonly string[];
  /** The entity's directions, every status. */
  directions: ProposedDirection[];
  perDimension: number;
  lapseAfterDays: number;
}

export interface MoveArgs {
  entity: { name: string; fields: Readonly<Record<string, string | null>> };
  /** When this was learned: the note's date. */
  referenceAt: Date;
  /** The entity's current facts. */
  facts: Fact[];
  /** The knower's current facts. */
  knower: Fact[];
  /** The facts this note added or retold, by id. */
  learned: readonly string[];
  /** The entity's moves under this adapter, every status. */
  moves: Move[];
}

/** The four calls, answered and checked. Each call is recorded in `calls`, whether or not it came back. */
export interface Reader {
  extract(args: ExtractArgs, calls: ModelCall[], signal?: AbortSignal): Promise<Extraction>;
  reconcile(args: ReconcileArgs, calls: ModelCall[], signal?: AbortSignal): Promise<ReconcileDecisions>;
  next(args: NextArgs, calls: ModelCall[], signal?: AbortSignal): Promise<NextAnswer>;
  /** What one adapter's kind of move calls for about an entity a note just changed. */
  move(adapter: Adapter, args: MoveArgs, calls: ModelCall[], signal?: AbortSignal): Promise<MoveAnswer>;
  /** The prompt refs, for what read an episode. */
  refs: { extract: string; reconcile: string; next: string; move: string };
  /** Whether it can answer now; a scripted reader with nothing left says no, and the read stops quietly. */
  ready?(): boolean;
}

/** The reader that asks a model: the vocabulary's prompts, the engine's inputs, the schemas checked. */
export function readerFor(vocabulary: Vocabulary, model: Model): Reader {
  const extractSchema = extractSchemaFor(vocabulary);
  const nextSchema = nextSchemaFor(vocabulary);
  const extra = systemExtra(vocabulary);
  const nothingWaits: PromptConditions = { reply: false, fields: false };
  // The system text: the task prompt, then the charter and the types. `next` adds the dimensions;
  // `move` puts the adapter's instructions first and keeps only the dimensions it names. A prompt's
  // sections that wait for something (a question answered, fields shown) are left out when the
  // input has none; only extract has such sections today.
  const systemOf = (text: string, when: PromptConditions, extras: string[]) => [promptFor(text, when), ...extras].join("\n\n---\n\n");
  const fixed = {
    extract: { schema: asJsonSchema(extractSchema) },
    reconcile: { system: systemOf(vocabulary.prompts.reconcile.text, nothingWaits, extra), schema: asJsonSchema(reconcileSchema) },
    next: { system: systemOf(vocabulary.prompts.next.text, nothingWaits, nextSystemExtra(vocabulary)), schema: asJsonSchema(nextSchema) },
  };
  // One adapter's system text and schema, made the first time it is asked under and kept.
  const perAdapter = new WeakMap<Adapter, { system: string; schema: Record<string, unknown>; parser: z.ZodType<MoveAnswer> }>();
  const setupFor = (adapter: Adapter) => {
    let setup = perAdapter.get(adapter);
    if (!setup) {
      const parser: z.ZodType<MoveAnswer> = moveSchemaFor(adapter);
      setup = { system: systemOf(vocabulary.prompts.move.text, nothingWaits, moveSystemExtra(vocabulary, adapter)), schema: asJsonSchema(parser), parser };
      perAdapter.set(adapter, setup);
    }
    return setup;
  };
  async function ask<T>(
    task: ModelRequest["task"],
    system: string,
    prompt: string,
    schema: Record<string, unknown>,
    parser: z.ZodType<T>,
    calls: ModelCall[],
    signal?: AbortSignal,
  ): Promise<T> {
    let answer: ModelAnswer;
    try {
      answer = await model({ task, system, prompt, schema, ...(signal ? { signal } : {}) });
    } catch (error) {
      calls.push({ method: task, model: null, usage: null });
      throw error;
    }
    calls.push({ method: task, model: answer.model ?? null, usage: usageOf(answer.usage) });
    const parsed = parser.safeParse(objectOf(task, answer.output));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new ModelAnswerError(task, issue ? `${issue.path.join(".") || "(top level)"}: ${issue.message}` : "it does not match the schema");
    }
    return parsed.data;
  }
  return {
    refs: {
      extract: vocabulary.prompts.extract.ref,
      reconcile: vocabulary.prompts.reconcile.ref,
      next: vocabulary.prompts.next.ref,
      move: vocabulary.prompts.move.ref,
    },
    extract: (args, calls, signal) =>
      ask(
        "extract",
        systemOf(vocabulary.prompts.extract.text, conditionsOf(vocabulary, args), extra),
        extractInput(vocabulary, args),
        fixed.extract.schema,
        extractSchema,
        calls,
        signal,
      ),
    reconcile: async (args, calls, signal) => {
      const answer = await ask("reconcile", fixed.reconcile.system, reconcileInput(vocabulary, args), fixed.reconcile.schema, reconcileSchema, calls, signal);
      // The input named the current facts by handle (`f1`, `f2`); the plan needs their ids.
      return { ...answer, decisions: resolveFactHandles(answer.decisions, args.current) };
    },
    next: (args, calls, signal) => ask("next", fixed.next.system, nextInput(vocabulary, args), fixed.next.schema, nextSchema, calls, signal),
    move: (adapter, args, calls, signal) => {
      const setup = setupFor(adapter);
      return ask("move", setup.system, moveInput(vocabulary, adapter, args), setup.schema, setup.parser, calls, signal);
    },
  };
}

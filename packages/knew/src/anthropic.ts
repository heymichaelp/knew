import Anthropic from "@anthropic-ai/sdk";
import { jsonSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/json-schema";
import { ModelContextError } from "./fallback.ts";
import type { Model, ModelRequest } from "./model.ts";

/**
 * `@popjoker/knew/anthropic`: knew's two calls answered by Claude, on the
 * app's own key, through Anthropic's official SDK — an optional peer
 * dependency, so an app that never imports this path never installs it.
 *
 * Each call is one message with structured output: the schema is the one knew
 * checks the answer against, put into the form structured outputs take by the
 * SDK's own `jsonSchemaOutputFormat`, so the answer is JSON of that shape. The
 * system block (the task, the charter, the vocabulary) is the same for every
 * call of a task, and is marked for caching, so the second note onward reads
 * it at a fraction of the price.
 */

export interface AnthropicModelOptions {
  /** The app's key. Default: the SDK's own, `ANTHROPIC_API_KEY`. */
  apiKey?: string;
  /** A client the app built itself — another base URL, a proxy, or a test double. Wins over `apiKey`. */
  client?: Pick<Anthropic, "messages">;
  /** One model for both calls, or one per call. Default `claude-opus-5-5`. */
  model?: string | { extract: string; reconcile: string };
  /** How hard the model thinks. Default: the model's own (medium). */
  effort?: "low" | "medium" | "high";
  /** The most an answer may run to, thinking included. Default 16,000. */
  maxTokens?: number;
}

export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5-5";

export function anthropicModel(options: AnthropicModelOptions = {}): Model {
  const client = options.client ?? new Anthropic(options.apiKey !== undefined ? { apiKey: options.apiKey } : {});
  const modelFor = (task: ModelRequest["task"]) =>
    typeof options.model === "string" ? options.model : (options.model?.[task] ?? DEFAULT_ANTHROPIC_MODEL);
  return async (request) => {
    const model = modelFor(request.task);
    const format = jsonSchemaOutputFormat(request.schema as Parameters<typeof jsonSchemaOutputFormat>[0]);
    const message = await client.messages.parse(
      {
        model,
        max_tokens: options.maxTokens ?? 16_000,
        system: [{ type: "text", text: request.system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: request.prompt }],
        output_config: {
          format,
          ...(options.effort ? { effort: options.effort } : {}),
        },
      },
      request.signal ? { signal: request.signal } : {},
    );
    if (message.stop_reason === "model_context_window_exceeded") {
      throw new ModelContextError(`the ${request.task} request is longer than ${model} can take in`);
    }
    // A refusal or a cut-off answer is not an answer: the episode stays pending and is read again.
    if (message.stop_reason === "refusal") throw new Error(`${model} declined the ${request.task} call`);
    if (message.stop_reason === "max_tokens") throw new Error(`${model}'s ${request.task} answer ran past ${options.maxTokens ?? 16_000} tokens`);
    const text = message.content.find((block) => block.type === "text");
    if (!text || text.type !== "text") throw new Error(`${model} gave no text for the ${request.task} call`);
    const usage = message.usage;
    return {
      output: text.text,
      model,
      usage: {
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        cacheReadTokens: usage.cache_read_input_tokens ?? null,
        cacheWriteTokens: usage.cache_creation_input_tokens ?? null,
      },
    };
  };
}

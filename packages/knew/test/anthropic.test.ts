import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { anthropicModel } from "../src/anthropic.ts";
import { ModelContextError, type ModelRequest } from "../src/index.ts";

/** Claude on the app's own key: the request the SDK is given, and what comes back. A stand-in plays the client. */

type Params = Record<string, unknown> & { output_config: { format: { type: string; schema: Record<string, unknown> } } };

function client(reply: Record<string, unknown>) {
  const sent: Array<{ params: Params; options: { signal?: AbortSignal } }> = [];
  return {
    sent,
    client: {
      messages: {
        parse: async (params: Params, options: { signal?: AbortSignal }) => {
          sent.push({ params, options });
          return { stop_reason: "end_turn", content: [{ type: "text", text: '{"ok":true}' }], usage: { input_tokens: 900, output_tokens: 40, cache_read_input_tokens: 800, cache_creation_input_tokens: 0 }, ...reply };
        },
      },
    } as never,
  };
}

const request = (task: ModelRequest["task"], signal?: AbortSignal): ModelRequest => ({
  task,
  system: "the task, the charter, the vocabulary",
  prompt: "what was said",
  schema: { type: "object", properties: { n: { type: "integer", minimum: -9007199254740991, maximum: 9007199254740991 } }, required: ["n"], additionalProperties: false },
  ...(signal ? { signal } : {}),
});

describe("Scenario: The app's own key reads its notes", () => {
  it("sends the system as a cached block, structured output for the schema, the model per task and the caller's signal", async () => {
    const { client: fake, sent } = client({});
    const model = anthropicModel({ client: fake, model: { extract: "claude-opus-5-5", reconcile: "claude-sonnet-5-5" }, effort: "low" });
    const signal = new AbortController().signal;
    const answer = await model(request("reconcile", signal));
    const [{ params, options }] = sent;
    assert.equal(params.model, "claude-sonnet-5-5");
    assert.deepEqual(params.system, [{ type: "text", text: "the task, the charter, the vocabulary", cache_control: { type: "ephemeral" } }]);
    assert.deepEqual(params.messages, [{ role: "user", content: "what was said" }]);
    assert.equal(params.output_config.format.type, "json_schema");
    assert.equal((params.output_config as { effort?: string }).effort, "low");
    assert.equal(options.signal, signal);
    assert.deepEqual(answer, { output: '{"ok":true}', model: "claude-sonnet-5-5", usage: { inputTokens: 900, outputTokens: 40, cacheReadTokens: 800, cacheWriteTokens: 0 } });
    assert.equal((await anthropicModel({ client: fake })(request("extract"))).model, "claude-opus-5-5", "the default model");
  });

  it("refuses a refusal, a cut-off answer and an overlong request rather than reading half an answer", async () => {
    await assert.rejects(anthropicModel({ client: client({ stop_reason: "refusal" }).client })(request("extract")), /declined/);
    await assert.rejects(anthropicModel({ client: client({ stop_reason: "max_tokens" }).client })(request("extract")), /ran past/);
    await assert.rejects(anthropicModel({ client: client({ stop_reason: "model_context_window_exceeded" }).client })(request("extract")), ModelContextError);
  });
});

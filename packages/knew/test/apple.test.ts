import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import { appleModel, appleSchemaOf, withNulls, type AppleCall, type AppleSchema } from "../src/apple.ts";
import { localIntelligence, ModelContextError, ModelUnavailableError, extractSchemaFor, reconcileSchema } from "../src/index.ts";
import { extracted, extraction, fixtureLens, fixtureVocabulary } from "../src/testing.ts";

/**
 * On the device: knew's schemas in the shape Apple's guided generation takes,
 * the context budget, the answer back in knew's shape, and Apple's errors as
 * ones knew acts on. A stand-in plays the Swift bridge.
 */

const jsonSchema = (schema: z.ZodType) => z.toJSONSchema(schema) as Record<string, unknown>;
const property = (node: AppleSchema, name: string) => {
  assert.equal(node.kind, "object");
  return (node as Extract<AppleSchema, { kind: "object" }>).properties.find((p) => p.name === name)!;
};

describe("Scenario: knew's schemas, in the shape Apple's guided generation takes", () => {
  it("turns nulls into optional fields, keeps enums as choices and integers as integers", () => {
    const extract = appleSchemaOf(jsonSchema(extractSchemaFor(fixtureVocabulary())));
    const facts = property(extract, "facts");
    assert.deepEqual([facts.optional, facts.schema.kind], [false, "array"]);
    const fact = (facts.schema as Extract<AppleSchema, { kind: "array" }>).items;
    assert.deepEqual(property(fact, "type").schema, { kind: "string", choices: fixtureVocabulary().factTypeKeys as string[], name: "Answer_facts_item_type" });
    assert.equal(property(fact, "validAt").optional, true, "a date not said is left out, not null");
    assert.equal(property(fact, "attributes").optional, true);
    assert.equal(property(property(fact, "attributes").schema, "level").optional, true);
    const reconcile = appleSchemaOf(jsonSchema(reconcileSchema));
    const decision = (property(reconcile, "decisions").schema as Extract<AppleSchema, { kind: "array" }>).items;
    assert.deepEqual(property(decision, "newIndex").schema, { kind: "integer" });
    assert.equal(property(decision, "factId").optional, true);
  });

  it("puts back as null every field Apple left out that knew allows to be null, so the answer passes knew's own check", () => {
    const schema = jsonSchema(reconcileSchema);
    const answer = withNulls(schema, { decisions: [{ newIndex: 0, action: "add" }], summary: "Linda." });
    assert.deepEqual(answer, { decisions: [{ newIndex: 0, action: "add", factId: null, invalidAt: null }], summary: "Linda." });
    assert.equal(reconcileSchema.safeParse(answer).success, true);
  });
});

describe("Scenario: A note read on the device", () => {
  it("reads a whole note through the local driver with nothing but the bridge", async () => {
    const calls: AppleCall[] = [];
    const respond = async (call: AppleCall) => {
      calls.push(call);
      if (call.prompt.startsWith("Today")) {
        const { facts } = extraction([extracted("linda", "LIKES", "Gardening")]);
        // What Apple would give: no nulls, the optional fields left out.
        return JSON.stringify({ facts: facts.map(({ attributes: _a, validAt: _v, invalidAt: _i, ...rest }) => rest), aliases: [], unresolvedNames: [], fieldUpdates: [] });
      }
      return JSON.stringify({ decisions: [], summary: "Linda gardens." });
    };
    const knew = localIntelligence({ lenses: [fixtureLens()], model: appleModel({ respond }), background: false });
    const scope = { clientId: "phone", subjectId: "me" };
    await knew.upsertEntity(scope, { id: "linda", name: "Linda" });
    await knew.addEpisode(scope, { source: "note", content: "Mom gardens", entityHints: ["linda"] });
    const now = await knew.extractNow(scope, { maxEpisodes: 1 });
    assert.equal(now.outcome, "extracted");
    assert.deepEqual(now.calls.map((call) => [call.method, call.model, call.usage?.costUsd]), [["extract", "apple-foundation-models", 0], ["reconcile", "apple-foundation-models", 0]]);
    assert.deepEqual((await knew.getEntity(scope, "linda"))!.facts.map((f) => f.fact), ["Gardening"]);
    assert.match(calls[0]!.instructions, /# Charter/);
    assert.equal(calls[0]!.schema.kind, "object");
  });

  it("refuses a request too long for the model before calling it, and maps the bridge's errors", async () => {
    let called = false;
    const tiny = appleModel({ respond: async () => ((called = true), "{}"), contextTokens: 50, reserveForAnswer: 10 });
    await assert.rejects(tiny({ task: "extract", system: "x".repeat(400), prompt: "p", schema: { type: "object", properties: {} } }), ModelContextError);
    assert.equal(called, false);

    const failingWith = (code: string) => appleModel({ respond: async () => Promise.reject(Object.assign(new Error(code), { code })) });
    const ask = (code: string) => failingWith(code)({ task: "reconcile", system: "s", prompt: "p", schema: { type: "object", properties: {} } });
    await assert.rejects(ask("context"), ModelContextError);
    await assert.rejects(ask("unavailable"), ModelUnavailableError);
    await assert.rejects(ask("unsupported-language"), ModelUnavailableError);
    await assert.rejects(ask("guardrail"), (error: unknown) => (error as { code?: string }).code === "guardrail" && !(error instanceof ModelUnavailableError));
  });
});

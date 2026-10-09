import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fallbackModel, ModelContextError, ModelUnavailableError, type Model, type ModelRequest } from "../src/index.ts";

/** On the device first, the app's own key when a request does not fit or the model is not there. */

const request: ModelRequest = { task: "extract", system: "s", prompt: "p", schema: { type: "object" } };
const answering = (name: string): Model => async () => ({ output: {}, model: name });
const failing = (error: Error): Model => async () => {
  throw error;
};

describe("Scenario: A request the first model cannot take goes to the second", () => {
  it("falls through on a context or availability failure, and the answer says which model gave it", async () => {
    const both = (first: Model) => fallbackModel(first, answering("cloud"));
    assert.equal((await both(answering("device"))(request)).model, "device");
    assert.equal((await both(failing(new ModelContextError("too long")))(request)).model, "cloud");
    assert.equal((await both(failing(new ModelUnavailableError("not downloaded", "unavailable")))(request)).model, "cloud");
  });

  it("reports any other failure as the first model's, unless told otherwise", async () => {
    await assert.rejects(fallbackModel(failing(new Error("guardrail")), answering("cloud"))(request), /guardrail/);
    const always = fallbackModel(failing(new Error("guardrail")), answering("cloud"), { when: () => true });
    assert.equal((await always(request)).model, "cloud");
  });
});

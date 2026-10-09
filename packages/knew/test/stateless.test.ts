import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { KNOWER_ID, statelessIntelligence, type Fact, type Model } from "../src/index.ts";
import { extracted, extraction, fixtureVocabulary } from "../src/testing.ts";

/**
 * Stateless mode in the app's process: the note and the facts the app holds
 * in, a plan per entry out, nothing kept. The same answer the hosted endpoint
 * gives, from the same pipeline.
 */

const said = new Date("2026-10-01T09:00:00Z");
const fact = (id: string, entityId: string, type: string, text: string): Fact => ({
  id, entityId, objectId: null, type, fact: text, attributes: {}, validAt: null, invalidAt: null,
  createdAt: new Date("2026-01-01T00:00:00Z"), lastSaidAt: null, expiredAt: null, supersededById: null, episodeIds: [],
});

describe("Scenario: An app with its own store asks for a plan, in its own process", () => {
  it("plans each entry the note is about, the knower's own included, drops what is misfiled, and reconciles against what the app sent", async () => {
    const reconciled: string[] = [];
    const model: Model = async (request) => {
      if (request.task === "extract") {
        return {
          output: extraction([
            extracted("linda", "LIKES", "Gardening"),
            extracted(KNOWER_ID, "MEANS", "Can spend about £40"),
            extracted("linda", "MEANS", "Misfiled"),
            extracted("carol", "LIKES", "Not on the roster"),
          ]),
        };
      }
      reconciled.push(request.prompt.split("\n")[0]!);
      const known = /- (00000000-0000-4000-8000-0000000000aa) \|/.exec(request.prompt);
      return {
        output: known
          ? { decisions: [{ newIndex: 0, action: "supersede", factId: known[1], invalidAt: null }], summary: "Ana can spend £40." }
          : { decisions: [], summary: "Linda gardens." },
      };
    };
    const engine = statelessIntelligence({ vocabulary: fixtureVocabulary(), model });
    const answer = await engine.extract({
      roster: [
        { id: KNOWER_ID, name: "Ana", fields: {}, aliases: [] },
        { id: "linda", name: "Linda", fields: { relationship: "mother" }, aliases: [] },
      ],
      entities: { [KNOWER_ID]: { summary: "", facts: [fact("00000000-0000-4000-8000-0000000000aa", KNOWER_ID, "MEANS", "Can spend about £30")] } },
      episode: { source: "note", content: "Mom loves gardening; I can spend about £40.", entityHints: ["linda"], referenceAt: said },
    });
    assert.deepEqual(answer.plans.map((plan) => [plan.entityId, plan.adds.map((f) => f.fact), plan.supersessions.map((s) => s.replacement.fact)]), [
      ["linda", ["Gardening"], []],
      [KNOWER_ID, [], ["Can spend about £40"]],
    ]);
    assert.equal(answer.plans[1]!.supersessions[0]!.factId, "00000000-0000-4000-8000-0000000000aa");
    assert.deepEqual([answer.offRoster, answer.misattributed], [1, 1]);
    assert.deepEqual(reconciled, ["About this person: Linda (mother)", "About this person: Ana"]);
    assert.deepEqual(answer.plans[0]!.knownAt, said);
    assert.equal(answer.calls.length, 3);
    assert.deepEqual(answer.promptVersions, { extract: "extract.v2", reconcile: "reconcile.v2" });
  });
});

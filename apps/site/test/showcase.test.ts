/**
 * The front page's code carousel. The examples compile in the site's typecheck
 * and run when the site builds; these check what is shown of them, and that
 * each still shows what its blurb says it does.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatValue, scenarios, segmentsOf, shownLines, tokenize, type Scenario } from "../lib/showcase";

const values = (scenario: Scenario | undefined) =>
  (scenario?.segments ?? []).flatMap((segment) => (segment.kind === "value" ? [segment.text] : []));
const code = (scenario: Scenario) =>
  scenario.segments.flatMap((segment) => (segment.kind === "code" ? segment.tokens.map((token) => token.text) : [])).join("");

describe("the showcase", async () => {
  const all = await scenarios();
  const byId = (id: string) => all.find((scenario) => scenario.id === id);

  it("shows only the idea: no imports, no hidden lines, no show calls, no awaits", () => {
    for (const scenario of all) {
      assert.ok(values(scenario).length > 0, `${scenario.id} shows a value`);
      assert.doesNotMatch(code(scenario), /^import |\/\/ hidden|\bshow\(|\bawait\b/m, scenario.id);
    }
  });

  it("still shows what each blurb says", () => {
    const [page, next, question, nextAfter] = values(byId("friend"));
    assert.match(page!, /What you know about Mia/);
    assert.match(next!, /^\[\s*"What she does for work",/, "the first thing to learn is specific, and proposed");
    assert.doesNotMatch(next!, /"Work"|"Background"/, "no section label stands in for a direction");
    assert.match(question!, /work/, "and the app's question is about it");
    assert.doesNotMatch(nextAfter!, /What she does for work|Where she grew up/, "once she's said, those are answered");
    assert.match(nextAfter!, /Broncos/, "and Denver opened a thread");
    const [mustHonor, forTheHost, toKnowHer] = values(byId("regular"));
    assert.match(mustHonor!, /shellfish/);
    assert.notEqual(forTheHost?.split(",")[0], toKnowHer?.split(",")[0], "the two goals ask for different things first");
    const [firstNight, fewVisitsIn, autumn, checkIn] = values(byId("place"));
    assert.match(firstNight!, /Who runs the bar/, "the first night leaves the people to notice, specifically");
    assert.equal(fewVisitsIn, "[]", "a few visits in, nothing is missing");
    assert.match(autumn!, /What's on offer/, "by autumn, what's on is due again");
    assert.match(checkIn!, /trio/, "and the app asks about it");
  });

  it("hides lines and blocks, and takes off the indentation they shared", () => {
    const source = [
      'import a from "a"; // hidden',
      "export default async function x() { // hidden",
      "  // hidden:start",
      "  const secret = 1;",
      "  // hidden:end",
      "  const b = 2;",
      "",
      "",
      "  show(b);",
      "} // hidden",
    ].join("\n");
    assert.deepEqual(shownLines(source), ["const b = 2;", "", "show(b);"]);
    assert.deepEqual(shownLines("const c = await d();"), ["const c = d();"]);
    assert.deepEqual(
      segmentsOf(source, [2]).map((segment) => segment.kind),
      ["code", "value"],
    );
    assert.throws(() => segmentsOf(source, []), /more lines than its run produced/);
    assert.throws(() => segmentsOf(source, [1, 2]), /2 values for 1 show lines/);
  });

  it("writes values the way a reader would", () => {
    assert.equal(formatValue([{ type: "AVOID", fact: "Shellfish" }]), '[{ type: "AVOID", fact: "Shellfish" }]');
    assert.equal(formatValue(new Date("2026-03-02T10:00:00Z")), '"2026-03-02"');
    assert.equal(formatValue([]), "[]");
    assert.equal(formatValue(undefined), "undefined");
    assert.match(formatValue(["a".repeat(40), "b".repeat(40)]), /^\[\n {2}"a+",\n {2}"b+",\n\]$/);
  });

  it("highlights without losing a character", () => {
    for (const scenario of all)
      for (const segment of scenario.segments)
        if (segment.kind === "code") assert.ok(segment.tokens.every((token) => token.text.length > 0), scenario.id);
    assert.deepEqual(
      tokenize('a("it\'s // not a comment"); // it\'s one').map((token) => token.kind),
      ["plain", "string", "plain", "comment"],
    );
  });
});

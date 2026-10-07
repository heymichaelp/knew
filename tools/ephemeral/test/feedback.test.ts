import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { debriefPrompt } from "../src/claude.ts";
import { anchorsOf, errorKey, findingsOf } from "../src/findings.ts";
import type { RunMetrics } from "../src/metrics.ts";
import { forInterview, momentsOf, notesOf, type Moment } from "../src/moments.ts";
import { summaryMarkdown, verifyDebrief, type Debrief, type RunRecord } from "../src/report.ts";
import { eventsFromFile, parseTranscript, type Transcript } from "../src/transcript.ts";

/**
 * The user-testing half of a run: the moments a researcher would replay the
 * tape for, found from what the agent did; the debrief's questions about
 * them; the think-aloud log; and the findings a pass rolls everything up into.
 */

const preflight = parseTranscript(eventsFromFile(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "preflight.jsonl"), "utf8")));

type Call = { name: string; input: Record<string, unknown>; result?: string; isError?: boolean } | { said: string };

/** A session in /RUN of hand-written tool calls, results and things said. */
function session(calls: Call[]): Transcript {
  const events: unknown[] = [{ type: "system", subtype: "init", cwd: "/RUN", tools: [] }];
  calls.forEach((call, index) => {
    if ("said" in call) {
      events.push({ type: "assistant", message: { content: [{ type: "text", text: call.said }] } });
      return;
    }
    events.push({ type: "assistant", message: { content: [{ type: "tool_use", id: `t${index}`, name: call.name, input: call.input }] } });
    events.push({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: `t${index}`, is_error: call.isError === true, content: call.result ?? "" }] } });
  });
  return parseTranscript(events);
}

const read = (path: string): Call => ({ name: "Read", input: { file_path: `/RUN/node_modules/@popjoker/knew/${path}` } });
const bash = (command: string, result: string, isError = false): Call => ({ name: "Bash", input: { command }, result, isError });
const failingTests = (detail: string) => bash("npm test", `not ok 1 - ${detail}\n# pass 3\n# fail 1`, true);

/** Two failures before a pass, the implementation opened, a doc re-read, an aside, and a typecheck that never passed. */
const struggled = session([
  read("README.md"),
  read("ADOPTING.md"),
  { said: "Next, the readiness rules. The docs don't say whether enough counts facts or tellings, so I'll assume facts." },
  failingTests("shows picks after five things"),
  { name: "Edit", input: { file_path: "/RUN/src/app.ts", old_string: "a", new_string: "b" } },
  failingTests("shows picks after five things"),
  read("dist/readiness.js"),
  read("ADOPTING.md"),
  bash("npm test", "# pass 4\n# fail 0"),
  bash("npx tsc --noEmit -p .", "src/app.ts(3,1): error TS2345: Argument of type 'string' is not assignable.", true),
]);

describe("Scenario: The session is read back in order, step by step", () => {
  it("numbers each tool call as a step, with what it printed, and places what the agent said between them", () => {
    assert.deepEqual(
      preflight.timeline.map((entry) => (entry.kind === "tool" ? `${entry.step}:${entry.use.name}:${entry.result ? "printed" : "silent"}` : `said after ${entry.step}`)),
      ["1:Write:printed", "2:Bash:printed", "said after 2"],
    );
  });
});

describe("Scenario: The moments worth asking about are found from what the agent did", () => {
  const moments = momentsOf(struggled);

  it("finds the struggle, the implementation opened, the doc read twice, the aside, and the check that never passed", () => {
    assert.deepEqual(
      moments.map((moment) => [moment.kind, moment.step, moment.until]),
      [
        ["aside", 2, null],
        ["stuck", 3, 8],
        ["read-implementation", 6, null],
        ["reread", 7, null],
        ["never-passed", 9, 9],
      ],
    );
  });

  it("backs a struggle with the command, its first failure, what was opened and what was edited, relative to the app", () => {
    const stuck = moments.find((moment) => moment.kind === "stuck")!;
    assert.match(stuck.what, /the tests failed 2 times in a row, between steps 3 and 8, before passing/);
    assert.deepEqual(stuck.evidence, [
      "ran `npm test`",
      "first failure: not ok 1 - shows picks after five things",
      "opened dist/readiness.js, ADOPTING.md",
      "edited src/app.ts",
    ]);
    assert.match(moments.find((moment) => moment.kind === "never-passed")!.evidence.join("\n"), /error TS2345/);
  });

  it("takes one failure fixed at once as ordinary test-first work, and a quiet session as having no moments", () => {
    const ordinary = session([failingTests("not written yet"), { name: "Write", input: { file_path: "/RUN/src/app.ts", content: "x" } }, bash("npm test", "# fail 0")]);
    assert.deepEqual(momentsOf(ordinary), []);
    assert.deepEqual(momentsOf(preflight), []);
  });

  it("asks about the hardest moments first when there are too many, and tells them in session order", () => {
    assert.deepEqual(
      forInterview(moments, 2).map((moment) => moment.kind),
      ["stuck", "never-passed"],
    );
    assert.equal(forInterview(moments).length, moments.length);
  });
});

describe("Scenario: The debrief asks about each moment by number, and keeps only answers to what it asked", () => {
  const asked = forInterview(momentsOf(struggled));

  it("numbers the moments in the prompt, with their evidence, and says to leave the list empty when there are none", () => {
    const prompt = debriefPrompt(asked);
    assert.match(prompt, /M1\. said, after step 2: “The docs don't say whether enough counts facts or tellings, so I'll assume facts\.”/);
    assert.match(prompt, /M2\. the tests failed 2 times in a row.*\(ran `npm test`; first failure: not ok 1/);
    assert.match(debriefPrompt([]), /6\. moments: leave this list empty\./);
  });

  it("ties each answer to its moment and drops an answer about a moment never asked about", () => {
    const debrief = verifyDebrief(
      {
        guessed: [],
        unhelpfulErrors: [],
        missingFromDocs: [],
        apiFriction: [],
        wouldChange: "",
        moments: [
          { moment: 2, wasDoing: "making picks wait", confusion: "whether `enough` counts tellings", wouldHaveHelped: "a sentence in ADOPTING" },
          { moment: 9, wasDoing: "?", confusion: "invented", wouldHaveHelped: "?" },
        ],
      },
      struggled,
      asked,
    )!;
    assert.deepEqual(
      debrief.moments.map((answer) => [answer.moment, answer.step, answer.confusion]),
      [[2, 3, "whether `enough` counts tellings"]],
    );
    assert.equal(debrief.moments[0]!.asked, asked[1]!.what);
    assert.equal(debrief.unaskedAnswers, 1);
  });
});

describe("Scenario: A think-aloud log is read back, each line at the step that wrote it", () => {
  it("places each line by the write or edit that added it, and keeps a line it cannot place", () => {
    const logged = session([
      { name: "Write", input: { file_path: "/RUN/NOTES.md", content: "# Notes\n\n- Guessed that a lens id must be lowercase.\n" } },
      bash("npm test", "# fail 0"),
      { name: "Edit", input: { file_path: "/RUN/NOTES.md", old_string: "lowercase.\n", new_string: "lowercase.\n- The pinned error named no valid types.\n" } },
    ]);
    const text = "# Notes\n\n- Guessed that a lens id must be lowercase.\n- The pinned error named no valid types.\n- Written by hand at the end.\n";
    assert.deepEqual(notesOf(text, logged), [
      { text: "Guessed that a lens id must be lowercase.", step: 1 },
      { text: "The pinned error named no valid types.", step: 3 },
      { text: "Written by hand at the end.", step: null },
    ]);
    assert.deepEqual(notesOf(null, logged), []);
  });
});

const NAMES = new Set(["readinessFor", "ENGINE_DEFAULTS", "enough", "after", "id"]);

describe("Scenario: A finding is grouped by what it is about", () => {
  it("anchors on a distinctive name anywhere, an ordinary word only as code, and a package file, in the order mentioned", () => {
    assert.deepEqual(anchorsOf("I read dist/readiness.js, then `enough`, then readinessFor; enough said, after all.", NAMES), [
      "dist/readiness.js",
      "`enough`",
      "`readinessFor`",
    ]);
    assert.deepEqual(anchorsOf("the `id` was wrong", NAMES), [], "a name too common to say what a complaint is about");
  });

  it("hears one error from two apps as the same error", () => {
    assert.equal(errorKey("lens visit@1: pinned names NOPE, which is not a fact type"), errorKey("lens gift@2: pinned names WISHES, which is not a fact type"));
  });
});

const NO_METRICS: RunMetrics = { turns: 10, costUsd: 1, toolCalls: {}, testRuns: 0, typecheckRuns: 0, docsOpened: [], readImplementation: false, packageErrors: [] };
const NO_DEBRIEF: Debrief = { guessed: [], unhelpfulErrors: [], missingFromDocs: [], apiFriction: [], wouldChange: "", moments: [], unverifiedQuotes: 0, unaskedAnswers: 0 };

function record(brief: string, run: number, changes: Partial<RunRecord> = {}): RunRecord {
  return {
    identity: { brief, briefVersion: 1, briefHash: "h", run, model: "m", effort: null, cliVersion: "c", tarballSha256: "t", gitSha: "0123456789", dirty: false, promptHash: "p", zodVersion: null, thinkAloud: false },
    outcome: "pass",
    reason: "",
    timedOut: false,
    budgetHit: false,
    durationMs: 60_000,
    metrics: NO_METRICS,
    source: null,
    isolation: [],
    contamination: [],
    check: { passed: true, checks: [] },
    moments: [],
    asked: [],
    notes: null,
    debrief: NO_DEBRIEF,
    ...changes,
  };
}

describe("Scenario: A pass's findings rank what several runs raised above what one did", () => {
  const readImpl: Moment = { kind: "read-implementation", step: 6, until: null, what: "opened the compiled dist/readiness.js at step 6", evidence: ["opened dist/readiness.js"] };
  const records = [
    record("places", 1, {
      metrics: { ...NO_METRICS, packageErrors: [{ message: "lens visit@1: pinned names NOPE, which is not a fact type", count: 2 }] },
      moments: [readImpl],
      asked: [readImpl],
      debrief: {
        ...NO_DEBRIEF,
        moments: [{ moment: 1, step: 6, asked: readImpl.what, evidence: readImpl.evidence, wasDoing: "checking", confusion: "how the strength of a thin ask is computed", wouldHaveHelped: "a worked example" }],
        guessed: ["Whether the revisit window counts from when a fact was first said or last said"],
      },
    }),
    record("gifting", 1, {
      metrics: { ...NO_METRICS, packageErrors: [{ message: "lens gift@1: pinned names WISHES, which is not a fact type", count: 1 }] },
      debrief: { ...NO_DEBRIEF, missingFromDocs: ["whether the revisit window counts from first said or last said"], wouldChange: "Put the valid types in the pinned error." },
    }),
    record("migrate", 1, { outcome: "contaminated", metrics: { ...NO_METRICS, packageErrors: [{ message: "lens regulars@3: pinned names X, which is not a fact type", count: 1 }] } }),
  ];
  const findings = findingsOf(records, NAMES);

  it("puts the error both briefs hit first, behaviour ahead of recall, and leaves the contaminated run out", () => {
    assert.match(findings[0]!.about, /^error: lens …: pinned names …, which is not a fact type$/);
    assert.deepEqual(findings[0]!.runs, ["gifting#1", "places#1"]);
    assert.deepEqual(findings[0]!.briefs, ["gifting", "places"]);
    assert.ok(findings.every((finding) => !finding.runs.includes("migrate#1")));
  });

  it("groups two runs' words about the same thing, and files an answer that names nothing under its moment", () => {
    const revisit = findings.find((finding) => finding.items.some((item) => item.text.includes("revisit window")))!;
    assert.deepEqual(revisit.runs, ["gifting#1", "places#1"]);
    const implementation = findings.find((finding) => finding.about === "dist/readiness.js")!;
    assert.deepEqual(
      implementation.items.map((item) => [item.backing, item.step]),
      [
        ["behaviour", 6],
        ["interview", 6],
      ],
    );
  });

  it("writes them into the summary, and says when effort is not comparable", () => {
    const summary = summaryMarkdown(records, { stamp: "now", gitSha: "0123456789", dirty: false, model: "m", thinkAloud: true }, findings);
    assert.match(summary, /## Findings/);
    assert.match(summary, /### error: lens …: pinned names …, which is not a fact type — 2 runs, 2 briefs/);
    assert.match(summary, /- behaviour · places#1, step 6: opened the compiled dist\/readiness\.js/);
    assert.match(summary, /Think-aloud was on/);
  });
});

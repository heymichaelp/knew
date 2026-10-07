import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { classify, contaminationOf, isolationProblems, measure, packageErrorsOf } from "../src/metrics.ts";
import { verifyDebrief } from "../src/report.ts";
import { eventsFromFile, parseTranscript, type Transcript } from "../src/transcript.ts";

const preflight = parseTranscript(eventsFromFile(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "preflight.jsonl"), "utf8")));

/** A transcript of hand-written tool calls and results, for the cases a quiet session never shows; run in `cwd` when given. */
function session(calls: Array<{ name: string; input: Record<string, unknown>; result?: string; isError?: boolean }>, cwd?: string): Transcript {
  const events: unknown[] = cwd ? [{ type: "system", subtype: "init", cwd, tools: [] }] : [];
  calls.forEach((call, index) => {
    events.push({ type: "assistant", message: { content: [{ type: "tool_use", id: `t${index}`, name: call.name, input: call.input }] } });
    events.push({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: `t${index}`, is_error: call.isError === true, content: call.result ?? "" }] } });
  });
  return parseTranscript(events);
}

const clean = { tools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash"], model: "claude-opus-5-5", cwd: "/RUN", personalSkills: ["find-skills"] };

describe("Scenario: The preflight session measures as the clean room it was", () => {
  it("counts its tool calls, finds no package docs opened, and nothing wrong", () => {
    const metrics = measure(preflight);
    assert.deepEqual(metrics.toolCalls, { Write: 1, Bash: 1 });
    assert.deepEqual([metrics.testRuns, metrics.typecheckRuns, metrics.docsOpened, metrics.readImplementation], [0, 0, [], false]);
    assert.equal(metrics.turns, 3);
    assert.deepEqual(isolationProblems(preflight, clean), []);
    assert.deepEqual(contaminationOf(preflight, { runDir: "/RUN", repo: "/HOME/Development/knew", home: "/HOME" }), []);
  });

  it("calls a session infra when it was not the clean room asked for", () => {
    assert.match(isolationProblems(preflight, { ...clean, model: "claude-sonnet-5-5" }).join(), /the model was claude-opus-5-5/);
    assert.match(isolationProblems(preflight, { ...clean, cwd: "/ELSEWHERE" }).join(), /ran in \/RUN/);
    assert.match(isolationProblems(preflight, { ...clean, tools: ["Read", "Bash"] }).join(), /tools were/);
    const leaky = parseTranscript([{ type: "system", subtype: "init", tools: clean.tools, slash_commands: ["find-skills", "vercel:deploy"], skills: ["find-skills"], plugins: [{ name: "vercel", path: "/HOME/.claude/plugins/vercel" }], mcp_servers: [{ name: "x" }] }]);
    const problems = isolationProblems(leaky, clean).join("\n");
    assert.match(problems, /MCP server/);
    assert.match(problems, /personal skills or plugin commands loaded: find-skills, vercel:deploy/);
    assert.match(problems, /installed plugins loaded: vercel/);
    assert.match(isolationProblems(parseTranscript([]), clean).join(), /never reported its init event/);
  });
});

describe("Scenario: What an agent did to the package, and where it reached, is read from its tool calls", () => {
  it("knows which docs it opened and whether it read the implementation", () => {
    const metrics = measure(
      session([
        { name: "Read", input: { file_path: "/RUN/node_modules/@popjoker/knew/README.md" } },
        { name: "Bash", input: { command: "cat node_modules/@popjoker/knew/ADOPTING.md | head -50" } },
        { name: "Read", input: { file_path: "/RUN/node_modules/@popjoker/knew/dist/readiness.js" } },
        { name: "Bash", input: { command: "npm test" } },
        { name: "Bash", input: { command: "npx tsc --noEmit -p ." } },
      ]),
    );
    assert.deepEqual(metrics.docsOpened, ["ADOPTING.md", "README.md", "dist/readiness.js"]);
    assert.equal(metrics.readImplementation, true);
    assert.deepEqual([metrics.testRuns, metrics.typecheckRuns], [1, 1]);
  });

  it("follows the shell's directory across calls, so docs read by bare name inside the package count", () => {
    const inRun = session(
      [
        { name: "Bash", input: { command: "cd /RUN/node_modules/@popjoker/knew && cat README.md ADOPTING.md; cat ../../../tsconfig.json; ls -R dist prompts" } },
        { name: "Bash", input: { command: "cd dist && cat index.d.ts" } },
        { name: "Bash", input: { command: 'sed -n 1,80p readiness.js; grep -n "async extractNow" testing.js' } },
        { name: "Bash", input: { command: "cd /RUN && cat > notes.txt <<'EOF'\nsee CHANGELOG.md\nEOF" } },
      ],
      "/RUN",
    );
    const metrics = measure(inRun);
    assert.deepEqual(metrics.docsOpened, ["ADOPTING.md", "README.md", "dist/index.d.ts", "dist/readiness.js", "dist/testing.js"]);
    assert.equal(metrics.readImplementation, true);
  });

  it("catches errors raised from the package by its stack, and the lens compiler's problems by their shape", () => {
    const errors = packageErrorsOf(
      session([
        {
          name: "Bash",
          input: { command: "npm test" },
          result: [
            "ZodError: [",
            '  { "code": "custom", "message": "dimension empty has no fact types, so nothing could ever be known about it", "path": [] }',
            "]",
            "    at ZodType.parse (/RUN/node_modules/zod/v4/classic/schemas.js:1:1)",
            "    at parseVocabularyDefinition (/RUN/node_modules/@popjoker/knew/dist/vocabulary.js:120:5)",
            "Error: lens visit@1: pinned names NOPE, which is not a fact type",
            "    at compileLens (/RUN/node_modules/@popjoker/knew/dist/lens.js:140:11)",
            "TypeError: Cannot read properties of undefined (reading 'x')",
            "    at main (/RUN/src/app.ts:3:3)",
          ].join("\n"),
          isError: true,
        },
      ]),
    );
    assert.deepEqual(errors, [
      { message: "lens visit@1: pinned names NOPE, which is not a fact type", count: 1 },
      { message: "ZodError at []: dimension empty has no fact types, so nothing could ever be known about it", count: 1 },
    ], "each met once; the app's own TypeError is not the package's");
  });

  it("lets the agent read the file the CLI saved an over-long output to, and nothing else of the CLI's", () => {
    const spill = "/HOME/.claude/projects/-RUN/e8d7/tool-results/bd3v.txt";
    const reasons = contaminationOf(
      session([
        { name: "Bash", input: { command: "cat node_modules/@popjoker/knew/ADOPTING.md" }, result: `<persisted-output>\nOutput too large (31.7KB). Full output saved to: ${spill}\n` },
        { name: "Read", input: { file_path: spill } },
        { name: "Read", input: { file_path: "/HOME/.claude/projects/-RUN/e8d7/other.jsonl" } },
      ]),
      { runDir: "/RUN", repo: "/HOME/Development/knew", home: "/HOME" },
    );
    assert.deepEqual(reasons, ["touched the CLI's own state: /HOME/.claude/projects/-RUN/e8d7/other.jsonl"]);
  });

  it("marks a run contaminated for naming the repo, the CLI's state, a path outside its directory, or the network", () => {
    const context = { runDir: "/RUN", repo: "/HOME/Development/knew", home: "/HOME" };
    const reasons = contaminationOf(
      session([
        { name: "Bash", input: { command: "cat /HOME/Development/knew/packages/knew/src/lens.ts" } },
        { name: "Read", input: { file_path: "/HOME/.claude/settings.json" } },
        { name: "Glob", input: { path: "/HOME/other-project" } },
        { name: "Bash", input: { command: "curl https://knew.dev" } },
        { name: "Bash", input: { command: "ls /usr/lib && node /RUN/src/app.ts" } },
      ]),
      context,
    );
    assert.equal(reasons.length, 4, reasons.join("\n"));
    assert.ok(reasons[0]!.startsWith("named the repo"));
    assert.ok(reasons.some((reason) => reason.startsWith("touched the CLI's own state")));
    assert.ok(reasons.some((reason) => reason.startsWith("reached outside its directory: /HOME/other-project")));
    assert.ok(reasons.some((reason) => reason.startsWith("tried the network")));
  });
});

describe("Scenario: A run gets one word, and the order of the words is the point", () => {
  const base = { contamination: [], isolation: [], timedOut: false, resultSubtype: "success", resultIsError: false, hasResult: true, checkPassed: false };

  it("puts contamination and infra ahead of everything, then a passing app, then the clock, the budget and failure", () => {
    assert.equal(classify({ ...base, contamination: ["named the repo"], checkPassed: true }).outcome, "contaminated");
    assert.equal(classify({ ...base, isolation: ["tools were Read"], checkPassed: true }).outcome, "infra");
    assert.equal(classify({ ...base, timedOut: true, checkPassed: true }).outcome, "pass", "a passing app passes, even stopped while polishing");
    assert.equal(classify({ ...base, timedOut: true }).outcome, "timeout");
    assert.equal(classify({ ...base, resultSubtype: "error_max_budget_usd", resultIsError: true }).outcome, "budget");
    assert.equal(classify({ ...base, hasResult: false }).outcome, "infra");
    assert.equal(classify({ ...base, resultSubtype: "error_during_execution", resultIsError: true }).outcome, "infra");
    assert.equal(classify(base).outcome, "fail");
  });
});

describe("Scenario: A debrief keeps only what the session can back up", () => {
  it("drops a quoted error whose text the tools never printed, and counts it", () => {
    const transcript = session([{ name: "Bash", input: { command: "npm test" }, result: "Error: lens visit@1: pinned names NOPE, which is not a fact type" }]);
    const debrief = verifyDebrief(
      {
        guessed: ["whether enough counts tellings"],
        unhelpfulErrors: [
          { message: "lens visit@1: pinned names NOPE, which is not a fact type", wouldHaveHelped: "name the valid types" },
          { message: "an error that never happened", wouldHaveHelped: "nothing" },
        ],
        missingFromDocs: [],
        apiFriction: [],
        wouldChange: "list the valid types in the error",
      },
      transcript,
    )!;
    assert.deepEqual(debrief.unhelpfulErrors.map((quote) => quote.message), ["lens visit@1: pinned names NOPE, which is not a fact type"]);
    assert.equal(debrief.unverifiedQuotes, 1);
    assert.deepEqual(debrief.guessed, ["whether enough counts tellings"]);
    assert.equal(verifyDebrief("not an object", transcript), null);
  });
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { eventsFromFile, parseTranscript } from "../src/transcript.ts";

/**
 * The fixture is the preflight's own session, recorded with the harness's
 * exact flags on CLI 2.1.291 and redacted (`/RUN` is the run directory,
 * `/HOME` your home). When the CLI changes shape, the preflight is rerun with
 * `--save-fixture` and these tests say what moved.
 */
const fixture = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "preflight.jsonl"), "utf8");

describe("Scenario: A recorded clean-room session reads back whole", () => {
  const transcript = parseTranscript(eventsFromFile(fixture));

  it("reads the init event the clean room is judged by", () => {
    const init = transcript.init!;
    assert.equal(init.cwd, "/RUN");
    assert.equal(init.model, "claude-opus-5-5");
    assert.equal(init.permissionMode, "acceptEdits");
    assert.deepEqual([...init.tools].sort(), ["Bash", "Edit", "Glob", "Grep", "Read", "Write"]);
    assert.deepEqual([init.mcpServers, init.slashCommands, init.skills], [[], [], []]);
    assert.ok(init.plugins.every((plugin) => plugin.path === "builtin"), "only the CLI's own plugins");
    assert.equal(init.version, "2.1.291");
  });

  it("reads each tool call, what it printed, and what the agent said", () => {
    assert.deepEqual(
      transcript.toolUses.map((use) => use.name),
      ["Write", "Bash"],
    );
    assert.equal(transcript.toolUses[0]!.input.file_path, "/RUN/hello.txt");
    assert.match(String(transcript.toolUses[1]!.input.command), /^node -e /);
    assert.deepEqual(
      transcript.toolResults.map((result) => [result.isError, result.text.slice(0, 20)]),
      [
        [false, "File created success"],
        [false, "ready"],
      ],
    );
    assert.equal(transcript.assistantText.length, 1);
  });

  it("reads the closing result: success, turns and cost", () => {
    const result = transcript.result!;
    assert.deepEqual([result.subtype, result.isError, result.numTurns], ["success", false, 3]);
    assert.ok(result.costUsd! > 0 && result.costUsd! < 1);
    assert.deepEqual(result.permissionDenials, []);
  });

  it("counts an event type it does not know rather than failing on it", () => {
    assert.ok(transcript.unknown >= 1, "the stream carries rate_limit_event lines");
    assert.equal(transcript.unparsed, 0);
  });
});

describe("Scenario: A transcript cut short or garbled still reads", () => {
  it("tolerates a killed session with no result, and lines that are not JSON", () => {
    const lines = fixture.split("\n").filter(Boolean);
    const truncated = parseTranscript(eventsFromFile([lines[0], "not json at all", lines[1], '{"type":"brand_new_event"}'].join("\n")));
    assert.ok(truncated.init);
    assert.equal(truncated.result, null);
    assert.equal(truncated.unparsed, 1);
    assert.equal(truncated.unknown, 1);
    assert.equal(truncated.toolUses.length, 1);
  });

  it("reads bare events as well as the harness's stamped ones", () => {
    const bare = eventsFromFile(fixture).map((line) => (line as { event: unknown }).event);
    assert.equal(parseTranscript(bare).toolUses.length, 2);
  });

  it("reads a tool result given as a list of text blocks", () => {
    const transcript = parseTranscript([
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", is_error: true, content: [{ type: "text", text: "one" }, { type: "text", text: "two" }] }] } },
    ]);
    assert.deepEqual(transcript.toolResults, [{ toolUseId: "t1", isError: true, text: "one\ntwo" }]);
  });
});

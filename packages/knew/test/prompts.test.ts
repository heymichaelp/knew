import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { DEFAULT_PROMPT_REFS, PROMPT_TEXT } from "../src/index.ts";

const promptsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "prompts");

describe("Scenario: The embedded prompts are the markdown files, byte for byte", () => {
  it("matches every file under prompts/ and knows no other", () => {
    for (const [ref, text] of Object.entries(PROMPT_TEXT)) {
      assert.equal(text, readFileSync(join(promptsDir, `${ref}.md`), "utf8"), `${ref}: run \`npm run prompts\``);
    }
    assert.deepEqual(Object.keys(PROMPT_TEXT).sort(), ["extract.v1", "extract.v2", "reconcile.v1", "reconcile.v2"]);
  });

  it("names no domain: the defaults speak of entries and a charter, nothing more", () => {
    for (const text of Object.values(PROMPT_TEXT)) {
      assert.doesNotMatch(text, /gift|recipient|giver/i);
    }
  });

  it("v2 is the default, speaks of entries rather than people, and calls nothing a memory", () => {
    assert.deepEqual(DEFAULT_PROMPT_REFS, { extract: "extract.v2", reconcile: "reconcile.v2" });
    for (const ref of ["extract.v2", "reconcile.v2"]) {
      const text = PROMPT_TEXT[ref]!;
      assert.doesNotMatch(text, /\bmemory\b/i, `${ref} calls itself a memory`);
      assert.doesNotMatch(text, /personId|\bthe people in\b/, `${ref} assumes the list is people`);
    }
    assert.match(PROMPT_TEXT["extract.v2"]!, /`entityId`/);
    assert.match(PROMPT_TEXT["extract.v2"]!, /The question they were answering/);
  });
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { PROMPT_TEXT } from "../src/index.ts";

const promptsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "prompts");

describe("Scenario: The embedded prompts are the markdown files, byte for byte", () => {
  it("matches every file under prompts/ and knows no other", () => {
    for (const [ref, text] of Object.entries(PROMPT_TEXT)) {
      assert.equal(text, readFileSync(join(promptsDir, `${ref}.md`), "utf8"), `${ref}: run \`npm run prompts\``);
    }
    assert.deepEqual(Object.keys(PROMPT_TEXT).sort(), ["extract.v1", "reconcile.v1"]);
  });

  it("names no domain: the defaults speak of people and a charter, nothing more", () => {
    for (const text of Object.values(PROMPT_TEXT)) {
      assert.doesNotMatch(text, /gift|recipient|giver/i);
    }
  });
});

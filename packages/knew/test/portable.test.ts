import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * What runs on a phone runs on Hermes: the engine in-process, its store and
 * the on-device adapter use nothing Node-only, and nothing Hermes lacks.
 */

const ON_DEVICE = ["local.ts", "store.ts", "read.ts", "model.ts", "stateless.ts", "fallback.ts", "apple.ts", "timers.ts", "testing.ts"];
const FORBIDDEN = [/from "node:/, /\bprocess\./, /\bBuffer\b/, /\bstructuredClone\b/, /AbortSignal\.timeout/, /AbortSignal\.any/, /\brequire\(/];

describe("Scenario: The engine runs on a phone", () => {
  for (const file of ON_DEVICE) {
    it(`${file} uses nothing Node-only`, () => {
      // Code only: a comment may name what it avoids.
      const source = readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      for (const pattern of FORBIDDEN) assert.doesNotMatch(source, pattern, `${file} uses ${pattern}`);
    });
  }
});

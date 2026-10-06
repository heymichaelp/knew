import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { briefNames } from "../src/brief.ts";
import { untouchedTsconfig } from "../src/check.ts";
import { BRIEFS, SCAFFOLD_COMPILER_OPTIONS, assertClearAncestry, lockfileVersions, scaffoldFiles } from "../src/prep.ts";

describe("Scenario: The references face the rules every agent faces", () => {
  it("holds the references to exactly the scaffold's compiler options", () => {
    const references = JSON.parse(readFileSync(join(BRIEFS, "tsconfig.json"), "utf8")) as { compilerOptions: unknown; include: string[] };
    assert.deepEqual(references.compilerOptions, SCAFFOLD_COMPILER_OPTIONS, "briefs/tsconfig.json drifted from SCAFFOLD_COMPILER_OPTIONS");
    assert.deepEqual(references.include, ["*/reference/src", "*/reference/test"]);
    assert.ok(briefNames().length > 0, "there is no brief for it to cover");
  });

  it("typechecks a finished app with the settings it was given, whatever the agent did to its own", () => {
    assert.deepEqual(JSON.parse(untouchedTsconfig()), { compilerOptions: SCAFFOLD_COMPILER_OPTIONS, include: ["../src", "../test"] });
  });
});

describe("Scenario: A throwaway app is scaffolded from the repo's own lockfile", () => {
  it("pins the dev tools to the exact versions the repo builds with, and installs the tarball under test", () => {
    const versions = lockfileVersions();
    for (const version of Object.values(versions)) assert.match(version, /^\d+\.\d+\.\d+$/);
    const scaffold = scaffoldFiles("popjoker-knew-1.0.0.tgz", "ephemeral-places", versions);
    const manifest = JSON.parse(scaffold.packageJson) as Record<string, Record<string, string>>;
    assert.deepEqual(manifest.dependencies, { "@popjoker/knew": "file:vendor/popjoker-knew-1.0.0.tgz" });
    assert.deepEqual(manifest.devDependencies, { "@types/node": versions.typesNode, tsx: versions.tsx, typescript: versions.typescript });
    assert.deepEqual(manifest.scripts, { test: "node --import tsx --test test/*.test.ts", typecheck: "tsc --noEmit -p ." });
    assert.deepEqual(JSON.parse(scaffold.tsconfig), { compilerOptions: SCAFFOLD_COMPILER_OPTIONS, include: ["src", "test"] });
  });

  it("refuses a run directory that a package.json or node_modules above it would lend modules to", () => {
    assert.throws(() => assertClearAncestry(join(BRIEFS, "places")), /would leak into its module resolution/);
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "knew-ephemeral-scaffold-")));
    try {
      assert.doesNotThrow(() => assertClearAncestry(dir), "the system temp dir must have no package.json or node_modules above it, or no run can start");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

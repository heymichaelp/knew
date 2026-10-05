/**
 * The three guards that keep knew.dev from describing an engine that does not
 * exist. Each one fails the build rather than relying on anyone remembering.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { clientMethods, contractCaseSummaries, lensFields } from "../lib/engine";
import { DOCUMENTED_METHODS } from "../lib/api-routes";
import { LENS_FIELD_NOTES } from "../lib/lens-notes";
import { headingsOf, packageManifest, readShipped } from "../lib/package-docs";

describe("the lens page cannot fall behind the schema", () => {
  it("explains every field the schema defines, and invents none", () => {
    const fromSchema = lensFields().map((f) => f.name).sort();
    const explained = Object.keys(LENS_FIELD_NOTES).sort();
    assert.deepEqual(
      explained,
      fromSchema,
      "LENS_FIELD_NOTES must have exactly one entry per lensDefinitionSchema field",
    );
  });

  it("gives every field a type and a non-empty note", () => {
    for (const field of lensFields()) {
      assert.ok(field.type && field.type !== "unknown", `${field.name} has no readable type`);
      assert.ok(LENS_FIELD_NOTES[field.name]?.trim(), `${field.name} has no note`);
    }
  });
});

describe("the API page cannot fall behind the client", () => {
  it("documents a route for every method the client exposes", () => {
    const undocumented = clientMethods().filter((m) => !DOCUMENTED_METHODS.includes(m));
    assert.deepEqual(undocumented, [], "every client method needs a row in ROUTE_GROUPS");
  });

  it("does not document methods the client does not have", () => {
    const methods = clientMethods();
    const invented = DOCUMENTED_METHODS.filter((m) => !methods.includes(m));
    assert.deepEqual(invented, [], "ROUTE_GROUPS names a client method that no longer exists");
  });

  it("names each route's timeout budget exactly once per client method", () => {
    assert.equal(new Set(DOCUMENTED_METHODS).size, DOCUMENTED_METHODS.length, "a client method is documented twice");
  });
});

describe("the contract page is the suite", () => {
  it("reads its cases from contractCases(), scripted flags intact", () => {
    const cases = contractCaseSummaries();
    assert.ok(cases.length > 0, "the contract suite is empty");
    for (const c of cases) {
      assert.ok(c.name.trim(), "a contract case has no name");
      assert.equal(typeof c.scripted, "boolean");
    }
  });
});

describe("the long-form pages come from the tarball", () => {
  it("reads the package's own docs, at the version the site will publish", () => {
    assert.match(packageManifest.version, /^\d+\.\d+\.\d+/);
    assert.equal(packageManifest.license, "MIT");
    for (const file of ["README.md", "ADOPTING.md", "CHANGELOG.md"] as const) {
      assert.ok(readShipped(file).trim().length > 0, `${file} is empty`);
    }
  });

  it("finds headings to build a contents list from", () => {
    assert.ok(headingsOf(readShipped("ADOPTING.md")).length >= 5);
    assert.ok(headingsOf(readShipped("CHANGELOG.md")).length >= 1);
  });
});

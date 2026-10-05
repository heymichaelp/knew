/**
 * What each field of a lens definition is for.
 *
 * The field *names*, types and constraints are generated from the zod schema
 * (lib/engine.ts). This file holds only the prose the schema cannot carry.
 * test/drift.test.ts asserts these keys are exactly the schema's keys, so
 * adding a field to the lens fails the site's build until it is explained.
 */
export const LENS_FIELD_NOTES: Record<string, string> = {
  id: "The lens's name, stable for its lifetime. Facts are stored against it, so renaming a lens is registering a different one.",
  version: "Bumped every time the definition changes. Each version is stored, so a fact written under version 1 is still read by the lens that wrote it.",
  factTypes:
    "The vocabulary. Each type says what it means, which brief section it belongs under, and optionally the attributes it carries. `pinned` means it is shown even when stale; `enduring` means it does not age out.",
  briefSections: "The headings of the page, in the order they appear. Every fact type's `section` must name one of these.",
  briefHeader: "The line above the page. Must contain `{who}`, which is replaced with the person.",
  overHeading: "The heading for facts that overflow the page's character budget.",
  fallbackType: "Where a fact goes when extraction cannot place it. Must be one of your own fact types.",
  sourceLabels: "How each episode source is named back to the user — `note` becoming \"from your note\", say.",
  routingFields:
    "The fields a person carries that are the client's business, not the engine's: a relationship, a city. The engine proposes values for these; it never writes them itself.",
  promptFields: "The subset of `routingFields` worth telling the model about. Must be a subset — the schema checks it.",
  briefAttributeTags: "The attributes worth showing as tags on the page. Must name attributes some fact type actually carries.",
  entityKinds: "What kinds of thing facts may attach to. Defaults to `person`; this is the seam the framework widens.",
  charter:
    "The lens's own instruction, in markdown, handed to the model with every extraction. This is where a lens says what it cares about and what it must never record.",
  asks: "The questions the lens wants answered. An ask is open until a fact of one of its `answeredBy` types exists, and `when` narrows it to the people it applies to.",
  prompts: "Which prompt versions to run. Defaults to `extract.v1` and `reconcile.v1`.",
  extractAttributeKeys: "The attributes extraction is allowed to write. Must name attributes some fact type carries.",
};

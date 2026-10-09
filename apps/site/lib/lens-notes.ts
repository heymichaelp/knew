/**
 * What each field of a lens definition is for.
 *
 * The field names, types and constraints are generated from the zod schema
 * (lib/engine.ts). This file holds only the prose. test/drift.test.ts asserts
 * these keys are exactly the schema's, top-level and inside each need and
 * section, so a new field fails the build until it is explained.
 */
export const LENS_FIELD_NOTES: Record<string, string> = {
  id: "The lens's name. Reads name it in `lens`; without one, the client's default.",
  version: "Bump on every change. Changing a lens touches no episode or fact.",
  objective: "The goal, in one sentence. The needs are what it requires understood.",
  vocabulary: "The vocabulary it reads. Several lenses can read one.",
  header: "The page's first line. `{who}` becomes the name, with the prompt fields.",
  overHeading: "The heading for facts whose own end date has passed.",
  sections: "The page's sections, in order, each holding dimensions. Default: one per dimension.",
  pinned: "The types a reader must honor. Default: the vocabulary's pinned types.",
  attributeTags: "Attributes shown in brackets after a fact.",
  needs: "What the objective needs understood. Default: one need per dimension.",
  order: "`value` (default): directions by weight × (1 − strength). `listed`: in the lens's order, the first need not met or gone stale first.",
};

/** The fields inside a need and a section. */
export const LENS_NESTED_NOTES: Record<string, Record<string, string>> = {
  "needs[]": {
    id: "The need's name, unique in the lens.",
    label: "What to understand. Default: the dimension's label; required with `types`.",
    dimension: "The dimension whose facts count. Name a dimension or `types`, not both.",
    types: "The fact types whose facts count.",
    when: "Applies only to entities whose fields match every clause, case-insensitively.",
    weight: "Relative value, 0 to 1,000. Directions run from the highest weight × (1 − strength). Default 1.",
    enough: "Fresh facts needed to meet it. Default 1.",
    after: "Needs that must be met first: coarse before fine.",
  },
  "sections[]": {
    heading: "The section's heading.",
    dimensions: "The dimensions it holds.",
  },
};

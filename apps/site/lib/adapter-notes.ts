/**
 * What each field of an adapter definition is for.
 *
 * The field names, types and constraints are generated from the zod schema
 * (lib/engine.ts). This file holds only the prose. test/drift.test.ts asserts
 * these keys are exactly the schema's, top-level and inside each move field,
 * so a new field fails the build until it is explained.
 */
export const ADAPTER_FIELD_NOTES: Record<string, string> = {
  id: "The adapter's name. Stored on every move it proposes, so never renamed.",
  version: "Bump on every change. Changing an adapter touches no move already proposed.",
  vocabulary: "The vocabulary it reads. Several adapters can read one.",
  noun: "What one move of this kind is called, singular: a moment, a search. Used in prose, never as a key.",
  instructions: "What to propose and what never to, written for the model in the charter's voice. Markdown, sent under “This kind of move” beside the task prompt.",
  fields: "Fields a move carries beside its label, by name: each filled by the model from the facts, or null. At most six.",
  perEntity: "Open moves of this kind per entity. Default 3.",
  lapse:
    "When a move nobody acted on leaves the list: `afterDays` after it was proposed (default 90), or, with a `date` field named in `field`, the day after the day the move names, when it has one.",
  dimensions: "The dimensions a move may rest on. Default: every one about the entity or the relationship. Never one about the knower.",
};

/** The fields inside a move field. */
export const ADAPTER_NESTED_NOTES: Record<string, Record<string, string>> = {
  "fields.*": {
    description: "What the field holds, written for the model.",
    kind: "`text` (default), `date` (`YYYY-MM-DD`, else null) or `enum` (one of `values`, else null).",
    values: "An enum's values. Required for `enum`, refused on any other kind.",
  },
};

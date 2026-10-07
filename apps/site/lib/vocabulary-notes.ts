/**
 * What each field of a vocabulary definition is for.
 *
 * The field names, types and constraints are generated from the zod schema
 * (lib/engine.ts). This file holds only the prose. test/drift.test.ts asserts
 * these keys are exactly the schema's, top-level and inside each fact type and
 * dimension, so a new field fails the build until it is explained.
 */
export const VOCABULARY_FIELD_NOTES: Record<string, string> = {
  id: "The vocabulary's name. Lenses name it in `vocabulary`.",
  version: "Bump on every change. Stamped on each episode extracted under it; a registered version is immutable.",
  kind: "What every entity it describes is: `person`, `place`, `thing`.",
  factTypes: "The fact types extraction writes, by key. Each informs one dimension.",
  dimensions: "The dimensions of understanding, in reading order. Each has a label and holds at least one type.",
  fallbackType: "What an unknown or retired type reads as. One of your own types.",
  fields: "Entity fields the client owns, such as `relationship`. Extraction may propose values; it never writes them.",
  promptFields: "The subset of `fields` shown beside a name, to the model and in a page's header.",
  charter: "Your instructions to the model, in markdown, sent with every extraction: what to keep and what never to record.",
  sourceLabels: "How the extraction prompt names an episode's source: `note` as “a note they wrote”.",
  prompts: "Your own wording of the two task prompts, replacing `extract.v2` and `reconcile.v2`. Rarely needed.",
  extractAttributeKeys: "The order of attribute keys in the extraction schema. Optional.",
  basedOn: "Written by `extendVocabulary`: the base it came from and every type or dimension changed or added.",
};

/** The fields inside a fact type and a dimension. */
export const VOCABULARY_NESTED_NOTES: Record<string, Record<string, string>> = {
  "factTypes.*": {
    description: "What the type means, written for the model. The prompt renders it as is.",
    dimension: "The dimension it informs.",
    attributes: "Structured fields a fact of this type carries, such as a skill's level.",
    pinned: "Honored rather than weighed: first on the page and returned as `mustHonor`.",
    enduring: "Only a fact of the same type replaces it.",
    revisitAfterDays: "Days after it was last said that a fact is due for a revisit. Off unless set; refused on an enduring type.",
  },
  "dimensions.*": {
    label: "The dimension's name: its section heading on a page, and the label of a need of it.",
  },
};

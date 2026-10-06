/**
 * What each field of a vocabulary definition is for.
 *
 * The field *names*, types and constraints are generated from the zod schema
 * (lib/engine.ts). This file holds only the prose the schema cannot carry.
 * test/drift.test.ts asserts these keys are exactly the schema's keys — the
 * top-level fields and the fields inside each fact type and dimension — so
 * adding a field to the vocabulary fails the site's build until it is
 * explained.
 */
export const VOCABULARY_FIELD_NOTES: Record<string, string> = {
  id: "The vocabulary's name, stable for its lifetime. Every lens over it names it in `vocabulary`.",
  version:
    "Bumped every time the definition changes, and stamped on every episode extracted under it. A version once registered is immutable; a change to what a type means may be worth a `resetForReplay`.",
  kind: "What every entity it describes is: `person`, `place`, `thing`. An entity on the roster is of this kind.",
  factTypes:
    "The types of fact there are, by key: what extraction writes in. Each says what it means, which dimension it informs, and optionally the attributes it carries, whether it is pinned, whether it is enduring, and how long until a fact of it is due for a revisit.",
  dimensions:
    "The facets of the subject, in the order a reader takes them in. Each has a label and, optionally, the question that probes it. Every type informs exactly one, and every one holds at least one type. Readiness reports what is known per dimension.",
  fallbackType:
    "What a retired or unknown type string reads as, so a stored fact of a type the vocabulary no longer has still has a home. Must be one of your own fact types.",
  fields:
    "The fields an entity carries on the roster that are the client's business, not the engine's: a relationship, a city. Extraction proposes values for these; it never writes them itself.",
  promptFields: "The subset of `fields` shown beside a name — to the model, and in a page's header. Must be a subset; the schema checks it.",
  charter:
    "The client's own instruction, in markdown, handed to the model with every extraction. This is where a product says what it cares about and what it must never record.",
  sourceLabels: "How the extraction prompt names where an episode came from — `note` read as “a note they wrote”, say. A source with no label is named by its own string.",
  prompts:
    "The client's own wording of the two task prompts, replacing the engine's neutral `extract.v2` and `reconcile.v2`. Rarely needed: the charter is the normal place for a product's voice.",
  extractAttributeKeys:
    "The order of the attribute keys in the schema the model fills. Optional; by default they come in the order first met walking the fact types. Must name attributes some fact type carries.",
  basedOn:
    "Written by `extendVocabulary`, never by hand: the preset this vocabulary came from, and every type or dimension of it that was changed or dropped — so a fact typed in a type left alone still means what the preset meant.",
};

/** The fields inside a fact type and a dimension. */
export const VOCABULARY_NESTED_NOTES: Record<string, Record<string, string>> = {
  "factTypes.*": {
    description: "What the type means, written for the model. This is the extraction vocabulary: the prompt renders it and never restates it.",
    dimension: "The dimension this kind of fact informs. One per type.",
    attributes: "Structured fields a fact of this type carries — a skill's level, a life event's kind. Most types have none.",
    pinned:
      "A fact of it is honored rather than weighed: always on the page, ahead of everything else, and returned as `mustHonor`. The set every lens starts from; a lens may name its own.",
    enduring:
      "A fact about who someone is. Only a fact of the same type may replace it; news of another kind is added beside it. Enforced by the planner, not trusted to the prompt.",
    revisitAfterDays:
      "How many days after it was last said a current fact of this type is due for a revisit — worth asking about again. Nothing on the page changes. Refused on an enduring type, because time never makes one false. Off unless set.",
  },
  "dimensions.*": {
    label: "What a reader calls the dimension: the section heading a lens starts from.",
    question: "The question that probes it, as the knower would be asked it. A lens that names no asks of its own asks these, and an ask of the dimension borrows it.",
  },
};

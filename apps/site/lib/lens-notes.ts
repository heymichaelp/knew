/**
 * What each field of a lens definition is for.
 *
 * The field *names*, types and constraints are generated from the zod schema
 * (lib/engine.ts). This file holds only the prose the schema cannot carry.
 * test/drift.test.ts asserts these keys are exactly the schema's keys — the
 * top-level fields and the fields inside each ask and section — so adding a
 * field to the lens fails the site's build until it is explained.
 */
export const LENS_FIELD_NOTES: Record<string, string> = {
  id: "The lens's name. A read names it in `lens`; a read that names none gets the client's default.",
  version: "Bumped every time the definition changes. Changing a lens never touches an episode or a fact — it only changes how they read.",
  objective:
    "What the knower wants to be able to do relative to the subject, in one sentence. A reader writes toward it, and the asks are what it needs known.",
  vocabulary: "The vocabulary it reads, by id. Several lenses read one vocabulary's facts.",
  header: "The page's first line. Must contain `{who}`, which becomes the name, with the vocabulary's prompt fields in parentheses when there are any.",
  overHeading: "The heading for facts past their own end date, listed last as context — “six months in Lisbon from May” is over in December, whether or not anybody says so.",
  sections:
    "The page's sections, in reading order, each holding one or more dimensions. Left out, there is one per dimension, headed by its label; given, they hold every dimension exactly once.",
  pinned: "The fact types a reader must honor rather than weigh while acting on this objective. Left out, the ones the vocabulary pins.",
  attributeTags: "The attributes worth showing in brackets after a fact line. Must name attributes some fact type carries.",
  asks:
    "The knowledge the objective needs: each ask names a dimension or the types that answer it, and may be weighted, need more than one fact, wait for another, or apply only to some entities. Left out, each dimension's question.",
};

/** The fields inside an ask and a section. */
export const LENS_NESTED_NOTES: Record<string, Record<string, string>> = {
  "asks[]": {
    id: "The ask's name, unique within the lens. Readiness and the gaps report it.",
    question: "The question as the knower would be asked it. Optional for an ask of a dimension, which borrows the dimension's.",
    dimension: "The dimension whose facts answer it. An ask names a dimension or the types that answer it — one, never both.",
    answeredBy: "The fact types a current fact of which answers it.",
    when: "Narrows the ask to the entities whose fields match every clause, case-insensitively. Left out, it applies to everyone.",
    weight: "How much it matters to the objective, relative to the other asks. The gaps run from the heaviest. Default 1.",
    enough: "How many current facts, each fresh, meet it — facts, not tellings. Below that it is thin; with enough facts but too few of them fresh, it is due. Default 1.",
    after: "Asks that must be answered first: this one is not offered until they are. Coarse before fine. An ask that does not apply to the entity holds nothing back.",
  },
  "sections[]": {
    heading: "The section's heading on the page.",
    dimensions: "The dimensions whose facts it holds, by id.",
  },
};

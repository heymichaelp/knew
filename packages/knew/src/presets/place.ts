import type { LensDefinition } from "../lens.ts";
import type { VocabularyDefinition } from "../vocabulary.ts";

/**
 * A place, as anyone who keeps track of the places they go would carve it
 * up: what to know before going, what sort of place it is, where it is, when
 * to go, what is on offer, what it is like, who they know there, and their
 * own history with it. Generic on purpose: a café, a park, a venue or a
 * friend's flat all fit, and no product's taxonomy is in it.
 *
 * Revisit windows are set only where a fact plainly drifts unheard (hours,
 * how busy it gets, what is on offer, prices); a client switches any off with
 * `revisitAfterDays: null`.
 */

export const PRESET = { id: "place", version: 1 } as const;

const CHARTER = `# What is worth keeping

**Only what was said or seen is evidence.** Keep what the knower said or plainly showed. Infer nothing from a name, a neighbourhood or a price.

**Keep what changes the next visit.** The specific beats the general: "closed Mondays" over "hours vary", "ask for the window table" over "nice seating".

**What a place is outlasts how it is run.** Its kind and where it is stay true when the menu, the hours or the owner change.

**Small talk yields nothing.** Returning no facts is a proper answer.
`;

/** The place vocabulary: twelve types across nine dimensions. */
export function vocabulary(): VocabularyDefinition {
  return {
    id: PRESET.id,
    version: PRESET.version,
    kind: "place",
    factTypes: {
      CAUTION: {
        description:
          "Something to know before going: a rule (cash only, no laptops), a barrier to getting in, a closure, a bad experience. Honored, never weighed.",
        dimension: "caution",
        pinned: true,
        revisitAfterDays: 365,
      },
      KIND: {
        description: "What sort of place it is: a café, a wine bar, a park, a music venue, a friend's flat.",
        dimension: "what",
        enduring: true,
      },
      LOCATION: {
        description: "Where it is and how to get there: the neighbourhood or address, the nearest stop, where to park, which entrance.",
        dimension: "where",
        enduring: true,
      },
      HOURS: {
        description: "When it is open: days, times, seasons. Give the date when one was said.",
        dimension: "when",
        revisitAfterDays: 30,
      },
      BUSY: {
        description: "When it is busy or quiet, and whether to book.",
        dimension: "when",
        revisitAfterDays: 90,
      },
      OFFER: {
        description: "What there is to have or do there: a dish, a drink, an exhibition, a service, an event.",
        dimension: "offer",
        revisitAfterDays: 180,
      },
      PRICE: {
        description: "What it costs, as a price or a price level.",
        dimension: "offer",
        revisitAfterDays: 365,
        attributes: [{ name: "level", kind: "enum", values: ["cheap", "moderate", "expensive"] }],
      },
      ATMOSPHERE: {
        description: "What it is like to be there: noise, light, space, the crowd, what it is good for.",
        dimension: "feel",
      },
      CONTACT: {
        description: "Someone connected to it: the owner, a regular, someone who works there, a friend who goes.",
        dimension: "people",
      },
      VISIT: {
        description: "A time the knower went, and how it went. Give the date when one was said.",
        dimension: "history",
      },
      VERDICT: {
        description: "What the knower thinks of it overall, in their own words.",
        dimension: "history",
      },
      OTHER: {
        description: "A statement worth keeping that fits no other type.",
        dimension: "other",
      },
    },
    dimensions: {
      caution: { label: "Before you go", question: "Is there anything to know before going?" },
      what: { label: "What it is", question: "What kind of place is it?" },
      where: { label: "Where it is", question: "Where is it, and how do you get there?" },
      when: { label: "When to go", question: "When is it open, and when is it busy?" },
      offer: { label: "What's on offer", question: "What is there to have or do, and what does it cost?" },
      feel: { label: "What it's like", question: "What is it like to be there?" },
      people: { label: "Who you know there", question: "Who do you know there?" },
      history: { label: "Your history with it", question: "Have you been, and how was it?" },
      other: { label: "Other" },
    },
    fallbackType: "OTHER",
    fields: [],
    charter: CHARTER,
  };
}

/**
 * The starter lens: know it well enough to plan a good visit. It asks what
 * sort of place it is first, then where it is and when to go, then what is on
 * offer and what it is like, then the knower's own history with it, who they
 * know there, and what to know before going; every ask weighs the same, so
 * that order is the order of the gaps.
 */
export function lens(): LensDefinition {
  return {
    id: "plan-a-visit",
    version: 1,
    objective: "Know it well enough to plan a good visit.",
    vocabulary: PRESET.id,
    header: "What you know about {who}:",
    overHeading: "No longer the case",
    attributeTags: ["level"],
    asks: ["what", "where", "when", "offer", "feel", "history", "people", "caution"].map((dimension) => ({ id: dimension, dimension })),
  };
}

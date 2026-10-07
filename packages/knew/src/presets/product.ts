import type { LensDefinition } from "../lens.ts";
import type { VocabularyDefinition } from "../vocabulary.ts";

/**
 * A product: a thing someone owns, has owned or is considering, carved up
 * the way anyone who keeps track of their things would: what to watch out
 * for, what it is, its details, where they stand with it and how it is
 * holding up, where it came from, how they look after it, and what they make
 * of it. Generic on purpose: a bike, a camera, a sofa or a phone all fit.
 *
 * Revisit windows are set only where a fact plainly drifts unheard (its
 * condition, whether they still have it, how they look after it); a client
 * switches any off with `revisitAfterDays: null`.
 */

export const PRESET = { id: "product", version: 1 } as const;

const CHARTER = `# What is worth keeping

**Only what was said or seen is evidence.** Keep what the knower said or plainly showed. Infer nothing from a brand, a price or a photo's background.

**Keep what changes the next decision.** The specific beats the general: "the left hinge cracked in March" over "a bit worn", "takes 28mm tyres at most" over "fits most tyres".

**What it is outlasts how it is kept.** Its make, model and details stay true when its condition or its owner changes.

**Small talk yields nothing.** Returning no facts is a proper answer.
`;

/** The product vocabulary: nine types across eight dimensions. */
export function vocabulary(): VocabularyDefinition {
  return {
    id: PRESET.id,
    version: PRESET.version,
    kind: "product",
    factTypes: {
      CAUTION: {
        description:
          "Something to watch out for with it: a hazard, a recall, an incompatibility, something never to do with it. Honored, never weighed.",
        dimension: "caution",
        pinned: true,
        enduring: true,
      },
      IDENTITY: {
        description: "What it is: its kind, make and model.",
        dimension: "what",
        enduring: true,
      },
      SPEC: {
        description: "A detail of it that stays put: size, colour, capacity, material, version.",
        dimension: "details",
        enduring: true,
      },
      OWNERSHIP: {
        description: "Where the knower stands with it: considering it, owns it, gave it away, sold it, lost it. Give the date when one was said.",
        dimension: "standing",
        revisitAfterDays: 365,
        attributes: [{ name: "state", kind: "enum", values: ["considering", "owns", "gave_away", "sold", "lost"] }],
      },
      CONDITION: {
        description: "How it is holding up: wear, faults, repairs. Give the date when one was said.",
        dimension: "standing",
        revisitAfterDays: 180,
      },
      ACQUIRED: {
        description: "Where and when it came from: the shop or the person, the price paid, the warranty.",
        dimension: "origin",
      },
      CARE: {
        description: "How it is kept or used: servicing, settings, routines, where it lives.",
        dimension: "care",
        revisitAfterDays: 365,
      },
      OPINION: {
        description: "What the knower thinks of it, in their own words.",
        dimension: "opinion",
      },
      OTHER: {
        description: "A statement worth keeping that fits no other type.",
        dimension: "other",
      },
    },
    dimensions: {
      caution: { label: "Watch out for", question: "Is there anything to watch out for with it?" },
      what: { label: "What it is", question: "What is it, exactly?" },
      details: { label: "Its details", question: "What are its details: size, version, colour?" },
      standing: { label: "Where it stands", question: "Do you have it, and how is it holding up?" },
      origin: { label: "Where it came from", question: "Where did it come from, and when?" },
      care: { label: "Looking after it", question: "How do you look after it?" },
      opinion: { label: "What you make of it", question: "What do you make of it?" },
      other: { label: "Other" },
    },
    fallbackType: "OTHER",
    fields: [],
    charter: CHARTER,
  };
}

/**
 * The starter lens: know it well enough to use it, look after it, or decide
 * on it. It asks what it is first, then where the knower stands with it, its
 * details, what they make of it, where it came from, how they look after it,
 * and what to watch out for; every ask weighs the same, so that order is the
 * order of the gaps.
 */
export function lens(): LensDefinition {
  return {
    id: "know-it",
    version: 1,
    objective: "Know it well enough to use it, look after it, or decide on it.",
    vocabulary: PRESET.id,
    header: "What you know about {who}:",
    overHeading: "No longer the case",
    attributeTags: ["state"],
    asks: ["what", "standing", "details", "opinion", "origin", "care", "caution"].map((dimension) => ({ id: dimension, dimension })),
  };
}

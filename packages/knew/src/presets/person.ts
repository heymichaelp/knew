import type { LensDefinition } from "../lens.ts";
import type { VocabularyDefinition } from "../vocabulary.ts";

/**
 * A person, as anyone who keeps track of the people in their life would
 * carve them up: what to steer clear of, what is coming up, how their life is
 * arranged, their work, their people, what they love, what they already
 * have, where they are from. Generic on purpose — drawn from what the first
 * two products over people share, and named for neither.
 *
 * Revisit windows are set only where a fact plainly drifts unheard
 * (circumstances, standing habits, work); a client switches any off with
 * `revisitAfterDays: null`.
 */

export const PRESET = { id: "person", version: 1 } as const;

const CHARTER = `# What is worth keeping

**Only their words are evidence.** Keep what the knower said or plainly showed. Infer nothing from a name, an age, a job or where someone is from.

**Keep what changes the next meeting.** The specific beats the general: "training for a marathon in October" over "likes running".

**Who someone is survives where and when.** A craft, a taste, a line they hold stays true when a job or a city changes.

**Small talk yields nothing.** Returning no facts is a proper answer.
`;

/** The person vocabulary: fourteen types across nine dimensions. */
export function vocabulary(): VocabularyDefinition {
  return {
    id: PRESET.id,
    version: PRESET.version,
    kind: "person",
    factTypes: {
      AVOID: {
        description:
          "Something to steer clear of with them: a topic, a food, a sore point, something they have asked not to happen. Honored, never weighed.",
        dimension: "avoid",
        pinned: true,
        enduring: true,
      },
      PLAN: {
        description: "Something coming up for them that was mentioned: a trip, a move, an interview, a deadline. Give the date when one was said.",
        dimension: "ahead",
      },
      MENTIONED: {
        description: "Something said once, in passing, that would be worth asking about next time: a thing they meant to try, a worry, a hope.",
        dimension: "ahead",
      },
      CIRCUMSTANCE: {
        description:
          "How their life is arranged for now: where they live, a schedule, a busy season, who they care for. It changes, so give a date when one was said.",
        dimension: "life",
        revisitAfterDays: 180,
      },
      LIFE_EVENT: {
        description: "A dated change in circumstance: a move, a new job, a retirement, a birth, an illness, a loss, a marriage, a separation.",
        dimension: "life",
        attributes: [
          {
            name: "kind",
            kind: "enum",
            values: ["moved", "new_job", "retired", "new_baby", "illness", "bereavement", "marriage", "separation", "other"],
          },
        ],
      },
      RITUAL: {
        description: "A standing habit: the Sunday run, the monthly dinner, the annual trip.",
        dimension: "life",
        revisitAfterDays: 365,
      },
      WORK: {
        description: "What they do: their role, employer or field, and what they are working on.",
        dimension: "work",
        revisitAfterDays: 365,
      },
      RELATION: {
        description: "Someone in their life and how they relate: a partner, a child, a parent, a friend, a colleague.",
        dimension: "people",
      },
      INTEREST: {
        description: "An interest or activity, with no claim yet about how deep it goes.",
        dimension: "pursuits",
      },
      SKILL: {
        description: "A pursuit with a depth claim. Depth is skill and experience, never enthusiasm: someone obsessed after a month is a beginner.",
        dimension: "pursuits",
        enduring: true,
        attributes: [{ name: "level", kind: "enum", values: ["beginner", "serious", "expert"] }],
      },
      TASTE: {
        description: "What they like and dislike, in their own words: food, music, books, style.",
        dimension: "pursuits",
        enduring: true,
      },
      HAS: {
        description: "Something they already have, so nobody suggests what they own or gives it twice.",
        dimension: "has",
        pinned: true,
      },
      ORIGIN: {
        description: "Where they are from or have lived: a hometown, a country, where they grew up or studied.",
        dimension: "background",
        enduring: true,
      },
      OTHER: {
        description: "A statement worth keeping that fits no other type.",
        dimension: "other",
      },
    },
    dimensions: {
      avoid: { label: "Steer clear of" },
      ahead: { label: "Coming up" },
      life: { label: "How life is arranged" },
      work: { label: "Work" },
      people: { label: "People in their life" },
      pursuits: { label: "What they love" },
      has: { label: "Already has" },
      background: { label: "Background" },
      other: { label: "Other" },
    },
    fallbackType: "OTHER",
    fields: [],
    charter: CHARTER,
  };
}

/**
 * The starter lens: know them well enough to meet them well next time. Its
 * needs run coarse to fine: work, people, how life is arranged, where they
 * are from, then what they love, what is coming up, what they have, and what
 * to steer clear of. Every need weighs the same, so that is the order of the
 * directions.
 */
export function lens(): LensDefinition {
  return {
    id: "know-them",
    version: 1,
    objective: "Know them well enough to meet them well next time.",
    vocabulary: PRESET.id,
    header: "What you know about {who}:",
    overHeading: "No longer the case",
    attributeTags: ["level"],
    needs: ["work", "people", "life", "background", "pursuits", "ahead", "has", "avoid"].map((dimension) => ({ id: dimension, dimension })),
  };
}

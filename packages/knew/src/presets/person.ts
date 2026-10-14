import type { AdapterDefinition } from "../adapter.ts";
import type { LensDefinition } from "../lens.ts";
import type { VocabularyDefinition } from "../vocabulary.ts";

/**
 * A person, as anyone who keeps track of the people in their life would
 * carve them up: what to steer clear of, what is coming up, their work,
 * their people, what they love, what they already have, where they live and
 * have come from; how the two of you know each other and what is between
 * you; and, about the knower, what shapes what they can do. Generic on
 * purpose — drawn from what the first two products over people share, and
 * named for neither.
 *
 * Every dimension is one a reader can act on and could, in time, fill. There
 * is no "how their life is arranged": it was never complete, so as a
 * direction it was never useful. Where they live is background; a standing
 * habit is something they love.
 *
 * Revisit windows are set only where a fact plainly drifts unheard (where
 * they live, standing habits, work); a client switches any off with
 * `revisitAfterDays: null`.
 */

export const PRESET = { id: "person", version: 1 } as const;

const CHARTER = `# What is worth keeping

**Only their words are evidence.** Keep what the knower said or plainly showed. Infer nothing from a name, an age, a job or where someone is from.

**Keep what changes the next meeting.** The specific beats the general: "training for a marathon in October" over "likes running".

**A plain "no" is worth keeping.** "Single", "no kids", "doesn't drink" settle something; keep them as facts.

**Who someone is survives where and when.** A craft, a taste, a line they hold stays true when a job or a city changes.

**Small talk yields nothing.** Returning no facts is a proper answer.
`;

/** The person vocabulary: seventeen types across eleven dimensions, two about the relationship and one about the knower. */
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
      WORK: {
        description: "What they do: their role, employer or field, and what they are working on.",
        dimension: "work",
        revisitAfterDays: 365,
      },
      RELATION: {
        description: "Someone in their life and how they relate: a partner, a child, a parent, a friend, a colleague, someone they care for.",
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
      RITUAL: {
        description: "A standing habit: the Sunday run, the monthly dinner, the annual trip.",
        dimension: "pursuits",
        revisitAfterDays: 365,
      },
      HAS: {
        description: "Something they already have, so nobody suggests what they own or gives it twice.",
        dimension: "has",
        pinned: true,
      },
      HISTORY: {
        description: "How the knower and they know each other: how and when they met, how long, what they have been through together.",
        dimension: "between",
        enduring: true,
      },
      COMMITMENT: {
        description: "Something between them now: a promise made, a favour owed, a plan they made together. Give the date when one was said.",
        dimension: "together",
        revisitAfterDays: 180,
      },
      CONSTRAINT: {
        description: "Something about the knower that shapes what they can do for people: a budget, how far away they live, how much time they have.",
        dimension: "you",
      },
      ORIGIN: {
        description: "Where they are from or have lived before: a hometown, a country, where they grew up or studied.",
        dimension: "background",
        enduring: true,
      },
      HOME: {
        description: "Where they live now, and who with. It changes, so give a date when one was said.",
        dimension: "background",
        revisitAfterDays: 365,
      },
      LIFE_EVENT: {
        description: "A dated change in their life: a move, a new job, a retirement, a birth, an illness, a loss, a marriage, a separation.",
        dimension: "background",
        attributes: [
          {
            name: "kind",
            kind: "enum",
            values: ["moved", "new_job", "retired", "new_baby", "illness", "bereavement", "marriage", "separation", "other"],
          },
        ],
      },
      OTHER: {
        description: "A statement worth keeping that fits no other type.",
        dimension: "other",
      },
    },
    dimensions: {
      avoid: { label: "Steer clear of" },
      ahead: { label: "Coming up" },
      work: { label: "Work" },
      people: { label: "People in their life" },
      pursuits: { label: "What they love" },
      has: { label: "Already has" },
      background: { label: "Background" },
      between: { label: "How you know each other", about: "relationship" },
      together: { label: "What's between you", about: "relationship" },
      you: { label: "About you", about: "knower" },
      other: { label: "Other" },
    },
    fallbackType: "OTHER",
    fields: [],
    charter: CHARTER,
  };
}

/**
 * The starter lens: know them well enough to meet them well next time. Its
 * needs run coarse to fine: work, people, how you know each other, where
 * they live and come from, then what they love, what is coming up, what is
 * between you, what they have, and what to steer clear of. Every need weighs
 * the same, so that is the order of the directions.
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
    needs: ["work", "people", "between", "background", "pursuits", "ahead", "together", "has", "avoid"].map((dimension) => ({ id: dimension, dimension })),
  };
}

/**
 * Moments: a small thing to do for them at the right time, proposed from
 * what is coming up for them, what they love, and who is in their life. A
 * product's own kind of moment (a host's, say) is `extendAdapter` with its
 * own instructions.
 */
export function moments(): AdapterDefinition {
  return {
    id: "moments",
    version: 1,
    vocabulary: PRESET.id,
    noun: "moment",
    instructions: [
      "**A moment** is a small thing to do for them at the right time, in one line: a message for an occasion they mentioned, a question about a plan when it comes round, a nod to something they love, a thought for someone they are seeing.",
      "Their words only: a date they named, a plan they spoke of, a taste they stated, a person they mentioned. Never a guess at a birthday, a faith or a family from a name or a place. Nothing that touches what they steer clear of, and nothing they already have.",
      "`when` is the day it is for, when their words give one; otherwise null, and the moment must stand on its own.",
    ].join("\n\n"),
    fields: { when: { description: "The day it is for, YYYY-MM-DD, when their words give one.", kind: "date" } },
    lapse: { field: "when", afterDays: 90 },
    dimensions: ["ahead", "pursuits", "people", "together"],
  };
}

/**
 * Watches: something in the world around them worth keeping an eye on, as a
 * search the app may run. knew runs nothing: a watch is parameters, and the
 * app decides whether and when to search.
 */
export function watches(): AdapterDefinition {
  return {
    id: "watches",
    version: 1,
    vocabulary: PRESET.id,
    noun: "search",
    instructions: [
      "**A watch** is something in the world around them worth keeping an eye on, as a search an app may run: news from where they are from or live, a team they follow, a company they work for, an event they are going to.",
      "Their words only: a place, a team, a company, an event they named. Never from a name, an accent, or where someone 'must' be from. Nothing about health, faith, politics or money unless they raised it, and nothing near what they steer clear of.",
      "`query` is a few words a search engine takes; `why` is the fact it rests on, in plain words, for whoever reads a result. This is parameters only: you search nothing, and the app decides whether and when to.",
    ].join("\n\n"),
    fields: {
      query: { description: "A few words a search engine takes: a place and what to watch for, a team's season, a company's news." },
      why: { description: "The fact it rests on, in plain words, for whoever reads the result." },
    },
    lapse: { afterDays: 90 },
    dimensions: ["background", "work", "pursuits", "ahead"],
  };
}

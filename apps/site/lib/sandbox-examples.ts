/**
 * The sandbox's starting points: one per preset, read through its starter
 * lens, and one gift lens that needs understanding of all three subjects —
 * the entity, the relationship with it, and the knower.
 *
 * The vocabularies and lenses are the package's own presets, extended the way
 * a client would. The facts are written out the way a model would have
 * returned them; everything the sandbox shows about them is the engine's.
 */
import { extendLens, type LensDefinition, type VocabularyDefinition } from "@popjoker/knew";
import * as presets from "@popjoker/knew/presets";

export type PresetName = keyof typeof presets;

/** A fact as the sandbox edits it: dates as `YYYY-MM-DD`, empty when unsaid. */
export interface DraftFact {
  id: string;
  type: string;
  text: string;
  /** When it was said: the fact is unknown before. */
  said: string;
  /** True in the world from / until. */
  from: string;
  until: string;
  attributes: Record<string, string>;
}

export interface SandboxExample {
  id: string;
  title: string;
  blurb: string;
  preset: PresetName;
  /** The entity's name. */
  name: string;
  /** The moment the page and readiness describe. */
  at: string;
  vocabulary: VocabularyDefinition;
  lens: LensDefinition;
  facts: DraftFact[];
}

type Said = Omit<DraftFact, "id" | "from" | "until" | "attributes"> & Partial<Pick<DraftFact, "from" | "until" | "attributes">>;

const drafts = (prefix: string, facts: Said[]): DraftFact[] =>
  facts.map((fact, index) => ({ from: "", until: "", attributes: {}, ...fact, id: `${prefix}-${index + 1}` }));

/** A gift lens over the person preset: what they love, what they have, your budget, and how you know each other. */
function giftLens(): LensDefinition {
  const vocabulary = presets.person.vocabulary();
  const starter = presets.person.lens();
  return extendLens(starter, {
    id: "gift",
    version: 1,
    objective: "Choose a present they will love, within what you can spend.",
    // Every dimension in its own section, the knower's included, so what you can spend is on the page.
    sections: Object.entries(vocabulary.dimensions).map(([id, dimension]) => ({ heading: dimension.label, dimensions: [id] })),
    needs: {
      ...Object.fromEntries((starter.needs ?? []).map((need) => [need.id, null])),
      loves: { label: "What they love", types: ["INTEREST", "TASTE", "SKILL"], weight: 3, enough: 2 },
      has: { dimension: "has", weight: 2, after: ["loves"] },
      budget: { dimension: "you", label: "What you can spend", weight: 2 },
      "how-close": { dimension: "between", weight: 1.5 },
      avoid: { dimension: "avoid" },
    },
  });
}

export const EXAMPLES: SandboxExample[] = [
  {
    id: "mum",
    title: "Mum, after a phone call",
    blurb: "The person preset's starter lens. One stay has ended, one ritual is due for a revisit, and nothing is known yet about her people.",
    preset: "person",
    name: "Mum",
    at: "2026-10-05",
    vocabulary: presets.person.vocabulary(),
    lens: presets.person.lens(),
    facts: drafts("mum", [
      { type: "AVOID", text: "Never bring up Jamie.", said: "2025-03-02" },
      { type: "CIRCUMSTANCE", text: "Living in Lisbon for the year.", said: "2025-09-10", until: "2026-09-28" },
      { type: "LIFE_EVENT", text: "Moved home from Lisbon.", said: "2026-10-04", from: "2026-09-28", attributes: { kind: "moved" } },
      { type: "WORK", text: "Starts a new job at the hospital.", said: "2026-10-04", from: "2026-10-12" },
      { type: "SKILL", text: "Makes ceramics.", said: "2026-10-04", attributes: { level: "serious" } },
      { type: "PLAN", text: "Selling her ceramics at the fair next month.", said: "2026-10-04", from: "2026-11-01" },
      { type: "RITUAL", text: "The Sunday phone call.", said: "2025-06-01" },
      { type: "COMMITMENT", text: "You promised to help set up her stall at the fair.", said: "2026-10-04" },
    ]),
  },
  {
    id: "mia",
    title: "Mia, before her birthday",
    blurb: "A gift lens over the person preset. It needs what she loves, how you know each other, and what you can spend: a fact about you counts for everyone.",
    preset: "person",
    name: "Mia",
    at: "2026-10-05",
    vocabulary: presets.person.vocabulary(),
    lens: giftLens(),
    facts: drafts("mia", [
      { type: "CONSTRAINT", text: "Can spend about £40 on presents.", said: "2026-09-20" },
      { type: "HISTORY", text: "Friends since university.", said: "2026-08-01" },
      { type: "TASTE", text: "Loves matcha.", said: "2026-10-01" },
      { type: "HAS", text: "Already has a matcha whisk set.", said: "2026-10-01" },
    ]),
  },
  {
    id: "lisbon",
    title: "Lisbon, before a trip",
    blurb: "The place preset's starter lens. Opening hours go stale in a month, and your own history with the city is a relationship.",
    preset: "place",
    name: "Lisbon",
    at: "2026-10-05",
    vocabulary: presets.place.vocabulary(),
    lens: presets.place.lens(),
    facts: drafts("lisbon", [
      { type: "KIND", text: "A hilly coastal capital.", said: "2026-06-01" },
      { type: "LOCATION", text: "On Portugal's west coast, where the Tagus meets the sea.", said: "2026-06-01" },
      { type: "HOURS", text: "The trams through Alfama stop at eleven at night.", said: "2026-08-01" },
      { type: "OFFER", text: "Fado bars in Alfama.", said: "2026-06-01" },
      { type: "ATMOSPHERE", text: "Loud and joyful late into the night.", said: "2026-06-01" },
      { type: "VISIT", text: "Spent a week there in May 2019.", said: "2026-06-01" },
      { type: "VERDICT", text: "Would go back for the food alone.", said: "2026-06-01" },
    ]),
  },
  {
    id: "bike",
    title: "Your touring bike",
    blurb: "The product preset's starter lens. Most of what matters about a thing you own is your relationship with it.",
    preset: "product",
    name: "the touring bike",
    at: "2026-10-05",
    vocabulary: presets.product.vocabulary(),
    lens: presets.product.lens(),
    facts: drafts("bike", [
      { type: "IDENTITY", text: "A steel touring bike.", said: "2025-06-01" },
      { type: "SPEC", text: "Takes 42mm tyres at most.", said: "2025-06-01" },
      { type: "OWNERSHIP", text: "Bought it second-hand.", said: "2025-06-01", from: "2023-04-01", attributes: { state: "owns" } },
      { type: "ACQUIRED", text: "From a friend's garage sale.", said: "2025-06-01" },
      { type: "CONDITION", text: "The rear wheel is slightly out of true.", said: "2026-02-01" },
      { type: "OPINION", text: "Your favourite thing you own.", said: "2026-02-01" },
    ]),
  },
  ...(Object.keys(presets) as PresetName[]).map(
    (preset): SandboxExample => ({
      id: `empty-${preset}`,
      title: `An empty ${preset}`,
      blurb: `The ${preset} preset's starter lens, with nothing known yet.`,
      preset,
      name: `A ${preset}`,
      at: "2026-10-05",
      vocabulary: presets[preset].vocabulary(),
      lens: presets[preset].lens(),
      facts: [],
    }),
  ),
];

/** The first example over a preset: where its page in the docs sends a reader to try it. */
export function exampleFor(preset: PresetName): SandboxExample {
  return EXAMPLES.find((example) => example.preset === preset)!;
}

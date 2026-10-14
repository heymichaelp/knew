import type { ENGINE_DEFAULTS } from "@popjoker/knew";

/**
 * What each of the engine's defaults means. The values come from
 * `ENGINE_DEFAULTS` itself (lib/engine.ts); the `satisfies` below and
 * test/drift.test.ts keep this list to exactly its keys.
 */
export const DEFAULT_NOTES = {
  weight: "A need's weight when it names none. All equal, so directions follow the lens's order.",
  enough: "Fresh facts that meet a need when it names no count.",
  revisitAfterDays: "When a fact goes due if its type names no window: never.",
  dueCredit: "What a fact due for a revisit counts toward a need, against a fresh fact's 1. Never enough alone. Also what a proposed direction is worth in a need already met.",
  directionsPerDimension: "Open directions the model may hold per dimension of an entity, when the vocabulary names no number.",
  directionLapseDays: "Days after it was proposed that a direction nobody acted on leaves `next`, when the vocabulary names no window.",
  briefMaxChars: "The page's size in characters when a read names none.",
} satisfies Record<keyof typeof ENGINE_DEFAULTS, string>;

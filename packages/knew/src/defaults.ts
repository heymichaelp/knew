/**
 * What the engine assumes when a definition says nothing — mechanics only.
 * The core ships no content: no fact type, no heading, no question. Those
 * come from a client's own vocabulary and lens, or from a preset in
 * `@popjoker/knew/presets` that a client extends.
 *
 * The layers, each overriding the one below: these defaults, then a preset,
 * then the client's vocabulary, then a lens, then the call.
 */
export const ENGINE_DEFAULTS = {
  /** How much an ask matters to its lens's objective, relative to the others. */
  weight: 1,
  /** How many current facts, each fresh, meet an ask. */
  enough: 1,
  /** Days after it was last said that a fact is due for a revisit. Null:
   *  never. A type opts in; the engine never decides on its own that a fact
   *  has gone quiet. */
  revisitAfterDays: null as number | null,
  /** What a fact due for a revisit counts toward an ask, against a fresh
   *  one's 1. A mechanic, not a field a definition sets. */
  dueCredit: 0.5,
  /** The page's size: what fits a reader's context beside its own material. */
  briefMaxChars: 3_500,
} as const;

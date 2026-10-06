import type { ENGINE_DEFAULTS } from "@popjoker/knew";

/**
 * What each of the engine's defaults means. The values come from
 * `ENGINE_DEFAULTS` itself (lib/engine.ts); the `satisfies` below and
 * test/drift.test.ts keep this list to exactly its keys.
 */
export const DEFAULT_NOTES = {
  weight: "How much an ask weighs when it does not say. Every ask equal, so the lens's order is the order of the gaps.",
  enough: "How many fresh facts meet an ask when it does not say: one, which is exactly what the gaps always asked.",
  revisitAfterDays:
    "When a fact is due for a revisit if its type does not say: never. A vocabulary opts a type in; the engine never decides on its own that a fact has gone quiet.",
  dueCredit:
    "What a fact due for a revisit counts toward an ask, against a fresh one's 1. A mechanic, not a field: it keeps a quiet fact worth something without ever letting it meet an ask.",
  briefMaxChars: "The page's size in characters when a read does not say: what fits a reader's context beside its own material.",
} satisfies Record<keyof typeof ENGINE_DEFAULTS, string>;

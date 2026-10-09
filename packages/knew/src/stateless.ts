import { readerFor, type Model } from "./model.ts";
import { readNote } from "./read.ts";
import type { StatelessExtraction, StatelessIntelligence } from "./types.ts";
import type { Vocabulary } from "./vocabulary.ts";

/**
 * Stateless mode in your process: one note and the facts the app already
 * holds in, a plan per entry out, which the app applies to its own store.
 * The same answer the hosted `POST /v1/stateless/extract` gives, from the same
 * pipeline, with the app's own model. Nothing is kept.
 *
 * The knower is on the roster whether or not the app sends `self`; send it,
 * with its facts under `entities.self`, to reconcile what the knower says
 * about themselves against what is already known about them.
 */
export function statelessIntelligence(options: { vocabulary: Vocabulary; model: Model; entitiesPerEpisode?: number }): StatelessIntelligence {
  const reader = readerFor(options.vocabulary, options.model);
  return {
    async extract(request): Promise<StatelessExtraction> {
      const note = await readNote(reader, {
        vocabulary: options.vocabulary,
        roster: request.roster,
        known: (entityId) => request.entities[entityId] ?? { summary: "", facts: [] },
        note: {
          content: request.episode.content,
          observed: request.episode.observed ?? null,
          inReplyTo: request.episode.inReplyTo ?? null,
          source: request.episode.source,
          referenceAt: request.episode.referenceAt,
          entityHints: request.episode.entityHints ?? [],
        },
        ...(options.entitiesPerEpisode !== undefined ? { cap: options.entitiesPerEpisode } : {}),
      });
      return {
        plans: note.plans,
        unresolvedNames: note.unresolvedNames,
        fieldUpdates: note.fieldUpdates,
        offRoster: note.offRoster,
        misattributed: note.misattributed,
        droppedForCap: note.droppedForCap,
        calls: note.calls,
        promptVersions: { extract: reader.refs.extract, reconcile: note.plans.length > 0 ? reader.refs.reconcile : null },
      };
    },
  };
}

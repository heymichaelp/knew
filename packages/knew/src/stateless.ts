import { planDirections } from "./directions.ts";
import { readerFor, type Model } from "./model.ts";
import { readNote } from "./read.ts";
import { deadlineSignal } from "./timers.ts";
import type { ModelCall, StatelessExtraction, StatelessIntelligence, StatelessNext } from "./types.ts";
import type { Vocabulary } from "./vocabulary.ts";

/**
 * Stateless mode in your process: one note and the facts the app already
 * holds in, a plan per entry out, which the app applies to its own store;
 * then, per entry the note changed, what to learn next, as a plan for the
 * app's own directions. The same answers the hosted `POST /v1/stateless/*`
 * routes give, from the same pipeline, with the app's own model. Nothing is
 * kept.
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
    async next(request): Promise<StatelessNext> {
      const { vocabulary } = options;
      const at = request.referenceAt ?? new Date();
      const calls: ModelCall[] = [];
      // A vocabulary that proposes no directions answers with an empty plan and no call.
      if (!vocabulary.directions) return { plan: { answered: [], withdrawn: [], proposed: [], rejected: 0 }, calls, promptVersion: reader.refs.next };
      const current = (facts: typeof request.facts) => facts.filter((fact) => !fact.expiredAt);
      const timer = deadlineSignal(request.callTimeoutMs ?? null);
      try {
        const answer = await reader.next(
          {
            entity: { name: request.entity.name, fields: request.entity.fields },
            referenceAt: at,
            facts: current(request.facts),
            knower: current(request.knowerFacts ?? []),
            learned: request.learned ?? [],
            directions: request.directions,
            perDimension: vocabulary.directions.perDimension,
            lapseAfterDays: vocabulary.directions.lapseAfterDays,
          },
          calls,
          timer.signal,
        );
        const plan = planDirections({ vocabulary, facts: request.facts, directions: request.directions, answer, at });
        return { plan, calls, promptVersion: reader.refs.next };
      } catch (error) {
        // The call was still made, and may still have cost something.
        if (error !== null && typeof error === "object") Object.assign(error, { calls });
        throw error;
      } finally {
        timer.release();
      }
    },
  };
}

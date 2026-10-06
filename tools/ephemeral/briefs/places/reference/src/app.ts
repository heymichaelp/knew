import { randomUUID } from "node:crypto";
import type { Intelligence, IntelligenceScope } from "@popjoker/knew";

/**
 * Haunts' side of knew: the places on a user's list, the notes they write on
 * them, and the one thing worth finding out before a visit. Every call is
 * scoped to the user, so one notebook never reads another's.
 */

const LENS = "visit";

export interface NextQuestion {
  question: string;
  /** What knew took from notes gone stale, when re-checking them is the next thing to do. */
  recheck: string[];
}

export interface Haunts {
  addPlace(userId: string, place: { id: string; name: string }): Promise<void>;
  addNote(userId: string, placeId: string, text: string, options?: { at?: Date }): Promise<void>;
  nextQuestion(userId: string, placeId: string): Promise<NextQuestion | null>;
}

export function createApp(engine: Intelligence): Haunts {
  const scope = (userId: string): IntelligenceScope => ({ clientId: "haunts", subjectId: userId });
  return {
    async addPlace(userId, place) {
      await engine.upsertEntity(scope(userId), { id: place.id, name: place.name });
    },

    async addNote(userId, placeId, text, options = {}) {
      const sourceRef = randomUUID();
      await engine.addEpisode(scope(userId), {
        source: "note",
        sourceRef,
        content: text,
        entityHints: [placeId],
        referenceAt: options.at ?? new Date(),
        extract: "inline",
      });
      // Read it now, so the next question already knows it; when this step cannot, the sweep will.
      const outcome = await engine.extractNow(scope(userId), { maxEpisodes: 5, askedSourceRef: sourceRef });
      if (outcome.askedIngested !== true) await engine.requestExtract(scope(userId));
    },

    async nextQuestion(userId, placeId) {
      const readiness = await engine.readiness(scope(userId), placeId, { lens: LENS });
      const step = readiness?.next[0];
      if (!step) return null;
      if (step.kind === "ask") return { question: step.question, recheck: [] };
      const view = await engine.getEntity(scope(userId), placeId);
      const said = new Map((view?.facts ?? []).map((fact) => [fact.id, fact.fact]));
      return { question: step.question, recheck: step.factIds.flatMap((id) => said.get(id) ?? []) };
    },
  };
}

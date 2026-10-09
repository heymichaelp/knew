import { randomUUID } from "node:crypto";
import { factsTrueAt, type Intelligence, type IntelligenceScope } from "@popjoker/knew";

/**
 * Haunts on knew: the places on a user's list, and what their notes say about
 * them, as of any moment. knew reads each note; Haunts records it, waits for
 * the reading, and answers from what knew keeps. Every call is scoped to the
 * user.
 */

export interface Statement {
  topic: string;
  text: string;
}

export interface Haunts {
  addPlace(userId: string, place: { id: string; name: string }): Promise<void>;
  addNote(userId: string, placeId: string, text: string, options?: { at?: Date }): Promise<void>;
  known(userId: string, placeId: string, options?: { asOf?: Date }): Promise<Statement[] | null>;
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
      const outcome = await engine.extractNow(scope(userId), { maxEpisodes: 5, askedSourceRef: sourceRef });
      if (outcome.askedIngested !== true) await engine.requestExtract(scope(userId));
    },

    async known(userId, placeId, options = {}) {
      const asOf = options.asOf ?? new Date();
      const view = await engine.getEntity(scope(userId), placeId, { asOf });
      if (!view) return null;
      return factsTrueAt(view.facts, asOf).map((fact) => ({ topic: fact.type, text: fact.fact }));
    },
  };
}

import { randomUUID } from "node:crypto";
import { factsTrueAt, type Intelligence, type IntelligenceScope } from "@popjoker/knew";

/**
 * Haunts on knew: the places on a user's list, what their notes say, what is
 * known as of any moment, and the one thing most worth finding out before a
 * visit. Every call is scoped to the user.
 */

const LENS = "visit";

export interface NextToLearn {
  about: string;
  recheck: string[];
}

export interface Haunts {
  addPlace(userId: string, place: { id: string; name: string }): Promise<void>;
  addNote(userId: string, placeId: string, text: string, options?: { at?: Date }): Promise<void>;
  known(userId: string, placeId: string, options?: { asOf?: Date }): Promise<string[] | null>;
  nextToLearn(userId: string, placeId: string): Promise<NextToLearn | null>;
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
      return factsTrueAt(view.facts, asOf).map((fact) => fact.fact);
    },

    async nextToLearn(userId, placeId) {
      const readiness = await engine.readiness(scope(userId), placeId, { lens: LENS });
      const direction = readiness?.next[0];
      if (!direction) return null;
      if (direction.kind === "learn") return { about: direction.label, recheck: [] };
      const view = await engine.getEntity(scope(userId), placeId);
      const said = new Map((view?.facts ?? []).map((fact) => [fact.id, fact.fact]));
      return { about: direction.label, recheck: direction.factIds.flatMap((id) => said.get(id) ?? []) };
    },
  };
}

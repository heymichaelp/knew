import { randomUUID } from "node:crypto";
import type { Intelligence, IntelligenceScope } from "@popjoker/knew";

/**
 * Thoughtful's side of knew: the people a user buys for, the notes they write
 * about them, and what to do first on a person's gift page: ask, or show
 * picks. Every call is scoped to the user.
 */

const LENS = "gift";
/** The gift lens's ask that says whether enough is known to show picks first. */
const KNOWS_ENOUGH = "what-they-love";

export type FirstMove = { move: "ask-first"; question: string } | { move: "show-first"; page: string; honor: string[] };

export interface Thoughtful {
  addPerson(userId: string, person: { id: string; name: string }): Promise<void>;
  addNote(userId: string, personId: string, text: string, options?: { at?: Date }): Promise<void>;
  firstMove(userId: string, personId: string): Promise<FirstMove | null>;
}

export function createApp(engine: Intelligence): Thoughtful {
  const scope = (userId: string): IntelligenceScope => ({ clientId: "thoughtful", subjectId: userId });
  return {
    async addPerson(userId, person) {
      await engine.upsertEntity(scope(userId), { id: person.id, name: person.name });
    },

    async addNote(userId, personId, text, options = {}) {
      const sourceRef = randomUUID();
      await engine.addEpisode(scope(userId), {
        source: "note",
        sourceRef,
        content: text,
        entityHints: [personId],
        referenceAt: options.at ?? new Date(),
        extract: "inline",
      });
      const outcome = await engine.extractNow(scope(userId), { maxEpisodes: 5, askedSourceRef: sourceRef });
      if (outcome.askedIngested !== true) await engine.requestExtract(scope(userId));
    },

    async firstMove(userId, personId) {
      const readiness = await engine.readiness(scope(userId), personId, { lens: LENS });
      if (!readiness) return null;
      const knowsEnough = readiness.asks.find((ask) => ask.id === KNOWS_ENOUGH)?.state === "met";
      const step = readiness.next[0];
      if (!knowsEnough && step) return { move: "ask-first", question: step.question };
      const brief = await engine.brief(scope(userId), personId, { lens: LENS });
      return { move: "show-first", page: brief?.text ?? "", honor: brief?.mustHonor.map((item) => item.fact) ?? [] };
    },
  };
}

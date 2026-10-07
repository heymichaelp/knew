/**
 * Haunts with no knew: its own store of what notes said, in memory. Each
 * statement keeps when it was said, when it was last heard, when it ends, and
 * when a correction replaced it, so what is known can be read as of any
 * moment. Every user's notebook is separate.
 */

export type Topic = "KIND" | "HOURS" | "VIBE" | "ORDER";

export interface Statement {
  placeId: string;
  topic: Topic;
  text: string;
  until: string | null;
  replaces: string | null;
  repeats: string | null;
}

export type Read = (text: string, context: { places: Array<{ id: string; name: string }> }) => Promise<Statement[]>;

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

interface Kept {
  topic: Topic;
  text: string;
  saidAt: Date;
  heardAt: Date;
  until: Date | null;
  replacedAt: Date | null;
}

interface Place {
  name: string;
  kept: Kept[];
}

const DAY_MS = 86_400_000;
const STALE_AFTER_DAYS = 30;
const LABEL: Record<Topic, string> = {
  KIND: "What kind of place it is",
  HOURS: "When it is open",
  VIBE: "What it is like to be there",
  ORDER: "What to order",
};

const holds = (kept: Kept, at: Date) =>
  kept.saidAt <= at && (kept.replacedAt === null || kept.replacedAt > at) && (kept.until === null || kept.until > at);

export function createApp({ read }: { read: Read }): Haunts {
  const notebooks = new Map<string, Map<string, Place>>();
  const notebook = (userId: string) => {
    let places = notebooks.get(userId);
    if (!places) notebooks.set(userId, (places = new Map()));
    return places;
  };

  return {
    async addPlace(userId, place) {
      const existing = notebook(userId).get(place.id);
      if (existing) existing.name = place.name;
      else notebook(userId).set(place.id, { name: place.name, kept: [] });
    },

    async addNote(userId, _placeId, text, options = {}) {
      const at = options.at ?? new Date();
      const places = notebook(userId);
      const statements = await read(text, { places: [...places].map(([id, place]) => ({ id, name: place.name })) });
      for (const statement of statements) {
        const place = places.get(statement.placeId);
        if (!place) continue;
        const live = (wanted: string) => place.kept.find((kept) => kept.text === wanted && holds(kept, at));
        if (statement.repeats) {
          const repeated = live(statement.repeats);
          if (repeated) {
            if (at > repeated.heardAt) repeated.heardAt = at;
            continue;
          }
        }
        if (statement.replaces) {
          const replaced = live(statement.replaces);
          if (replaced) replaced.replacedAt = at;
        }
        place.kept.push({ topic: statement.topic, text: statement.text, saidAt: at, heardAt: at, until: statement.until ? new Date(statement.until) : null, replacedAt: null });
      }
    },

    async known(userId, placeId, options = {}) {
      const place = notebook(userId).get(placeId);
      if (!place) return null;
      const asOf = options.asOf ?? new Date();
      return place.kept.filter((kept) => holds(kept, asOf)).map((kept) => kept.text);
    },

    async nextToLearn(userId, placeId) {
      const place = notebook(userId).get(placeId);
      if (!place) return null;
      const now = new Date();
      const current = place.kept.filter((kept) => holds(kept, now));
      const of = (topic: Topic) => current.filter((kept) => kept.topic === topic);
      if (of("KIND").length === 0) return { about: LABEL.KIND, recheck: [] };
      const hours = of("HOURS");
      if (hours.length === 0) return { about: LABEL.HOURS, recheck: [] };
      const fresh = hours.some((kept) => now.getTime() - kept.heardAt.getTime() < STALE_AFTER_DAYS * DAY_MS);
      if (!fresh) return { about: LABEL.HOURS, recheck: hours.map((kept) => kept.text) };
      if (of("VIBE").length === 0) return { about: LABEL.VIBE, recheck: [] };
      if (of("ORDER").length === 0) return { about: LABEL.ORDER, recheck: [] };
      return null;
    },
  };
}

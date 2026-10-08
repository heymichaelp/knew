/**
 * Haunts with no knew: it reads each note with the model it is handed, in one
 * request that shows the note beside everything currently held, and asks for
 * the note's statements with what each corrects or repeats. It keeps every
 * statement with when it was said, when it ends and when it was replaced, so
 * what is known can be read as of any moment.
 */

export type Topic = "KIND" | "HOURS" | "VIBE" | "ORDER";

export interface Statement {
  topic: string;
  text: string;
}

export type Model = (request: { system: string; prompt: string; schema: object }) => Promise<unknown>;

export interface Haunts {
  addPlace(userId: string, place: { id: string; name: string }): Promise<void>;
  addNote(userId: string, placeId: string, text: string, options?: { at?: Date }): Promise<void>;
  known(userId: string, placeId: string, options?: { asOf?: Date }): Promise<Statement[] | null>;
}

interface Kept {
  topic: Topic;
  text: string;
  saidAt: Date;
  until: Date | null;
  replacedAt: Date | null;
}

interface Place {
  name: string;
  kept: Kept[];
}

interface Read {
  statements: Array<{ placeId: string; topic: Topic; text: string; until: string | null; replaces: number | null; repeats: number | null }>;
}

const SYSTEM = `You read short notes people write about places they go, and keep what each note says.

Return the note's statements about places on the list, each about one topic:
- KIND: what kind of place it is (a café, a wine bar). What a place serves or adds does not change what kind of place it is.
- HOURS: when it is open.
- VIBE: what it is like to be there. Several can be true at once ("loud after ten", "quiet before eight").
- ORDER: something worth ordering or doing there, including a pop-up or special.

For each statement:
- placeId: the id of the place on the list it is about. Say nothing about places that are not on the list.
- text: the statement, short, in plain words.
- until: the date it ends, as YYYY-MM-DD, when the note says it ends; otherwise null. Resolve relative dates against today.
- replaces: the number of a current statement it corrects or makes untrue (new hours replace old hours; "it's a wine bar, not a cocktail bar" replaces the old kind); otherwise null. Only replace what the note says has changed.
- repeats: the number of a current statement it says again in other words; otherwise null. A repeat is not a new statement.

A note that says nothing worth keeping has no statements.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["statements"],
  properties: {
    statements: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["placeId", "topic", "text", "until", "replaces", "repeats"],
        properties: {
          placeId: { type: "string" },
          topic: { type: "string", enum: ["KIND", "HOURS", "VIBE", "ORDER"] },
          text: { type: "string" },
          until: { type: ["string", "null"] },
          replaces: { type: ["integer", "null"] },
          repeats: { type: ["integer", "null"] },
        },
      },
    },
  },
} as const;

const holds = (kept: Kept, at: Date) => kept.saidAt <= at && (kept.replacedAt === null || kept.replacedAt > at) && (kept.until === null || kept.until > at);

export function createApp({ model }: { model: Model }): Haunts {
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
      const current = [...places].flatMap(([id, place]) => place.kept.filter((kept) => holds(kept, at)).map((kept) => ({ id, kept })));
      const prompt = [
        `Today: ${at.toISOString().slice(0, 10)}`,
        `The places on the list (id: name):\n${[...places].map(([id, place]) => `- ${id}: ${place.name}`).join("\n") || "(none)"}`,
        `Current statements (number | place | topic | text):\n${current.map(({ id, kept }, index) => `- ${index} | ${id} | ${kept.topic} | ${kept.text}`).join("\n") || "(none)"}`,
        `The note:\n"""\n${text}\n"""`,
      ].join("\n\n");
      const read = (await model({ system: SYSTEM, prompt, schema: SCHEMA })) as Read;
      for (const statement of read.statements ?? []) {
        const place = places.get(statement.placeId);
        if (!place) continue;
        if (statement.repeats !== null && current[statement.repeats]) continue;
        const replaced = statement.replaces !== null ? current[statement.replaces] : undefined;
        if (replaced) replaced.kept.replacedAt = at;
        place.kept.push({ topic: statement.topic, text: statement.text, saidAt: at, until: statement.until ? new Date(statement.until) : null, replacedAt: null });
      }
    },

    async known(userId, placeId, options = {}) {
      const place = notebook(userId).get(placeId);
      if (!place) return null;
      const asOf = options.asOf ?? new Date();
      return place.kept.filter((kept) => holds(kept, asOf)).map((kept) => ({ topic: kept.topic, text: kept.text }));
    },
  };
}

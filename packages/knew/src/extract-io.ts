import { dayOf } from "./dates.ts";
import { isLapsed } from "./directions.ts";
import type { Fact, ProposedDirection, RosterEntry } from "./types.ts";
import { KNOWER_ID, whoLabel, type Vocabulary } from "./vocabulary.ts";

/**
 * What the two model calls are shown — pure, so what the model sees is
 * testable without a model. The vocabulary supplies its kind, the source
 * labels and which of an entity's fields are shown beside its name;
 * everything else is the engine's one wording, and names no domain.
 */

export function extractInput(
  vocabulary: Vocabulary,
  input: {
    content: string;
    /** What the phone read off the turn's photographs, when it carried any. */
    observed?: string | null;
    /** The question the knower was answering, when this is a reply. */
    inReplyTo?: string | null;
    source: string;
    referenceAt: Date;
    roster: RosterEntry[];
    hints: readonly string[];
  },
): string {
  // The knower is always on the list, first: what the person writing says about themselves attaches there.
  const knower = input.roster.find((entry) => entry.id === KNOWER_ID);
  const others = input.roster.filter((entry) => entry.id !== KNOWER_ID);
  const knowerLine = `- id: ${KNOWER_ID} | name: ${knower?.name ?? "the person writing"} (the person writing: "I", "me", "my")`;
  const roster =
    others.length === 0
      ? `${knowerLine}\n(no other entries yet — anyone or anything else mentioned is unresolved)`
      : [knowerLine, ...others
          .map((entry) => {
            const parts = [`id: ${entry.id}`, `name: ${entry.name}`];
            for (const field of vocabulary.promptFields) {
              const value = entry.fields[field];
              if (typeof value === "string" && value.trim() !== "") parts.push(`${field}: ${value}`);
            }
            if (entry.aliases.length > 0) parts.push(`also called: ${entry.aliases.join(", ")}`);
            const hinted = input.hints.includes(entry.id) ? " (recorded about them)" : "";
            return `- ${parts.join(" | ")}${hinted}`;
          })].join("\n");
  return [
    `Today (when this was said): ${dayOf(input.referenceAt)}`,
    `Where it came from: ${vocabulary.sourceLabels[input.source] ?? input.source}`,
    `The entries on their list: the person writing, then each of kind "${vocabulary.kind}" (attach facts only to these ids):\n${roster}`,
    // THE QUESTION THEY WERE ANSWERING, when this is a reply — quoted apart
    // and labelled, because it is the client's wording, not testimony: it
    // tells the model what the answer is about and is never itself a fact.
    ...(input.inReplyTo ? [`The question they were answering (context, not something they said):\n"""\n${input.inReplyTo}\n"""`] : []),
    `What was said:\n"""\n${input.content}\n"""`,
    // WHAT THEIR PHONE SAW, when the turn carried photographs — labelled as
    // such and quoted apart, because it is not testimony. The two halves are
    // different evidence and the instruction says so: what a text recogniser
    // READ off the photograph is as hard as evidence from a picture gets; the
    // description is a small model's impression and is soft. Named by its
    // CLAUSE, not its punctuation, because the description is free prose that
    // may wear quotation marks of its own.
    ...(input.observed
      ? [
          "Their phone read their photographs as the following. It is a machine's description " +
            "of a picture, not something they said — take what is plainly IN it and nothing " +
            `it implies:\n"""\n${input.observed}\n"""\n` +
            'If a clause there begins "Words I can read in them:" or "the words I can read:", ' +
            "everything quoted in THAT clause was read off the photograph itself by a text " +
            "recogniser — a book spine, a label, a stamp — so it is what the object SAYS. " +
            "Treat those as reliably present, and every other part of the reading as an " +
            "impression that may be wrong. Seeing a title on a shelf is evidence they own " +
            "that book, not that they have read it or liked it.",
        ]
      : []),
  ].join("\n\n");
}

export interface NewFactForReconcile {
  type: string;
  fact: string;
  validAt: Date | null;
  invalidAt: Date | null;
}

/** "true since 2026-03, until 2026-09": a fact's own dates, when it has any. */
const when = (fact: { validAt: Date | null; invalidAt: Date | null }): string =>
  [fact.validAt ? `true since ${dayOf(fact.validAt)}` : null, fact.invalidAt ? `until ${dayOf(fact.invalidAt)}` : null].filter(Boolean).join(", ");

/** A current fact as the reconcile and next calls list it: `- id | type | fact | dates`. */
const factLine = (fact: Fact): string => {
  const dates = [when(fact), `told us ${dayOf(fact.createdAt)}`].filter(Boolean).join("; ");
  return `- ${fact.id} | ${fact.type} | ${fact.fact} | ${dates}`;
};

export function reconcileInput(
  vocabulary: Vocabulary,
  input: {
    entity: { name: string; fields: Readonly<Record<string, string | null>> };
    referenceAt: Date;
    current: Fact[];
    incoming: NewFactForReconcile[];
    summary: string;
  },
): string {
  const current = input.current.length === 0 ? "(nothing yet)" : input.current.map(factLine).join("\n");
  const incoming = input.incoming
    .map((fact, index) => {
      const dates = when(fact);
      return `- ${index} | ${fact.type} | ${fact.fact}${dates ? ` | ${dates}` : ""}`;
    })
    .join("\n");
  return [
    `About this ${vocabulary.kind}: ${whoLabel(vocabulary, input.entity)}`,
    `Today (when the new facts were said): ${dayOf(input.referenceAt)}`,
    `Current facts (id | type | fact | dates):\n${current}`,
    `New facts (index | type | fact | dates):\n${incoming}`,
    `Current summary:\n"""\n${input.summary || "(none yet)"}\n"""`,
  ].join("\n\n");
}

/**
 * What the `next` call is shown about one entity: what was just learned, the
 * rest of what is known, the knower's facts where the vocabulary has a
 * relationship dimension, the directions already open (a lapsed one marked,
 * so the model may withdraw it) and how much room each dimension has left.
 * The first line is its own, so a test model can tell the call apart.
 */
export function nextInput(
  vocabulary: Vocabulary,
  input: {
    entity: { name: string; fields: Readonly<Record<string, string | null>> };
    /** When this was learned: the note's date, or now for an entity just added. */
    referenceAt: Date;
    /** The entity's current facts. */
    facts: Fact[];
    /** The knower's current facts. */
    knower: Fact[];
    /** The facts this note added or retold, by id; empty when the entity was just added. */
    learned: readonly string[];
    /** The entity's directions; only the open ones are shown. */
    directions: ProposedDirection[];
    perDimension: number;
    lapseAfterDays: number;
  },
): string {
  const learned = new Set(input.learned);
  const just = input.facts.filter((fact) => learned.has(fact.id));
  const rest = input.facts.filter((fact) => !learned.has(fact.id));
  const open = input.directions.filter((direction) => direction.status === "open");
  const live = new Set(open.filter((direction) => !isLapsed(direction, input.lapseAfterDays, input.referenceAt)));
  const nothingYet = input.facts.length === 0 && input.learned.length === 0;
  const sections = [
    `Directions for this ${vocabulary.kind}: ${whoLabel(vocabulary, input.entity)}`,
    `Today (when this was learned): ${dayOf(input.referenceAt)}`,
    `Just learned (id | type | fact | dates):\n${just.length > 0 ? just.map(factLine).join("\n") : nothingYet ? "(nothing yet: this entry was just added)" : "(nothing new)"}`,
    `Also known (id | type | fact | dates):\n${rest.length > 0 ? rest.map(factLine).join("\n") : "(nothing else)"}`,
  ];
  if (input.knower.length > 0 && vocabulary.dimensions.some((dimension) => dimension.about === "relationship")) {
    sections.push(`About the writer (id | type | fact | dates):\n${input.knower.map(factLine).join("\n")}`);
  }
  const directions = open.map((direction) => {
    const from = direction.factIds.length > 0 ? direction.factIds.join(", ") : "nothing";
    return `- ${direction.id} | ${direction.dimension} | ${direction.label} | ${from}${live.has(direction) ? "" : " (lapsed)"}`;
  });
  const room = vocabulary.dimensions
    .filter((dimension) => dimension.about !== "knower")
    .map((dimension) => {
      const now = [...live].filter((direction) => direction.dimension === dimension.id).length;
      return `- ${dimension.id} | ${now} | ${Math.max(0, input.perDimension - now)}`;
    });
  sections.push(
    `Open directions (id | dimension | label | grew from):\n${directions.length > 0 ? directions.join("\n") : "(none yet)"}`,
    `Room for new directions (dimension | open now | room left):\n${room.join("\n")}`,
  );
  return sections.join("\n\n");
}

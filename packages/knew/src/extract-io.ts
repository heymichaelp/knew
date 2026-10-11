import { dayOf } from "./dates.ts";
import type { Fact, RosterEntry } from "./types.ts";
import { KNOWER_ID, whoLabel, type Vocabulary } from "./vocabulary.ts";

/**
 * What the two model calls are shown — pure, so what the model sees is
 * testable without a model. The vocabulary supplies its kind, the source
 * labels and which of an entity's fields are shown beside its name;
 * everything else is the engine's one wording, and names no domain.
 */

/** The fields shown beside an entry's name: the vocabulary's prompt fields that have a value. */
function fieldsShown(vocabulary: Vocabulary, entry: RosterEntry): Array<[string, string]> {
  return vocabulary.promptFields.flatMap((field) => {
    const value = entry.fields[field];
    return typeof value === "string" && value.trim() !== "" ? [[field, value] as [string, string]] : [];
  });
}

/**
 * What a prompt section can wait for: `reply`, a question being answered; `fields`, a field
 * shown beside a name on the list. A prompt marks such a section on lines of its own:
 *
 *     <!-- if: reply -->
 *     ## Answers to a question
 *     …
 *     <!-- end if -->
 */
export interface PromptConditions {
  reply: boolean;
  fields: boolean;
}

/** What an extract input gives the prompt to act on. */
export function conditionsOf(vocabulary: Vocabulary, input: { inReplyTo?: string | null; roster: RosterEntry[] }): PromptConditions {
  return {
    reply: Boolean(input.inReplyTo),
    fields: input.roster.some((entry) => entry.id !== KNOWER_ID && fieldsShown(vocabulary, entry).length > 0),
  };
}

const SECTION = /<!-- if: (\w+) -->\n([\s\S]*?)<!-- end if -->\n?(\n?)/g;

/**
 * A prompt without the sections that have nothing to act on: a model reads only what applies to
 * this input, which matters most where the window is small. A prompt with no marked sections
 * comes back as it is, and a section waiting for a condition the engine does not know is kept.
 */
export function promptFor(text: string, when: PromptConditions): string {
  if (!text.includes("<!-- if: ")) return text;
  return text
    .replace(SECTION, (_, name: string, body: string, gap: string) =>
      name in when && !when[name as keyof PromptConditions] ? "" : `${body}${gap}`,
    )
    .replace(/\n+$/, "\n");
}

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
            const parts = [`id: ${entry.id}`, `name: ${entry.name}`, ...fieldsShown(vocabulary, entry).map(([field, value]) => `${field}: ${value}`)];
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

/**
 * How reconcile names a current fact: `f1`, `f2`, … in the order listed. A stored id is 36
 * characters and many tokens, and is listed once per fact on every reconcile, so the list that
 * grows with what is known stays as short as it can.
 */
export const factHandle = (index: number) => `f${index + 1}`;

/**
 * Reconcile's decisions with each handle it cited turned back into the fact's id, against the
 * same `current` the input listed. Anything else is left as the model wrote it, for the plan to
 * report as an id it was never shown.
 */
export function resolveFactHandles<T extends { factId: string | null }>(decisions: T[], current: ReadonlyArray<{ id: string }>): T[] {
  return decisions.map((decision) => {
    const match = /^f(\d+)$/.exec(decision.factId?.trim() ?? "");
    const fact = match ? current[Number(match[1]) - 1] : undefined;
    return fact ? { ...decision, factId: fact.id } : decision;
  });
}

export interface NewFactForReconcile {
  type: string;
  fact: string;
  validAt: Date | null;
  invalidAt: Date | null;
}

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
  const when = (fact: { validAt: Date | null; invalidAt: Date | null }) =>
    [fact.validAt ? `true since ${dayOf(fact.validAt)}` : null, fact.invalidAt ? `until ${dayOf(fact.invalidAt)}` : null]
      .filter(Boolean)
      .join(", ");
  const current =
    input.current.length === 0
      ? "(nothing yet)"
      : input.current
          .map((fact, index) => {
            const dates = [when(fact), `told us ${dayOf(fact.createdAt)}`].filter(Boolean).join("; ");
            return `- ${factHandle(index)} | ${fact.type} | ${fact.fact} | ${dates}`;
          })
          .join("\n");
  const incoming = input.incoming
    .map((fact, index) => {
      const dates = when(fact);
      return `- ${index} | ${fact.type} | ${fact.fact}${dates ? ` | ${dates}` : ""}`;
    })
    .join("\n");
  return [
    `About this ${vocabulary.kind}: ${whoLabel(vocabulary, input.entity)}`,
    `Today (when the new facts were said): ${dayOf(input.referenceAt)}`,
    `Current facts (factId | type | fact | dates):\n${current}`,
    `New facts (index | type | fact | dates):\n${incoming}`,
    `Current summary:\n"""\n${input.summary || "(none yet)"}\n"""`,
  ].join("\n\n");
}

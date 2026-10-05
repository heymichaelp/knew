import { dayOf, monthOf } from "./dates.ts";
import { briefHeader, factType, isPinnedFactType, type Lens } from "./lens.ts";
import type { Fact, MustHonor } from "./types.ts";

/**
 * The brief: everything we know about one person, as the page a reader
 * starts from in place of a one-paragraph note.
 *
 * PURE rendering. Dates are rendered and nothing is weighted: whether a
 * two-year-old interest still counts is the reader's judgment, made from the
 * dates in front of it. The headings, the header and which attributes show
 * come from the lens.
 */

/** Default page size: what fits a reader's context beside its own material. */
export const BRIEF_MAX_CHARS = 3_500;

const TRAILER_RESERVE = 48;

/** "- Vegan (since 2025-03; told us 2026-03-02)". */
export function factLine(lens: Lens, fact: Fact): string {
  const when: string[] = [];
  if (fact.validAt) when.push(`since ${monthOf(fact.validAt)}`);
  if (fact.invalidAt) when.push(`until ${monthOf(fact.invalidAt)}`);
  const said = fact.episodeIds.length > 1 ? `told us ${fact.episodeIds.length} times, first` : "told us";
  when.push(`${said} ${dayOf(fact.createdAt)}`);
  const tags = lens.briefAttributeTags
    .map((name) => fact.attributes[name])
    .filter((value): value is string => typeof value === "string" && value !== "")
    .map((value) => ` [${value}]`)
    .join("");
  return `- ${fact.fact}${tags} (${when.join("; ")})`;
}

export interface BriefInput {
  person: { name: string; fields: Record<string, string | null> };
  /** The living profile; "" when there is none (or for an as-of brief). */
  summary: string;
  facts: Fact[];
  maxChars?: number;
  /** The moment the page describes; default now. A fact whose end date
   *  (`invalidAt`) has passed by then is over, even if nobody said so. */
  at?: Date;
}

/** Whether a believed fact is over by `at` because its own end date passed:
 *  "six months in Lisbon from May" is not true in December, whether or not
 *  anybody mentions coming home. */
export function endedByDate(fact: Fact, at: Date): boolean {
  return fact.invalidAt != null && fact.invalidAt.getTime() <= at.getTime();
}

/**
 * Render the page, or null when there is nothing to say — the caller then
 * falls back to its own note.
 *
 * What survives a tight budget, in order: the pinned facts (the things the
 * reader must honor), then everything else newest first. What is printed is
 * then laid out by section, so the page reads in the order the lens says to
 * weigh it.
 */
export function renderBrief(lens: Lens, input: BriefInput): string | null {
  const summary = input.summary.trim();
  if (summary === "" && input.facts.length === 0) return null;
  const maxChars = input.maxChars ?? BRIEF_MAX_CHARS;
  const at = input.at ?? new Date();
  // Facts past their own end date leave the sections — printed among what is
  // true, a reader took "in Lisbon (until 2026-11)" as a current fact — and
  // are listed last, as context, only if there is room.
  const over = input.facts.filter((fact) => endedByDate(fact, at));
  const facts = input.facts.filter((fact) => !endedByDate(fact, at));

  const header = briefHeader(lens, input.person);
  const opening = summary ? `${header}\n\n${summary.slice(0, Math.floor(maxChars / 2))}` : header;

  const sectionOf = (fact: Fact): string => factType(lens, fact.type).section;
  const pinned = (fact: Fact): boolean => isPinnedFactType(lens, fact.type);
  const newestFirst = (a: Fact, b: Fact) =>
    b.createdAt.getTime() - a.createdAt.getTime() || a.id.localeCompare(b.id);
  const line = (fact: Fact) => factLine(lens, fact);

  const priority = [
    ...facts.filter(pinned).sort(newestFirst),
    ...facts.filter((fact) => !pinned(fact)).sort(newestFirst),
    ...over.sort(newestFirst),
  ];

  // Choose what fits. Section headings are counted as if every section will
  // appear, which over-reserves slightly and never overflows.
  const headingCost =
    lens.briefSections.reduce((sum, s) => sum + s.heading.length + 3, 0) +
    (over.length > 0 ? lens.overHeading.length + 3 : 0);
  let budget = maxChars - opening.length - headingCost - TRAILER_RESERVE;
  const chosen = new Set<string>();
  for (const fact of priority) {
    const cost = line(fact).length + 1;
    if (cost > budget) continue;
    chosen.add(fact.id);
    budget -= cost;
  }

  const blocks = [opening];
  for (const { section, heading } of lens.briefSections) {
    const lines = facts
      .filter((fact) => chosen.has(fact.id) && sectionOf(fact) === section)
      .sort(newestFirst)
      .map(line);
    if (lines.length > 0) blocks.push(`${heading}:\n${lines.join("\n")}`);
  }
  const overLines = over.filter((fact) => chosen.has(fact.id)).sort(newestFirst).map(line);
  if (overLines.length > 0) blocks.push(`${lens.overHeading}:\n${overLines.join("\n")}`);
  const left = input.facts.length - chosen.size;
  if (left > 0) blocks.push(`(+${left} older fact${left === 1 ? "" : "s"} not shown)`);
  return blocks.join("\n\n");
}

/** The pinned facts among what is believed at `at`: what a reader must honor
 *  rather than weigh. */
export function mustHonorFrom(lens: Lens, facts: Fact[], at: Date = new Date()): MustHonor[] {
  return facts
    .filter((fact) => isPinnedFactType(lens, fact.type) && !endedByDate(fact, at))
    .map((fact) => ({ type: fact.type, fact: fact.fact }));
}

/**
 * A fact as it looked at T. A fact retired AFTER T was, at T, still believed
 * current — and the end date its retirement wrote (`invalidAt`) was learned
 * afterwards, so it is withheld. Without this an as-of brief printed "wants a
 * pottery wheel (until 2025-09)" for a June in which nobody knew she would buy
 * one.
 *
 * The one case it over-corrects: a fact that ARRIVED with an end date ("lived
 * in Austin until 2024") and was later retired too loses that date in views
 * before the retirement. Rare, and the safe direction — a missing date never
 * claims knowledge nobody had.
 */
export function asKnownAt(fact: Fact, asOf?: Date): Fact {
  if (!asOf || !fact.expiredAt || fact.expiredAt <= asOf) return fact;
  return { ...fact, invalidAt: null, expiredAt: null, supersededById: null };
}

/** "Believed at T" over facts in hand: said by then, and not yet retracted by
 *  then. Without T: believed now. The pure twin of the driver's WHERE. */
export function factsKnownAt(facts: Fact[], asOf?: Date): Fact[] {
  const known = asOf
    ? facts.filter((f) => f.createdAt <= asOf && (!f.expiredAt || f.expiredAt > asOf))
    : facts.filter((f) => !f.expiredAt);
  return known.map((f) => asKnownAt(f, asOf));
}

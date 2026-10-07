import type { RunRecord } from "./report.ts";

/**
 * Everything a pass heard about the package, grouped by what it is about and
 * ranked by how many runs raised it. One run complaining is noise; the same
 * thing from three runs, or from two briefs, is a finding.
 *
 * Each item says what backs it, strongest first:
 *   behaviour   what the agent did: an error the package raised, a struggle, the implementation opened
 *   aside       what it said mid-task, unprompted
 *   interview   its answer about a numbered moment of its own session
 *   note        a line of its think-aloud log
 *   recall      a debrief answer from memory, after the fact
 *   suggestion  the change it would make
 *
 * Grouping is deterministic, with no model: an error by its message with the
 * names in it blanked out; anything else by the first package name or package
 * file it mentions (an interview answer that mentions none takes its moment's);
 * and what is left by the overlap of its words.
 */

export type Backing = "behaviour" | "aside" | "interview" | "note" | "recall" | "suggestion";

export interface FindingItem {
  run: string;
  brief: string;
  backing: Backing;
  /** The step it happened at, when it is tied to one. */
  step: number | null;
  text: string;
}

export interface Finding {
  /** What it is about: an error, a name or file of the package, or the words of its first item. */
  about: string;
  runs: string[];
  briefs: string[];
  items: FindingItem[];
}

const WEIGHT: Record<Backing, number> = { behaviour: 3, aside: 2, interview: 2, note: 2, recall: 1, suggestion: 1 };

/** Names too ordinary to say what a complaint is about. */
const TOO_COMMON = new Set(["id", "name", "version", "type", "kind", "fields", "description"]);

const escaped = (name: string) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The package names and files a text mentions, in the order it mentions them.
 * A distinctive name (`readinessFor`, `ENGINE_DEFAULTS`) counts anywhere; an
 * ordinary word (`enough`, `after`) only as code, in backticks.
 */
export function anchorsOf(text: string, names: ReadonlySet<string>): string[] {
  const found: Array<{ at: number; anchor: string }> = [];
  const code = [...text.matchAll(/`([^`\n]+)`/g)].map((match) => ({ at: match.index, span: match[1]! }));
  for (const name of names) {
    if (TOO_COMMON.has(name)) continue;
    const word = new RegExp(`(?<![\\w$])${escaped(name)}(?![\\w$])`);
    if (/[A-Z0-9_$]/.test(name)) {
      const match = word.exec(text);
      if (match) found.push({ at: match.index, anchor: `\`${name}\`` });
    } else {
      const span = code.find((candidate) => word.test(candidate.span));
      if (span) found.push({ at: span.at, anchor: `\`${name}\`` });
    }
  }
  for (const match of text.matchAll(/\b(?:dist\/[\w./-]+\.(?:js|d\.ts)|README\.md|ADOPTING\.md|CHANGELOG\.md)\b/g)) found.push({ at: match.index, anchor: match[0] });
  return [...new Map(found.sort((a, b) => a.at - b.at).map((item) => [item.anchor, item])).keys()];
}

/** An error's message with the parts that differ from app to app — lens ids, type keys, numbers — blanked out. */
export const errorKey = (message: string) =>
  message
    .replace(/lens [\w-]+@\d+/g, "lens …")
    .replace(/\b[A-Z][A-Z0-9_]+\b/g, "…")
    .replace(/\d+/g, "…")
    .slice(0, 200);

const STOP = new Set(
  "that this with from have would what when which about there their into more does didn't wasn't were been being could should they them then than also just only some each very like make made need needed know knew package".split(" "),
);
const wordsOf = (text: string) => new Set((text.toLowerCase().match(/[a-z']{4,}/g) ?? []).filter((word) => !STOP.has(word)));
const overlap = (a: Set<string>, b: Set<string>) => {
  const shared = [...a].filter((word) => b.has(word)).length;
  return shared / (a.size + b.size - shared || 1);
};

interface Keyed extends FindingItem {
  key: string | null;
}

function itemsOf(record: RunRecord, names: ReadonlySet<string>): Keyed[] {
  const run = `${record.identity.brief}#${record.identity.run}`;
  const brief = record.identity.brief;
  const items: Keyed[] = [];
  const add = (backing: Backing, text: string, step: number | null, key: string | null) => items.push({ run, brief, backing, step, text, key });
  const anchored = (text: string, fallback: string[] = []) => anchorsOf(text, names)[0] ?? fallback[0] ?? null;
  const evidenceKeys = (evidence: readonly string[]) => {
    const error = evidence.find((line) => line.startsWith("package error: "));
    return error ? [`error: ${errorKey(error.slice("package error: ".length))}`] : evidence.flatMap((line) => anchorsOf(line, names));
  };

  for (const error of record.metrics.packageErrors) add("behaviour", `raised ${error.count}×: ${error.message}`, null, `error: ${errorKey(error.message)}`);
  for (const moment of record.moments ?? []) {
    const text = moment.evidence.length ? `${moment.what} — ${moment.evidence.join("; ")}` : moment.what;
    add(moment.kind === "aside" ? "aside" : "behaviour", text, moment.step, moment.kind === "aside" ? anchored(moment.what) : (evidenceKeys(moment.evidence)[0] ?? null));
  }
  for (const answer of record.debrief?.moments ?? []) {
    if (/^nothing\.?$/i.test(answer.confusion.trim())) continue;
    const text = `asked about ${answer.asked}: ${answer.confusion} — would have helped: ${answer.wouldHaveHelped}`;
    add("interview", text, answer.step, anchored(`${answer.confusion} ${answer.wouldHaveHelped}`, evidenceKeys(answer.evidence)));
  }
  for (const note of record.notes ?? []) add("note", note.text, note.step, anchored(note.text));
  for (const quote of record.debrief?.unhelpfulErrors ?? []) add("recall", `unhelpful error “${quote.message}” — ${quote.wouldHaveHelped}`, null, `error: ${errorKey(quote.message)}`);
  for (const [label, lines] of [
    ["had to guess", record.debrief?.guessed ?? []],
    ["missing from the docs", record.debrief?.missingFromDocs ?? []],
    ["API friction", record.debrief?.apiFriction ?? []],
  ] as const) {
    for (const line of lines) add("recall", `${label}: ${line}`, null, anchored(line));
  }
  if (record.debrief?.wouldChange) add("suggestion", record.debrief.wouldChange, null, anchored(record.debrief.wouldChange));
  return items;
}

/** Findings across a pass, the most widely raised first; runs that measured something else are left out. */
export function findingsOf(records: readonly RunRecord[], names: ReadonlySet<string>): Finding[] {
  const keyed = records.filter((record) => record.outcome !== "infra" && record.outcome !== "contaminated").flatMap((record) => itemsOf(record, names));
  const groups = new Map<string, FindingItem[]>();
  const loose: Array<{ words: Set<string>; items: FindingItem[] }> = [];
  for (const { key, ...item } of keyed) {
    if (key) {
      groups.set(key, [...(groups.get(key) ?? []), item]);
      continue;
    }
    const words = wordsOf(item.text);
    const near = loose.find((group) => overlap(group.words, words) >= 0.35);
    if (near) {
      near.items.push(item);
      for (const word of words) near.words.add(word);
    } else {
      loose.push({ words, items: [item] });
    }
  }
  const findings: Finding[] = [
    ...[...groups.entries()].map(([key, items]) => ({ about: key, items })),
    ...loose.map((group) => ({ about: group.items[0]!.text.slice(0, 80), items: group.items })),
  ].map(({ about, items }) => ({
    about,
    runs: [...new Set(items.map((item) => item.run))].sort(),
    briefs: [...new Set(items.map((item) => item.brief))].sort(),
    items: [...items].sort((a, b) => WEIGHT[b.backing] - WEIGHT[a.backing] || a.run.localeCompare(b.run) || (a.step ?? 0) - (b.step ?? 0)),
  }));
  const weight = (finding: Finding) => finding.items.reduce((sum, item) => sum + WEIGHT[item.backing], 0);
  const backed = (finding: Finding) => (finding.items.some((item) => item.backing === "behaviour") ? 1 : 0);
  return findings.sort((a, b) => b.runs.length - a.runs.length || b.briefs.length - a.briefs.length || backed(b) - backed(a) || weight(b) - weight(a) || a.about.localeCompare(b.about));
}

/** The findings as markdown, for `summary.md`. */
export function findingsMarkdown(findings: readonly Finding[]): string[] {
  if (findings.length === 0) return ["None recorded."];
  return findings.flatMap((finding) => [
    `### ${finding.about} — ${finding.runs.length} run${finding.runs.length === 1 ? "" : "s"}${finding.briefs.length > 1 ? `, ${finding.briefs.length} briefs` : ""}`,
    "",
    ...finding.items.map((item) => `- ${item.backing} · ${item.run}${item.step === null ? "" : `, step ${item.step}`}: ${item.text}`),
    "",
  ]);
}

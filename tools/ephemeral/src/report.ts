import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CheckResult } from "../kit/check-kit.ts";
import { findingsMarkdown, type Finding } from "./findings.ts";
import type { Outcome, RunMetrics, SourceMetrics } from "./metrics.ts";
import type { Moment, Note } from "./moments.ts";
import type { Transcript } from "./transcript.ts";

/**
 * What a run leaves behind: `result.json` (identity, outcome, effort,
 * friction, the moments found and the think-aloud notes), `check.json`,
 * `debrief.json`, `transcript.jsonl` and `tree.tgz` (the app, minus
 * node_modules), per run; and one `summary.md` and `findings.json` per pass.
 */

export interface Identity {
  brief: string;
  briefVersion: number;
  briefHash: string;
  run: number;
  model: string;
  effort: string | null;
  cliVersion: string;
  tarballSha256: string;
  gitSha: string;
  dirty: boolean;
  promptHash: string;
  zodVersion: string | null;
  /** Whether the agent kept a think-aloud log, which changes how it works and so what its effort means. */
  thinkAloud: boolean;
}

/** The debrief's answer about one numbered moment of the session, with the moment it was asked about. */
export interface MomentAnswer {
  moment: number;
  step: number;
  asked: string;
  evidence: string[];
  wasDoing: string;
  confusion: string;
  wouldHaveHelped: string;
}

export interface Debrief {
  guessed: string[];
  unhelpfulErrors: Array<{ message: string; wouldHaveHelped: string }>;
  missingFromDocs: string[];
  apiFriction: string[];
  wouldChange: string;
  moments: MomentAnswer[];
  /** Quoted errors dropped because their text appears in no tool result. */
  unverifiedQuotes: number;
  /** Answers about a moment that was never asked about, dropped. */
  unaskedAnswers: number;
}

export interface RunRecord {
  identity: Identity;
  outcome: Outcome;
  reason: string;
  timedOut: boolean;
  budgetHit: boolean;
  durationMs: number;
  metrics: RunMetrics;
  source: SourceMetrics | null;
  isolation: string[];
  contamination: string[];
  check: CheckResult;
  /** Every moment found in the session; the debrief asked about `asked` of them. */
  moments: Moment[];
  asked: Moment[];
  /** The think-aloud log, in think-aloud mode. */
  notes: Note[] | null;
  debrief: Debrief | null;
}

/**
 * Keep a quoted error only if its text is in what the tools actually printed,
 * and an answer about a moment only if that moment was asked about:
 * self-reports get invented.
 */
export function verifyDebrief(raw: unknown, transcript: Transcript, asked: readonly Moment[] = []): Debrief | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Partial<Omit<Debrief, "unverifiedQuotes" | "unaskedAnswers" | "moments">> & { moments?: unknown };
  const printed = transcript.toolResults.map((result) => result.text).join("\n");
  const quotes = Array.isArray(value.unhelpfulErrors) ? value.unhelpfulErrors : [];
  const kept = quotes.filter((quote) => typeof quote?.message === "string" && quote.message.trim() !== "" && printed.includes(quote.message.trim()));
  const list = (items: unknown) => (Array.isArray(items) ? items.filter((item): item is string => typeof item === "string") : []);
  const answers = Array.isArray(value.moments) ? (value.moments as Array<Partial<Record<keyof MomentAnswer, unknown>>>) : [];
  const text = (field: unknown) => (typeof field === "string" ? field : "");
  const moments = answers.flatMap((answer): MomentAnswer[] => {
    const moment = typeof answer?.moment === "number" ? asked[answer.moment - 1] : undefined;
    if (!moment) return [];
    return [
      {
        moment: answer.moment as number,
        step: moment.step,
        asked: moment.what,
        evidence: moment.evidence,
        wasDoing: text(answer.wasDoing),
        confusion: text(answer.confusion),
        wouldHaveHelped: text(answer.wouldHaveHelped),
      },
    ];
  });
  return {
    guessed: list(value.guessed),
    unhelpfulErrors: kept,
    missingFromDocs: list(value.missingFromDocs),
    apiFriction: list(value.apiFriction),
    wouldChange: typeof value.wouldChange === "string" ? value.wouldChange : "",
    moments,
    unverifiedQuotes: quotes.length - kept.length,
    unaskedAnswers: answers.length - moments.length,
  };
}

export function writeRun(dir: string, record: RunRecord): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "result.json"), `${JSON.stringify(record, null, 2)}\n`);
  writeFileSync(join(dir, "check.json"), `${JSON.stringify(record.check, null, 2)}\n`);
  writeFileSync(join(dir, "debrief.json"), `${JSON.stringify(record.debrief, null, 2)}\n`);
}

/** The app the agent left, minus what was installed, for reading after the directory is gone. */
export function archiveTree(runDir: string, into: string): boolean {
  const result = spawnSync("tar", ["czf", join(into, "tree.tgz"), "--exclude=./node_modules", "--exclude=./vendor", "--exclude=./.check", "-C", runDir, "."], {
    encoding: "utf8",
  });
  return result.status === 0;
}

const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
};

const money = (value: number | null) => (value === null ? "—" : `$${value.toFixed(2)}`);
const minutes = (ms: number | null) => (ms === null ? "—" : `${(ms / 60_000).toFixed(1)} min`);

export interface BriefSummary {
  brief: string;
  version: number;
  scored: number;
  passed: number;
  outcomes: Partial<Record<Outcome, number>>;
  medianCost: number | null;
  medianTurns: number | null;
  medianDuration: number | null;
}

/** Per brief: pass k of N among the runs that measured the package (infra and contaminated runs do not), and the medians. */
export function summarize(records: readonly RunRecord[]): BriefSummary[] {
  const byBrief = new Map<string, RunRecord[]>();
  for (const record of records) byBrief.set(record.identity.brief, [...(byBrief.get(record.identity.brief) ?? []), record]);
  return [...byBrief.entries()].map(([brief, runs]) => {
    const scored = runs.filter((run) => run.outcome !== "infra" && run.outcome !== "contaminated");
    const outcomes: Partial<Record<Outcome, number>> = {};
    for (const run of runs) outcomes[run.outcome] = (outcomes[run.outcome] ?? 0) + 1;
    return {
      brief,
      version: runs[0]!.identity.briefVersion,
      scored: scored.length,
      passed: scored.filter((run) => run.outcome === "pass").length,
      outcomes,
      medianCost: median(scored.map((run) => run.metrics.costUsd).filter((cost): cost is number => cost !== null)),
      medianTurns: median(scored.map((run) => run.metrics.turns).filter((turns): turns is number => turns !== null)),
      medianDuration: median(scored.map((run) => run.durationMs)),
    };
  });
}

export function summaryMarkdown(
  records: readonly RunRecord[],
  header: { stamp: string; gitSha: string; dirty: boolean; model: string; thinkAloud: boolean },
  findings: readonly Finding[],
): string {
  const rows = summarize(records).map(
    (s) =>
      `| ${s.brief} | v${s.version} | ${s.passed}/${s.scored} | ${Object.entries(s.outcomes).map(([o, n]) => `${o} ${n}`).join(", ")} | ${money(s.medianCost)} | ${s.medianTurns ?? "—"} | ${minutes(s.medianDuration)} |`,
  );
  const disqualified = records.filter((r) => r.outcome === "infra" || r.outcome === "contaminated");
  return [
    `# Ephemeral testing — ${header.stamp}`,
    "",
    `Commit \`${header.gitSha.slice(0, 8)}\`${header.dirty ? " (with uncommitted changes)" : ""}, builder \`${header.model}\`. Cost is the CLI's API-rate estimate.` +
      (header.thinkAloud ? " Think-aloud was on: the agents kept notes as they worked, so effort is not comparable with a plain pass." : ""),
    "",
    "| Brief | Version | Passed | Outcomes | Median cost | Median turns | Median time |",
    "|---|---|---|---|---|---|---|",
    ...rows,
    "",
    "## Findings",
    "",
    "Grouped by what they are about, the most widely raised first. Each item says what backs it: behaviour (what the agent did),",
    "an aside (what it said mid-task), an interview answer about a numbered moment, a think-aloud note, or recall and suggestions",
    "from the debrief, strongest first.",
    "",
    ...findingsMarkdown(findings),
    "",
    "## Runs that measured something else",
    "",
    ...(disqualified.length > 0 ? disqualified.map((r) => `- ${r.identity.brief}#${r.identity.run}: ${r.outcome} — ${r.reason}`) : ["None."]),
    "",
  ].join("\n");
}

export function printTable(records: readonly RunRecord[]): void {
  for (const s of summarize(records)) {
    const outcomes = Object.entries(s.outcomes).map(([o, n]) => `${o} ${n}`).join(", ");
    process.stdout.write(`${s.brief.padEnd(10)} passed ${s.passed}/${s.scored}  ${outcomes.padEnd(28)} ${money(s.medianCost).padStart(7)}  ${String(s.medianTurns ?? "—").padStart(4)} turns  ${minutes(s.medianDuration)}\n`);
  }
}

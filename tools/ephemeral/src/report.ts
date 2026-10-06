import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CheckResult } from "../kit/check-kit.ts";
import type { Outcome, RunMetrics, SourceMetrics } from "./metrics.ts";
import type { Transcript } from "./transcript.ts";

/**
 * What a run leaves behind: `result.json` (identity, outcome, effort,
 * friction), `check.json`, `debrief.json`, `transcript.jsonl` and `tree.tgz`
 * (the app, minus node_modules), per run; and one `summary.md` per pass.
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
}

export interface Debrief {
  guessed: string[];
  unhelpfulErrors: Array<{ message: string; wouldHaveHelped: string }>;
  missingFromDocs: string[];
  apiFriction: string[];
  wouldChange: string;
  /** Quoted errors dropped because their text appears in no tool result. */
  unverifiedQuotes: number;
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
  debrief: Debrief | null;
}

/** Keep a quoted error only if its text is in what the tools actually printed: self-reports get invented. */
export function verifyDebrief(raw: unknown, transcript: Transcript): Debrief | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Partial<Omit<Debrief, "unverifiedQuotes">>;
  const printed = transcript.toolResults.map((result) => result.text).join("\n");
  const quotes = Array.isArray(value.unhelpfulErrors) ? value.unhelpfulErrors : [];
  const kept = quotes.filter((quote) => typeof quote?.message === "string" && quote.message.trim() !== "" && printed.includes(quote.message.trim()));
  const list = (items: unknown) => (Array.isArray(items) ? items.filter((item): item is string => typeof item === "string") : []);
  return {
    guessed: list(value.guessed),
    unhelpfulErrors: kept,
    missingFromDocs: list(value.missingFromDocs),
    apiFriction: list(value.apiFriction),
    wouldChange: typeof value.wouldChange === "string" ? value.wouldChange : "",
    unverifiedQuotes: quotes.length - kept.length,
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

/** Friction across runs: each package error and each debrief line, with how many runs met it. */
function frictionLines(records: readonly RunRecord[]): string[] {
  const tally = new Map<string, Set<string>>();
  const note = (kind: string, text: string, record: RunRecord) => {
    const key = `${kind}: ${text}`;
    tally.set(key, (tally.get(key) ?? new Set()).add(`${record.identity.brief}#${record.identity.run}`));
  };
  for (const record of records) {
    for (const error of record.metrics.packageErrors) note("error from the package", error.message, record);
    if (record.metrics.readImplementation) note("read the compiled implementation", "dist/*.js", record);
    for (const line of record.debrief?.missingFromDocs ?? []) note("missing from the docs", line, record);
    for (const line of record.debrief?.guessed ?? []) note("had to guess", line, record);
    for (const line of record.debrief?.apiFriction ?? []) note("API friction", line, record);
    for (const quote of record.debrief?.unhelpfulErrors ?? []) note("unhelpful error", `${quote.message} — ${quote.wouldHaveHelped}`, record);
  }
  return [...tally.entries()]
    .sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))
    .map(([line, runs]) => `- (${runs.size} run${runs.size === 1 ? "" : "s"}: ${[...runs].join(", ")}) ${line}`);
}

export function summaryMarkdown(records: readonly RunRecord[], header: { stamp: string; gitSha: string; dirty: boolean; model: string }): string {
  const rows = summarize(records).map(
    (s) =>
      `| ${s.brief} | v${s.version} | ${s.passed}/${s.scored} | ${Object.entries(s.outcomes).map(([o, n]) => `${o} ${n}`).join(", ")} | ${money(s.medianCost)} | ${s.medianTurns ?? "—"} | ${minutes(s.medianDuration)} |`,
  );
  const disqualified = records.filter((r) => r.outcome === "infra" || r.outcome === "contaminated");
  return [
    `# Ephemeral testing — ${header.stamp}`,
    "",
    `Commit \`${header.gitSha.slice(0, 8)}\`${header.dirty ? " (with uncommitted changes)" : ""}, builder \`${header.model}\`. Cost is the CLI's API-rate estimate.`,
    "",
    "| Brief | Version | Passed | Outcomes | Median cost | Median turns | Median time |",
    "|---|---|---|---|---|---|---|",
    ...rows,
    "",
    "## Friction",
    "",
    ...(frictionLines(records).length > 0 ? frictionLines(records) : ["None recorded."]),
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

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { BRIEFS, type Arm } from "./prep.ts";

/**
 * A brief is a product story (`BRIEF.md`), what the checker pins (`brief.json`),
 * the hidden checker (`check.ts`) and a known-good solution (`reference/`).
 * `brief.json` carries the brief's version, recorded on every result, so a
 * trend is only ever drawn across runs of the same brief.
 */

const briefSchema = z.object({
  /** Bumped whenever the brief, its checker or its inputs change. */
  version: z.number().int().min(1),
  /** One line: what the brief exercises. */
  exercises: z.string().min(1),
  /** Ids a product spec would name anyway, so the checker may rely on them. */
  pinned: z.object({
    vocabulary: z.string(),
    lenses: z.array(z.string()).min(1),
    types: z.array(z.string()),
  }),
  /** Dollar cap on the build, and its wall clock in minutes. */
  budgetUsd: z.number().positive(),
  timeoutMin: z.number().positive(),
  /** Files or directories under the brief laid into the run beside BRIEF.md. */
  inputs: z.array(z.string()),
  /** Package names this brief may say as code anyway: words its product needs that happen to be the package's too. */
  allow: z.array(z.string()),
  /** For a brief with a `CHANGE.md`: the ids the change adds, which its checker relies on after it. */
  change: z.object({ lenses: z.array(z.string()), types: z.array(z.string()) }).optional(),
});

/**
 * A brief with a `BASELINE.md` beside its `BRIEF.md` is paired: the same
 * product, built once on knew and once with no knew at all, judged by the
 * same checker. Its `baseline-reference/` proves the baseline can pass.
 */
export type Brief = z.infer<typeof briefSchema> & { name: string; dir: string; arms: Arm[]; changes: boolean };

/**
 * A brief with a `CHANGE.md` (and, if paired, a `CHANGE-BASELINE.md`) changes
 * after the build: the same session is handed the change, and the app is
 * checked again, so what a change costs is measured beside what a build does.
 * Its `reference-changed/` (and `baseline-reference-changed/`) are the apps
 * after the change.
 */
export function loadBrief(name: string): Brief {
  const dir = join(BRIEFS, name);
  const arms: Arm[] = existsSync(join(dir, "BASELINE.md")) ? ["knew", "baseline"] : ["knew"];
  const changes = existsSync(join(dir, "CHANGE.md"));
  return { ...briefSchema.parse(JSON.parse(readFileSync(join(dir, "brief.json"), "utf8"))), name, dir, arms, changes };
}

/** Where an arm's known-good app lives, as first built or after the change. */
export const referenceOf = (brief: Brief, arm: Arm, phase: 1 | 2 = 1) =>
  join(brief.dir, `${arm === "knew" ? "reference" : "baseline-reference"}${phase === 2 ? "-changed" : ""}`);

/** The change as an arm's agent reads it. */
export const changeFileOf = (arm: Arm) => (arm === "knew" ? "CHANGE.md" : "CHANGE-BASELINE.md");

export function briefNames(): string[] {
  return readdirSync(BRIEFS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(BRIEFS, entry.name, "brief.json")))
    .map((entry) => entry.name)
    .sort();
}

/** A content hash of what the agent and the checker see, so a result says exactly which brief it measured. */
export function briefHash(brief: Brief): string {
  const hash = createHash("sha256");
  for (const file of ["BRIEF.md", "BASELINE.md", "CHANGE.md", "CHANGE-BASELINE.md", "brief.json", "check.ts", ...brief.inputs]) hashPath(hash, join(brief.dir, file));
  return hash.digest("hex").slice(0, 16);
}

function hashPath(hash: ReturnType<typeof createHash>, path: string): void {
  if (!existsSync(path)) return;
  if (!statSync(path).isDirectory()) {
    hash.update(path.slice(path.lastIndexOf("/") + 1)).update(readFileSync(path));
    return;
  }
  for (const entry of readdirSync(path).sort()) hashPath(hash, join(path, entry));
}

const escaped = (name: string) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A backtick span that names a file or a directory: its words are a path, not an identifier. */
const isPath = (span: string) => !/[\s(){}]/.test(span) && (span.includes("/") || /\.[a-z]+$/.test(span));

/**
 * The package names a brief says that it should not: a brief is a product
 * story, and finding the API is part of what a run measures. A name with a
 * capital, a digit or an underscore (`readinessFor`, `ENGINE_DEFAULTS`) is
 * flagged anywhere; an ordinary word (`after`, `weight`) only inside a
 * backtick span, where it reads as code, and never inside a path.
 */
export function briefLeaks(text: string, names: Iterable<string>, allow: ReadonlySet<string>): string[] {
  const spans = [...text.matchAll(/`([^`\n]+)`/g)].map((match) => match[1]!).filter((span) => !isPath(span));
  const found = new Set<string>();
  for (const name of names) {
    if (allow.has(name)) continue;
    const word = new RegExp(`(?<![\\w$])${escaped(name)}(?![\\w$])`);
    if (/[A-Z0-9_$]/.test(name) ? word.test(text) : spans.some((span) => word.test(span))) found.add(name);
  }
  return [...found].sort();
}

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { BRIEFS } from "./prep.ts";

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
});

export type Brief = z.infer<typeof briefSchema> & { name: string; dir: string };

export function loadBrief(name: string): Brief {
  const dir = join(BRIEFS, name);
  return { ...briefSchema.parse(JSON.parse(readFileSync(join(dir, "brief.json"), "utf8"))), name, dir };
}

export function briefNames(): string[] {
  return readdirSync(BRIEFS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(BRIEFS, entry.name, "brief.json")))
    .map((entry) => entry.name)
    .sort();
}

/** A content hash of what the agent and the checker see, so a result says exactly which brief it measured. */
export function briefHash(brief: Brief): string {
  const hash = createHash("sha256");
  for (const file of ["BRIEF.md", "brief.json", "check.ts", ...brief.inputs]) hashPath(hash, join(brief.dir, file));
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

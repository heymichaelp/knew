import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  compileLens,
  compileVocabulary,
  lensProblems,
  parseLensDefinition,
  parseVocabularyDefinition,
  type CompiledNeed,
  type Fact,
  type Intelligence,
  type Lens,
  type LensDefinition,
  type Vocabulary,
  type VocabularyDefinition,
} from "@popjoker/knew";
import type { FakeIntelligence } from "@popjoker/knew/testing";

/**
 * What every brief's checker shares. It runs wherever `check.ts` sits — inside
 * a throwaway app, where `@popjoker/knew` is the tarball under test, or in the
 * repo against a reference, where it is the workspace's fresh build — and it
 * judges behaviour with the package's own functions, never field presence.
 */

export interface CheckItem {
  name: string;
  passed: boolean;
  detail: string;
}

export interface CheckResult {
  passed: boolean;
  checks: CheckItem[];
  /** For a brief whose notes are read for real: the reader model's calls, and their cost at API rates. */
  reading?: { calls: number; costUsd: number };
}

export interface CheckOptions {
  /** Typecheck against the untouched scaffold tsconfig the harness laid in `.check/`. */
  typecheck: boolean;
  /** Run the app's own tests. Off only where a caller runs them itself. */
  appTests?: boolean;
  /** Which way the app was built: on knew (the default), or with no knew at all, for a paired brief. */
  arm?: "knew" | "baseline";
  /** 1, as first built (the default); 2, after the brief's change. */
  phase?: 1 | 2;
}

/** A collector of named checks. A check passes unless it throws; what it returns is its detail. */
export class Checks {
  readonly items: CheckItem[] = [];

  async run(name: string, check: () => unknown): Promise<boolean> {
    try {
      const detail = await check();
      this.items.push({ name, passed: true, detail: typeof detail === "string" ? detail : "" });
      return true;
    } catch (error) {
      this.items.push({ name, passed: false, detail: error instanceof Error ? error.message : String(error) });
      return false;
    }
  }

  result(): CheckResult {
    return { passed: this.items.length > 0 && this.items.every((item) => item.passed), checks: this.items };
  }
}

export function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export interface Definitions {
  vocabularyDefinition: VocabularyDefinition;
  vocabulary: Vocabulary;
  lensDefinitions: Record<string, LensDefinition>;
  lenses: Record<string, Lens>;
}

/** Read and compile `definitions/vocabulary.json` and every `definitions/lenses/*.json`, naming every problem. */
export function loadDefinitions(dir: string): Definitions {
  const path = join(dir, "definitions", "vocabulary.json");
  ensure(existsSync(path), "definitions/vocabulary.json is missing");
  const vocabularyDefinition = parseVocabularyDefinition(JSON.parse(readFileSync(path, "utf8")));
  const vocabulary = compileVocabulary(vocabularyDefinition);
  const lensDir = join(dir, "definitions", "lenses");
  ensure(existsSync(lensDir), "definitions/lenses/ is missing");
  const lensDefinitions: Record<string, LensDefinition> = {};
  const lenses: Record<string, Lens> = {};
  for (const file of readdirSync(lensDir).filter((name) => name.endsWith(".json")).sort()) {
    const definition = parseLensDefinition(JSON.parse(readFileSync(join(lensDir, file), "utf8")));
    const problems = lensProblems(definition, vocabulary);
    ensure(problems.length === 0, `definitions/lenses/${file} does not read the vocabulary cleanly: ${problems.join("; ")}`);
    ensure(file === `${definition.id}.json`, `definitions/lenses/${file} holds lens ${definition.id}; name the file after the lens`);
    lensDefinitions[definition.id] = definition;
    lenses[definition.id] = compileLens(definition, vocabulary);
  }
  return { vocabularyDefinition, vocabulary, lensDefinitions, lenses };
}

const DAY_MS = 86_400_000;
let counter = 0;

/** A current fact of `type`, said `daysAgo` days before `at`. Its id never
 *  collides with one the fake mints, so the two can share a ledger. */
export function factOf(type: string, text: string, at: Date, daysAgo: number, entityId = "subject-of-check"): Fact {
  counter += 1;
  const said = new Date(at.getTime() - daysAgo * DAY_MS);
  return {
    id: `00000000-0000-4000-9000-${String(counter).padStart(12, "0")}`,
    entityId,
    objectId: null,
    type,
    fact: text,
    attributes: {},
    validAt: null,
    invalidAt: null,
    createdAt: said,
    lastSaidAt: said,
    expiredAt: null,
    supersededById: null,
    episodeIds: [`episode-${counter}`],
  };
}

/** Whether an need applies to an entity with these fields, decided as the engine decides it. */
function appliesTo(need: CompiledNeed, fields: Readonly<Record<string, string | null>>): boolean {
  return need.when.every((clause) => {
    const value = fields[clause.field];
    return typeof value === "string" && clause.equals.some((candidate) => candidate.trim().toLowerCase() === value.trim().toLowerCase());
  });
}

/**
 * Fresh facts, said an hour before `at`, meeting every need of `lens` that
 * applies to an entity with `fields`, except the needs `skip` picks out:
 * `enough` of them per need. Each is of a type that counts toward no skipped need
 * where the need has one, so meeting the rest leaves the skipped needs alone.
 */
export function factsMeeting(
  lens: Lens,
  at: Date,
  options: { skip?: (need: CompiledNeed) => boolean; fields?: Readonly<Record<string, string | null>> } = {},
): Fact[] {
  const skipped = lens.needs.filter((need) => options.skip?.(need) === true);
  const avoid = new Set(skipped.flatMap((need) => need.types));
  const facts: Fact[] = [];
  for (const need of lens.needs) {
    if (skipped.includes(need) || !appliesTo(need, options.fields ?? {})) continue;
    const type = need.types.find((candidate) => !avoid.has(candidate)) ?? need.types[0]!;
    for (let index = 1; index <= need.enough; index += 1) facts.push(factOf(type, `${need.id}, known (${index})`, at, 1 / 24));
  }
  return facts;
}

export interface Call {
  method: string;
  args: unknown[];
}

const FAKE_ONLY = new Set(["seedFacts", "setSummary", "script"]);

/**
 * The fake behind a recording proxy: the app is handed the contract's methods
 * and nothing of the fake's own, and every call it makes is kept, so a probe
 * can read the scope and the ids the app chose instead of guessing them.
 */
export function recording(fake: FakeIntelligence): { engine: Intelligence; calls: Call[] } {
  const calls: Call[] = [];
  const engine = new Proxy(fake, {
    get(target, property, receiver) {
      if (typeof property === "string" && FAKE_ONLY.has(property)) return undefined;
      const value: unknown = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        calls.push({ method: String(property), args });
        return (value as (...given: unknown[]) => unknown).apply(target, args);
      };
    },
  }) as Intelligence;
  return { engine, calls };
}

/** The app's `src/app.ts`, imported as the app's own code would be. */
export async function importApp(dir: string): Promise<Record<string, unknown>> {
  const path = join(dir, "src", "app.ts");
  ensure(existsSync(path), "src/app.ts is missing");
  return (await import(pathToFileURL(path).href)) as Record<string, unknown>;
}

function tapCount(output: string, key: string): number {
  const match = output.match(new RegExp(`^# ${key} (\\d+)$`, "m"));
  return match ? Number(match[1]) : 0;
}

/** The environment for a nested run: this one's, minus what would make a nested `node --test` report to a runner that is not listening. */
function nestedEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_OPTIONS: "" };
  delete env.NODE_TEST_CONTEXT;
  return env;
}

/** Run the app's own tests ourselves, rather than through a `test` script the agent could have rewritten. */
export function runAppTests(dir: string): { passed: number; failed: number; output: string } {
  const files = existsSync(join(dir, "test")) ? readdirSync(join(dir, "test")).filter((name) => /\.test\.(ts|mts|js|mjs)$/.test(name)) : [];
  ensure(files.length > 0, "the app has no tests in test/");
  const result = spawnSync(process.execPath, ["--import", "tsx", "--test", ...files.map((file) => join("test", file))], {
    cwd: dir,
    encoding: "utf8",
    timeout: 180_000,
    env: nestedEnv(),
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const failed = tapCount(output, "fail");
  // A run that died before reporting still failed, even with no failures counted.
  return { passed: tapCount(output, "pass"), failed: result.status !== 0 && failed === 0 ? 1 : failed, output };
}

/** A package binary as Node would resolve it from `dir`: the nearest `node_modules/.bin` up the tree. */
function binFrom(dir: string, name: string): string | null {
  for (let at = dir; ; at = dirname(at)) {
    const bin = join(at, "node_modules", ".bin", name);
    if (existsSync(bin)) return bin;
    if (dirname(at) === at) return null;
  }
}

/** Typecheck the app with the untouched copy of the scaffold's tsconfig the harness laid in `.check/`. */
export function typecheckUntouched(dir: string): { ok: boolean; output: string } {
  const config = join(dir, ".check", "tsconfig.json");
  ensure(existsSync(config), ".check/tsconfig.json was not laid in by the harness");
  const tsc = binFrom(dir, "tsc");
  ensure(tsc, "no tsc is installed where the app can reach it");
  const result = spawnSync(tsc, ["-p", config], { cwd: dir, encoding: "utf8", timeout: 180_000 });
  return { ok: result.status === 0, output: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim() };
}

/** The checks every brief ends with: the app's own tests, run by us, and its types, against settings it did not touch. */
export async function standardChecks(checks: Checks, dir: string, options: CheckOptions): Promise<void> {
  if (options.appTests !== false) {
    await checks.run("the app's own tests pass", () => {
      const run = runAppTests(dir);
      ensure(run.failed === 0 && run.passed > 0, `${run.passed} passed, ${run.failed} failed:\n${run.output.slice(-1500)}`);
      return `${run.passed} passed`;
    });
  }
  if (options.typecheck) {
    await checks.run("the app typechecks under the scaffold's own settings", () => {
      const run = typecheckUntouched(dir);
      ensure(run.ok, run.output.slice(-1500));
    });
  }
}

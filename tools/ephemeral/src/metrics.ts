import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { Transcript } from "./transcript.ts";

/**
 * What a run is measured by — pure functions over a parsed transcript and the
 * app left behind. Effort (turns, cost, tool calls, how often the agent ran
 * its tests), friction (errors raised from the package, which docs it opened,
 * whether it read the implementation, type escapes), and two kinds of
 * disqualification: a session that was not the clean room asked for (infra),
 * and an agent that reached outside its directory (contaminated).
 */

export interface PackageError {
  message: string;
  count: number;
}

export interface RunMetrics {
  turns: number | null;
  costUsd: number | null;
  toolCalls: Record<string, number>;
  testRuns: number;
  typecheckRuns: number;
  /** Package docs and declarations opened, by path under the package. */
  docsOpened: string[];
  /** Whether it read the compiled implementation — a sign the docs fell short. */
  readImplementation: boolean;
  packageErrors: PackageError[];
}

const PACKAGE_DIR = "node_modules/@popjoker/knew/";

const bashCommands = (t: Transcript) =>
  t.toolUses.filter((use) => use.name === "Bash").map((use) => (typeof use.input.command === "string" ? use.input.command : ""));

/** Paths a tool call touched: a file tool's path, or every absolute or package path in a shell command. */
function pathsTouched(t: Transcript): string[] {
  const paths: string[] = [];
  for (const use of t.toolUses) {
    for (const key of ["file_path", "path", "notebook_path"]) {
      const value = use.input[key];
      if (typeof value === "string") paths.push(value);
    }
    if (use.name === "Bash" && typeof use.input.command === "string") {
      for (const match of use.input.command.matchAll(/(?:^|[\s'"=(])((?:\/|~\/|\.\.?\/)?[\w.@\-/]*node_modules\/@popjoker\/knew\/[\w.\-/]+|\/[\w.@\-/]+)/g)) {
        if (match[1]) paths.push(match[1]);
      }
    }
  }
  return paths;
}

function docsOf(t: Transcript): { docsOpened: string[]; readImplementation: boolean } {
  const opened = new Set<string>();
  let readImplementation = false;
  for (const path of pathsTouched(t)) {
    const at = path.indexOf(PACKAGE_DIR);
    if (at < 0) continue;
    const inside = path.slice(at + PACKAGE_DIR.length);
    if (inside === "" || inside.endsWith("/")) continue;
    opened.add(inside);
    if (/^dist\/.*\.js$/.test(inside)) readImplementation = true;
  }
  return { docsOpened: [...opened].sort(), readImplementation };
}

/**
 * Errors raised from inside the package, read from what the tools printed:
 * the message above a stack frame under the package's `dist/`, a ZodError's
 * issues, and the lens compiler's `lens id@version:` problems. No catalogue
 * to keep up to date — whatever the package throws is caught by its frame.
 */
export function packageErrorsOf(t: Transcript): PackageError[] {
  const counts = new Map<string, number>();
  const isFrame = (line: string) => /^\s+at /.test(line);
  for (const result of t.toolResults) {
    // Each message counts once per tool result — the number of times the agent met it — under one spelling:
    // a plain `Error: ` prefix dropped, and a bare `ZodError: [` left to its issues, which are read below.
    const seen = new Set<string>();
    const add = (message: string) => {
      const key = message.trim().replace(/^Error: /, "").slice(0, 400);
      if (!key || /^ZodError:\s*\[?$/.test(key) || seen.has(key)) return;
      seen.add(key);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    };
    const lines = result.text.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      if (!isFrame(lines[index]!)) {
        const lens = lines[index]!.match(/(lens \S+@\d+: .+)$/);
        if (lens?.[1]) add(lens[1]);
        continue;
      }
      // A stack: the run of frames from here. It is the package's when any frame is under its dist/.
      const first = index;
      while (index + 1 < lines.length && isFrame(lines[index + 1]!)) index += 1;
      // `index` now sits on the stack's last frame, so the loop's step lands on the line after it.
      if (!lines.slice(first, index + 1).some((line) => line.includes("node_modules/@popjoker/knew/dist/"))) continue;
      // Its message is the error header above it — `ZodError: [` heads a block of issues — or the nearest line with words.
      let header: string | undefined;
      for (let above = first - 1; above >= Math.max(0, first - 60) && header === undefined; above -= 1) {
        if (/^\s*(?:[A-Z]\w*)?Error\b.*:/.test(lines[above]!)) header = lines[above]!;
      }
      add(header ?? lines.slice(0, first).reverse().find((line) => /[A-Za-z]{3}/.test(line)) ?? "an error with no message");
    }
    for (const match of result.text.matchAll(/"message":\s*"([^"]+)"[^}]*"path":\s*\[([^\]]*)\]/g)) {
      add(`ZodError at [${match[2]?.replace(/\s+/g, "")}]: ${match[1]}`);
    }
  }
  return [...counts.entries()].map(([message, count]) => ({ message, count })).sort((a, b) => b.count - a.count || a.message.localeCompare(b.message));
}

export function measure(t: Transcript): RunMetrics {
  const toolCalls: Record<string, number> = {};
  for (const use of t.toolUses) toolCalls[use.name] = (toolCalls[use.name] ?? 0) + 1;
  const commands = bashCommands(t);
  return {
    turns: t.result?.numTurns ?? null,
    costUsd: t.result?.costUsd ?? null,
    toolCalls,
    testRuns: commands.filter((command) => /\bnpm (?:run )?test\b|node (?:--import tsx )?--test\b/.test(command)).length,
    typecheckRuns: commands.filter((command) => /\btsc\b|npm run typecheck\b/.test(command)).length,
    ...docsOf(t),
    packageErrors: packageErrorsOf(t),
  };
}

/**
 * Whether the session was the clean room asked for, from its own init event:
 * the exact toolset, no MCP servers, the requested model and directory, edits
 * accepted, and no slash command from your skills or plugins. Each problem is
 * a reason the run is `infra`, not a verdict on the package.
 */
export function isolationProblems(
  t: Transcript,
  expected: { tools: readonly string[]; model: string; cwd: string; personalSkills: readonly string[] },
): string[] {
  const init = t.init;
  if (!init) return ["the session never reported its init event"];
  const problems: string[] = [];
  const tools = [...init.tools].sort().join(",");
  if (tools !== [...expected.tools].sort().join(",")) problems.push(`tools were ${tools || "none"}, not ${[...expected.tools].sort().join(",")}`);
  if (init.mcpServers.length > 0) problems.push(`${init.mcpServers.length} MCP server(s) were loaded`);
  if (init.model && !init.model.startsWith(expected.model)) problems.push(`the model was ${init.model}, not ${expected.model}`);
  if (init.cwd && init.cwd !== expected.cwd) problems.push(`the session ran in ${init.cwd}, not ${expected.cwd}`);
  if (init.permissionMode && init.permissionMode !== "acceptEdits") problems.push(`the permission mode was ${init.permissionMode}`);
  const leaked = init.slashCommands.filter((command) => command.includes(":") || expected.personalSkills.includes(command.replace(/^\//, "")));
  if (leaked.length > 0) problems.push(`personal skills or plugin commands loaded: ${leaked.join(", ")}`);
  if (init.skills.length > 0) problems.push(`skills loaded: ${init.skills.join(", ")}`);
  const installed = init.plugins.filter((plugin) => plugin.path !== "builtin");
  if (installed.length > 0) problems.push(`installed plugins loaded: ${installed.map((plugin) => plugin.name).join(", ")}`);
  for (const denial of t.result?.permissionDenials ?? []) problems.push(`a permission was denied: ${JSON.stringify(denial).slice(0, 200)}`);
  return problems;
}

/** System paths an app build may legitimately touch outside its own directory. */
const SYSTEM = ["/usr/", "/bin/", "/lib/", "/lib64/", "/etc/", "/dev/", "/proc/self/", "/opt/", "/snap/"];

/**
 * An agent that reached outside its directory has measured something other
 * than the shipped docs: any path naming the repo, the CLI's own state, or an
 * absolute place outside the run directory that is not a system path, and any
 * attempt to fetch from the network.
 */
export function contaminationOf(t: Transcript, context: { runDir: string; repo: string; home: string }): string[] {
  const reasons = new Set<string>();
  for (const path of pathsTouched(t)) {
    if (path.includes(context.repo)) reasons.add(`named the repo: ${path}`);
    else if (path.startsWith("~/.claude") || path.startsWith(`${context.home}/.claude`)) reasons.add(`touched the CLI's own state: ${path}`);
    else if (path.startsWith("/") && !path.startsWith(context.runDir) && !SYSTEM.some((prefix) => path.startsWith(prefix)) && path !== "/") {
      reasons.add(`reached outside its directory: ${path}`);
    }
  }
  for (const command of bashCommands(t)) {
    if (/\bgit clone\b|\bcurl\b|\bwget\b/.test(command)) reasons.add(`tried the network: ${command.slice(0, 160)}`);
  }
  return [...reasons];
}

export interface SourceMetrics {
  /** `as any`, `@ts-ignore` and `@ts-expect-error` in the app's own sources. */
  typeEscapes: number;
  /** Dependencies the agent added beyond the scaffold's. */
  addedDependencies: string[];
  /** Whether it changed the scaffold's package.json scripts or tsconfig. */
  changedScripts: boolean;
  changedTsconfig: boolean;
}

function sourcesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true })
    .map((entry) => join(dir, String(entry)))
    .filter((path) => /\.(ts|mts|cts|js|mjs)$/.test(path) && !path.includes("node_modules") && statSync(path).isFile());
}

export function sourceMetrics(runDir: string, scaffold: { packageJson: string; tsconfig: string }): SourceMetrics {
  let typeEscapes = 0;
  for (const file of [...sourcesUnder(join(runDir, "src")), ...sourcesUnder(join(runDir, "test"))]) {
    typeEscapes += (readFileSync(file, "utf8").match(/\bas any\b|@ts-ignore|@ts-expect-error/g) ?? []).length;
  }
  const read = (file: string) => (existsSync(join(runDir, file)) ? readFileSync(join(runDir, file), "utf8") : "");
  let addedDependencies: string[] = [];
  let changedScripts = true;
  try {
    const before = JSON.parse(scaffold.packageJson) as { dependencies?: object; devDependencies?: object; scripts?: object };
    const after = JSON.parse(read("package.json")) as { dependencies?: object; devDependencies?: object; scripts?: object };
    const names = (pkg: typeof before) => new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]);
    const had = names(before);
    addedDependencies = [...names(after)].filter((name) => !had.has(name)).sort();
    changedScripts = JSON.stringify(before.scripts) !== JSON.stringify(after.scripts);
  } catch {
    /* an unreadable package.json is itself a changed one */
  }
  return { typeEscapes, addedDependencies, changedScripts, changedTsconfig: read("tsconfig.json") !== scaffold.tsconfig };
}

export type Outcome = "pass" | "fail" | "budget" | "timeout" | "infra" | "contaminated";

/**
 * One word for a run. Contamination and infra come first, because then the
 * run measured something other than the package; a passing app passes even if
 * the clock or the budget stopped the agent while it polished; otherwise the
 * clock, the budget, or plain failure.
 */
export function classify(input: {
  contamination: readonly string[];
  isolation: readonly string[];
  timedOut: boolean;
  resultSubtype: string | null;
  resultIsError: boolean;
  hasResult: boolean;
  checkPassed: boolean;
}): { outcome: Outcome; reason: string } {
  if (input.contamination.length > 0) return { outcome: "contaminated", reason: input.contamination[0]! };
  if (input.isolation.length > 0) return { outcome: "infra", reason: input.isolation[0]! };
  if (input.checkPassed) return { outcome: "pass", reason: "every check passed" };
  if (input.timedOut) return { outcome: "timeout", reason: "the clock ran out" };
  if (input.resultSubtype?.includes("budget")) return { outcome: "budget", reason: "the build hit its budget" };
  if (!input.hasResult) return { outcome: "infra", reason: "the session ended without a result" };
  if (input.resultIsError) return { outcome: "infra", reason: `the session ended in error (${input.resultSubtype ?? "unknown"})` };
  return { outcome: "fail", reason: "a check failed" };
}

export const relativeTo = (root: string, path: string) => relative(root, path) || ".";

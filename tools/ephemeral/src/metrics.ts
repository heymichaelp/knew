import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix, relative } from "node:path";
import type { ToolUse, Transcript } from "./transcript.ts";

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

/** A shell command that runs the app's tests, or its typecheck. */
export const isTestRun = (command: string) => /\bnpm (?:run )?test\b|node (?:--import tsx )?--test\b/.test(command);
export const isTypecheckRun = (command: string) => /\btsc\b|npm run typecheck\b/.test(command);
/** Package files that are implementation rather than docs or declarations. */
export const isImplementation = (inside: string) => /^dist\/.*\.js$/.test(inside);

export const commandOf = (use: ToolUse): string | null => (use.name === "Bash" && typeof use.input.command === "string" ? use.input.command : null);

const bashCommands = (t: Transcript) => t.toolUses.map(commandOf).filter((command) => command !== null);

/** Paths one tool call touched: a file tool's path, or every absolute or package path in a shell command. */
export function pathsOf(use: ToolUse): string[] {
  const paths: string[] = [];
  for (const key of ["file_path", "path", "notebook_path"]) {
    const value = use.input[key];
    if (typeof value === "string") paths.push(value);
  }
  const command = commandOf(use);
  if (command !== null) {
    for (const match of command.matchAll(/(?:^|[\s'"=(])((?:\/|~\/|\.\.?\/)?[\w.@\-/]*node_modules\/@popjoker\/knew\/[\w.\-/]+|\/[\w.@\-/]+)/g)) {
      if (match[1]) paths.push(match[1]);
    }
  }
  return paths;
}

const pathsTouched = (t: Transcript): string[] => t.toolUses.flatMap(pathsOf);

/** Paths under the package, by path inside it. */
function insidePackage(paths: readonly string[]): string[] {
  const files: string[] = [];
  for (const path of paths) {
    const at = path.indexOf(PACKAGE_DIR);
    if (at < 0) continue;
    const inside = path.slice(at + PACKAGE_DIR.length);
    // A file, not a directory listed: its last part has an extension.
    if (/\.\w+$/.test(inside.split("/").at(-1) ?? "") && !files.includes(inside)) files.push(inside);
  }
  return files;
}

/** A word of a shell command that names a file: a path, or a name with an extension. */
const fileWord = (word: string) => /^[\w./@-]+$/.test(word) && !word.startsWith("-") && (word.includes("/") || /\.\w+$/.test(word));

/**
 * The package files each tool call opened, by step (index 0 is step 1). The
 * Bash tool keeps its working directory from one call to the next, so an agent
 * that `cd`s into the package and then runs `cat README.md` read the README:
 * the directory is followed across calls, and a bare file name in a command is
 * read against it. A heredoc's body is text being written, not files read.
 */
export function packageFilesByStep(t: Transcript): string[][] {
  let cwd = t.init?.cwd ?? null;
  return t.toolUses.map((use) => {
    const paths = pathsOf(use);
    const command = commandOf(use)?.replace(/<<-?\s*['"]?(\w+)['"]?[\s\S]*?\n\1\b/g, "");
    for (const segment of command?.split(/&&|\|\||;|\||\n/) ?? []) {
      const words = segment.trim().split(/\s+/).filter(Boolean).map((word) => word.replace(/^['"]|['"]$/g, ""));
      if (words[0] === "cd") {
        const target = words[1];
        cwd = !target || target.startsWith("~") ? null : target.startsWith("/") ? posix.normalize(target) : cwd && posix.join(cwd, target);
        continue;
      }
      if (cwd) for (const word of words.slice(1).filter(fileWord)) paths.push(word.startsWith("/") ? word : posix.join(cwd, word));
    }
    return insidePackage(paths);
  });
}

function docsOf(t: Transcript): { docsOpened: string[]; readImplementation: boolean } {
  const opened = new Set(packageFilesByStep(t).flat());
  return { docsOpened: [...opened].sort(), readImplementation: [...opened].some(isImplementation) };
}

/**
 * Errors raised from inside the package, read from what the tools printed:
 * the message above a stack frame under the package's `dist/`, a ZodError's
 * issues, and the lens compiler's `lens id@version:` problems. No catalogue
 * to keep up to date — whatever the package throws is caught by its frame.
 */
export function packageErrorsOf(t: Transcript): PackageError[] {
  const counts = new Map<string, number>();
  // Each message counts once per tool result: the number of times the agent met it.
  for (const result of t.toolResults) for (const message of errorsIn(result.text)) counts.set(message, (counts.get(message) ?? 0) + 1);
  return [...counts.entries()].map(([message, count]) => ({ message, count })).sort((a, b) => b.count - a.count || a.message.localeCompare(b.message));
}

/** The package's errors in one tool result's text, each once, under one spelling. */
export function errorsIn(text: string): string[] {
  const isFrame = (line: string) => /^\s+at /.test(line);
  // A plain `Error: ` prefix is dropped, and a bare `ZodError: [` is left to its issues, which are read below.
  const seen: string[] = [];
  const add = (message: string) => {
    const key = message.trim().replace(/^Error: /, "").slice(0, 400);
    if (!key || /^ZodError:\s*\[?$/.test(key) || seen.includes(key)) return;
    seen.push(key);
  };
  const lines = text.split("\n");
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
  for (const match of text.matchAll(/"message":\s*"([^"]+)"[^}]*"path":\s*\[([^\]]*)\]/g)) {
    add(`ZodError at [${match[2]?.replace(/\s+/g, "")}]: ${match[1]}`);
  }
  return seen;
}

export function measure(t: Transcript): RunMetrics {
  const toolCalls: Record<string, number> = {};
  for (const use of t.toolUses) toolCalls[use.name] = (toolCalls[use.name] ?? 0) + 1;
  const commands = bashCommands(t);
  return {
    turns: t.result?.numTurns ?? null,
    costUsd: t.result?.costUsd ?? null,
    toolCalls,
    testRuns: commands.filter(isTestRun).length,
    typecheckRuns: commands.filter(isTypecheckRun).length,
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
  // A tool result too long to print is saved by the CLI to a file it tells the agent to read: its own mechanism, not a reach.
  const spilled = new Set(t.toolResults.flatMap((result) => [...result.text.matchAll(/Full output saved to: (\S+?)[.,;)]?(?:\s|$)/g)].map((match) => match[1]!)));
  for (const path of pathsTouched(t)) {
    if (spilled.has(path)) continue;
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

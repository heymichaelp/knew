import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createWriteStream, readdirSync, readlinkSync } from "node:fs";
import type { Moment } from "./moments.ts";

/**
 * Driving `claude -p` in a clean room: every flag below is in `claude --help`
 * for the CLI this was written against (2.1.291), and the session's own init
 * event is checked afterwards rather than trusted (see `transcript.ts`).
 */

/** The whole toolset: no Agent, WebFetch, WebSearch or AskUserQuestion, so the
 *  package's shipped docs are the only docs and nobody is asked anything. */
export const TOOLS = ["Read", "Write", "Edit", "Glob", "Grep", "Bash"] as const;

/** Bash cannot be confined by path on the host; these are refused outright,
 *  and anything else that strays is caught by the contamination audit. */
export const DENIED = ["Bash(sudo *)", "Bash(git push*)", "Bash(git clone*)", "Bash(curl *)", "Bash(wget *)"] as const;

export const DEFAULT_MODEL = "claude-opus-5-5";

/** The build prompt: short, in a client developer's voice, and silent on where
 *  the docs are — finding them is part of what is measured. */
export const BUILD_PROMPT =
  "You're adopting the npm package @popjoker/knew, which is installed in this project. BRIEF.md describes the app to " +
  "build on it. Work only inside this directory. You're done when `npm test` and `npm run typecheck` pass.";

/**
 * Think-aloud mode: the agent keeps a log while it works, as a participant in
 * a usability study is asked to. Off by default, because reflecting changes
 * the work: a think-aloud run's cost and turns are not comparable with a
 * plain one's, and its identity says which it was.
 */
export const THINK_ALOUD =
  " As you work, keep a file named NOTES.md in this directory: add one line each time you have to guess how something " +
  "behaves, find documentation or an error message confusing, or work around something. Say what happened and what you " +
  "did about it. It is read by the people who wrote the brief.";

/** A baseline run builds the same product with no package named or installed. */
export const BASELINE_PROMPT =
  "BRIEF.md describes the app to build. Work only inside this directory. You're done when `npm test` and `npm run typecheck` pass.";

/** The change, handed to the same session once the build is done. */
export const CHANGE_PROMPT =
  "The requirements have changed: CHANGE.md, now in this directory, says what's new. Change the app to meet it, and keep everything else working. You're done when `npm test` and `npm run typecheck` pass.";

export const buildPrompt = (thinkAloud: boolean, arm: "knew" | "baseline" = "knew") =>
  (arm === "knew" ? BUILD_PROMPT : BASELINE_PROMPT) + (thinkAloud ? THINK_ALOUD : "");

const DEBRIEF_QUESTIONS = [
  "This directory is about to be deleted. Before it is, answer some questions about building on @popjoker/knew,",
  "from what actually happened in this session. Quote error messages exactly as they appeared, and leave a list empty",
  "rather than invent an entry.",
  "1. guessed: what about the package's behaviour did you have to guess, rather than read?",
  "2. unhelpfulErrors: which error messages from the package didn't tell you what to do? Quote each, and say what would have helped.",
  "3. missingFromDocs: what did you look for in the package's documentation and not find?",
  "4. apiFriction: which parts of the package's API fought you?",
  "5. wouldChange: the one change to the package that would have helped most.",
];

/**
 * The debrief: five open questions, then one per moment found in the session
 * (`momentsOf`), by number, the way a researcher replays the tape with a
 * participant. Recall fades over a long session; a question about step 14 is
 * answered about step 14, and an answer to a moment that was never asked
 * about is dropped (`verifyDebrief`).
 */
export function debriefPrompt(moments: readonly Moment[]): string {
  if (moments.length === 0) return [...DEBRIEF_QUESTIONS, "6. moments: leave this list empty."].join("\n");
  return [
    ...DEBRIEF_QUESTIONS,
    "6. moments: these moments stood out in your session; steps count your tool calls from 1. For each, by its number, say",
    "what you were trying to do, what about the package confused or slowed you (or \"nothing\" if it didn't), and what in the",
    "package, its docs or its errors would have made it unnecessary.",
    ...moments.map((moment, index) => `   M${index + 1}. ${moment.what}${moment.evidence.length ? ` (${moment.evidence.slice(0, 3).join("; ")})` : ""}`),
  ].join("\n");
}

const strings = { type: "array", items: { type: "string" } } as const;

export const DEBRIEF_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["guessed", "unhelpfulErrors", "missingFromDocs", "apiFriction", "wouldChange", "moments"],
  properties: {
    guessed: strings,
    unhelpfulErrors: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["message", "wouldHaveHelped"],
        properties: { message: { type: "string" }, wouldHaveHelped: { type: "string" } },
      },
    },
    missingFromDocs: strings,
    apiFriction: strings,
    wouldChange: { type: "string" },
    moments: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["moment", "wasDoing", "confusion", "wouldHaveHelped"],
        properties: { moment: { type: "integer" }, wasDoing: { type: "string" }, confusion: { type: "string" }, wouldHaveHelped: { type: "string" } },
      },
    },
  },
} as const;

/** Flags that keep a session clean: no customisation of yours (`--safe-mode`),
 *  none of your settings files and file tools confined to the run directory
 *  (`--restricted`), no MCP servers, no skills, edits accepted, and anything
 *  that would prompt denied rather than left hanging. */
export function isolationArgs(tools: readonly string[]): string[] {
  const list = tools.join(",");
  return [
    "--safe-mode",
    "--restricted",
    "--strict-mcp-config",
    "--disable-slash-commands",
    "--tools",
    list,
    ...(tools.length > 0 ? ["--allowedTools", list] : []),
    "--permission-mode",
    "acceptEdits",
    "--permission-prompts",
    "none",
    "--disallowedTools",
    ...DENIED,
  ];
}

export interface BuildOptions {
  sessionId: string;
  model: string;
  effort?: string | undefined;
  budgetUsd: number;
}

/** The prompt goes first: the variadic flags at the end would swallow it otherwise. */
export function buildArgs(options: BuildOptions, prompt: string = BUILD_PROMPT): string[] {
  return [
    "-p",
    prompt,
    "--session-id",
    options.sessionId,
    "--model",
    options.model,
    ...(options.effort ? ["--effort", options.effort] : []),
    "--output-format",
    "stream-json",
    "--verbose",
    "--max-budget-usd",
    String(options.budgetUsd),
    ...isolationArgs(TOOLS),
  ];
}

/** The change prompt into the build's own session, with the build's own tools and isolation. */
export function changeArgs(options: BuildOptions, prompt: string = CHANGE_PROMPT): string[] {
  return [
    "-p",
    prompt,
    "--resume",
    options.sessionId,
    "--model",
    options.model,
    ...(options.effort ? ["--effort", options.effort] : []),
    "--output-format",
    "stream-json",
    "--verbose",
    "--max-budget-usd",
    String(options.budgetUsd),
    ...isolationArgs(TOOLS),
  ];
}

export function debriefArgs(options: { sessionId: string; model: string; budgetUsd: number }, prompt: string = debriefPrompt([])): string[] {
  return [
    "-p",
    prompt,
    "--resume",
    options.sessionId,
    "--model",
    options.model,
    "--output-format",
    "json",
    "--json-schema",
    JSON.stringify(DEBRIEF_SCHEMA),
    "--max-budget-usd",
    String(options.budgetUsd),
    ...isolationArgs([]),
  ];
}

/**
 * The child's environment, by allowlist: enough to find your login and run
 * tools, and nothing of this shell's own Claude Code session, npm, GitHub or
 * SSH credentials. The CLI may not update itself mid-batch, keep memories, or
 * checkpoint files.
 */
export function cleanEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ["PATH", "HOME", "USER", "LOGNAME", "LANG", "SHELL", "TERM", "TMPDIR", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS"]) {
    if (source[key]) env[key] = source[key];
  }
  return {
    ...env,
    DISABLE_AUTOUPDATER: "1",
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
    CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING: "1",
    NPM_CONFIG_USERCONFIG: "/dev/null",
  };
}

export function cliVersion(bin = "claude"): string {
  const out = execFileSync(bin, ["--version"], { encoding: "utf8", env: cleanEnv() });
  return out.trim().split(/\s+/)[0] ?? out.trim();
}

export interface Stamped {
  /** Milliseconds since the session started, when the line arrived. */
  at: number;
  event: unknown;
}

export interface ClaudeRun {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  idledOut: boolean;
  durationMs: number;
  events: unknown[];
  stderr: string;
}

function parseLine(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return { type: "unparsed", raw: line };
  }
}

/**
 * Run `claude` with `args` in `cwd` and collect its stdout as events. stdin is
 * closed (an open one can hang `-p`), the child leads its own process group so
 * the whole tree can be killed, and two clocks stop it: the wall clock, and an
 * inactivity watchdog for a session that has gone quiet. Each line is stamped
 * as it arrives, because the events carry no times of their own.
 */
export function runClaude(
  args: string[],
  options: { cwd: string; transcriptPath?: string; timeoutMs: number; idleMs: number; bin?: string },
): Promise<ClaudeRun> {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(options.bin ?? "claude", args, { cwd: options.cwd, env: cleanEnv(), stdio: ["ignore", "pipe", "pipe"], detached: true });
    const out = options.transcriptPath ? createWriteStream(options.transcriptPath) : null;
    const events: unknown[] = [];
    let remainder = "";
    let stderr = "";
    let lastActivity = Date.now();
    let timedOut = false;
    let idledOut = false;
    let killing = false;

    const record = (line: string) => {
      if (line.trim() === "") return;
      const event = parseLine(line);
      events.push(event);
      out?.write(`${JSON.stringify({ at: Date.now() - started, event } satisfies Stamped)}\n`);
    };
    const killGroup = () => {
      if (killing || child.pid === undefined) return;
      killing = true;
      const pid = child.pid;
      try {
        process.kill(-pid, "SIGTERM");
      } catch {
        /* already gone */
      }
      setTimeout(() => {
        try {
          process.kill(-pid, "SIGKILL");
        } catch {
          /* already gone */
        }
      }, 10_000).unref();
    };
    const wall = setTimeout(() => {
      timedOut = true;
      killGroup();
    }, options.timeoutMs);
    const watchdog = setInterval(() => {
      if (Date.now() - lastActivity > options.idleMs) {
        idledOut = true;
        killGroup();
      }
    }, 5_000);

    child.stdout.on("data", (chunk: Buffer) => {
      lastActivity = Date.now();
      const lines = (remainder + chunk.toString("utf8")).split("\n");
      remainder = lines.pop() ?? "";
      for (const line of lines) record(line);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      lastActivity = Date.now();
      stderr = (stderr + chunk.toString("utf8")).slice(-20_000);
    });
    child.on("close", (exitCode, signal) => {
      clearTimeout(wall);
      clearInterval(watchdog);
      record(remainder);
      out?.end();
      resolve({ exitCode, signal, timedOut, idledOut, durationMs: Date.now() - started, events, stderr });
    });
  });
}

/** Background shells can outlive the CLI: kill any process still working inside the run directory. Linux only. */
export function killStragglers(dir: string): number {
  if (process.platform !== "linux") return 0;
  let killed = 0;
  for (const pid of readdirSync("/proc").filter((name) => /^\d+$/.test(name))) {
    try {
      const cwd = readlinkSync(`/proc/${pid}/cwd`);
      if (cwd === dir || cwd.startsWith(`${dir}/`)) {
        process.kill(Number(pid), "SIGKILL");
        killed += 1;
      }
    } catch {
      /* gone, or not ours to read */
    }
  }
  return killed;
}

/** Remove every trace the CLI keeps of a project: transcripts, tasks, file history, config entry. */
export function purge(dir: string, bin = "claude"): { ok: boolean; output: string } {
  const result = spawnSync(bin, ["purge", dir, "-y"], { encoding: "utf8", env: cleanEnv() });
  return { ok: result.status === 0, output: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim() };
}

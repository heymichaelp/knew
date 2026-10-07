import { commandOf, errorsIn, isImplementation, isTestRun, isTypecheckRun, packageFilesByStep, pathsOf } from "./metrics.ts";
import type { Entry, Transcript } from "./transcript.ts";

/**
 * The moments in a session a usability researcher would replay the tape for,
 * found from what the agent did rather than what it later remembers: a test
 * or typecheck that failed again and again before it passed, or never did;
 * the compiled implementation opened, because the docs fell short; a doc read
 * a second time; and the agent, mid-task, saying it was unsure, guessing or
 * working around something. Pure, and no model is asked anything.
 *
 * The debrief then asks about these moments by number, so its answers are
 * anchored to steps that happened (see `debriefPrompt`). In think-aloud mode,
 * the agent's own `NOTES.md` is read back and each line placed at the step
 * that wrote it (`notesOf`).
 */

export type MomentKind = "never-passed" | "stuck" | "read-implementation" | "reread" | "aside";

export interface Moment {
  kind: MomentKind;
  /** The step (tool call, from 1) where it began. */
  step: number;
  /** Where a span ended; null for a single moment. */
  until: number | null;
  /** One line, in words. */
  what: string;
  /** What backs it up: commands, the first line of a failure, package errors met, files opened or edited, the agent's words. */
  evidence: string[];
}

/** Two failures in a row before a pass is a struggle; one is ordinary test-first work. */
const STUCK_AFTER = 2;

/** Words an agent uses when it is guessing, confused or working around something. */
const HEDGE =
  /\b(?:not sure|unsure|unclear|i'?ll assume|assuming|i assume|i guess|guessing|(?:doesn|don|didn)'?t (?:say|document|mention|explain)|isn'?t (?:documented|clear|obvious)|not documented|undocumented|can'?t find|couldn'?t find|no mention|confus\w*|surpris\w*|unexpected\w*|work ?around|hack\w*|apparently|it seems|seems like|let me (?:look at|check|read) the (?:source|implementation|compiled|dist))\b/i;

const MAX_ASIDES = 8;

type ToolEntry = Extract<Entry, { kind: "tool" }>;

/** A check run's result failed: an error flag from the tool, or the usual words of a failing run. */
const failed = (entry: ToolEntry) =>
  entry.result !== null && (entry.result.isError || /Exit code [1-9]|# fail [1-9]|error TS\d+|npm ERR!|ERR_[A-Z_]+/.test(entry.result.text));

/** The first line of a failure worth reading: an error, a failing assertion, a type error. */
function leadOf(text: string): string {
  const lines = text.split("\n").map((line) => line.trim());
  const line = lines.find((l) => /error|fail|expected|assert|cannot|not /i.test(l) && !/^# (?:pass|fail|tests)/.test(l)) ?? lines.find(Boolean) ?? "";
  return line.slice(0, 240);
}

const relative = (cwd: string | null) => (path: string) => (cwd && path.startsWith(`${cwd}/`) ? path.slice(cwd.length + 1) : path);
const unique = <T>(items: T[]) => [...new Set(items)];

/** The package files each step opened, index 0 being step 1. */
type Opened = readonly string[][];

function spanEvidence(entries: ToolEntry[], opened: Opened, from: number, to: number, cwd: string | null): string[] {
  const inside = entries.filter((entry) => entry.step >= from && entry.step <= to);
  const commands = unique(
    inside
      .map((entry) => commandOf(entry.use))
      .filter((command) => command !== null)
      .filter((command) => isTestRun(command) || isTypecheckRun(command)),
  );
  const firstFailure = inside.find((entry) => failed(entry) && commandOf(entry.use) !== null);
  const errors = unique(inside.flatMap((entry) => (entry.result ? errorsIn(entry.result.text) : [])));
  const files = unique(inside.flatMap((entry) => opened[entry.step - 1] ?? []));
  const edited = unique(inside.filter((entry) => entry.use.name === "Write" || entry.use.name === "Edit").flatMap((entry) => pathsOf(entry.use).map(relative(cwd))));
  return [
    ...commands.slice(0, 2).map((command) => `ran \`${command.slice(0, 120)}\``),
    ...(firstFailure?.result ? [`first failure: ${leadOf(firstFailure.result.text)}`] : []),
    ...errors.slice(0, 3).map((message) => `package error: ${message}`),
    ...(files.length ? [`opened ${files.slice(0, 5).join(", ")}`] : []),
    ...(edited.length ? [`edited ${edited.slice(0, 5).join(", ")}`] : []),
  ];
}

function checkMoments(entries: ToolEntry[], opened: Opened, cwd: string | null): Moment[] {
  const moments: Moment[] = [];
  for (const [label, isRun] of [
    ["the tests", isTestRun],
    ["the typecheck", isTypecheckRun],
  ] as const) {
    const runs = entries.filter((entry) => {
      const command = commandOf(entry.use);
      return command !== null && isRun(command) && entry.result !== null;
    });
    let firstFail: ToolEntry | null = null;
    let fails = 0;
    for (const run of runs) {
      if (failed(run)) {
        firstFail ??= run;
        fails += 1;
        continue;
      }
      if (firstFail && fails >= STUCK_AFTER) {
        moments.push({
          kind: "stuck",
          step: firstFail.step,
          until: run.step,
          what: `${label} failed ${fails} times in a row, between steps ${firstFail.step} and ${run.step}, before passing`,
          evidence: spanEvidence(entries, opened, firstFail.step, run.step, cwd),
        });
      }
      firstFail = null;
      fails = 0;
    }
    if (firstFail) {
      const last = entries.at(-1)!.step;
      moments.push({
        kind: "never-passed",
        step: firstFail.step,
        until: last,
        what: `${label} failed ${fails} time${fails === 1 ? "" : "s"} from step ${firstFail.step} and never passed again`,
        evidence: spanEvidence(entries, opened, firstFail.step, last, cwd),
      });
    }
  }
  return moments;
}

function docMoments(entries: ToolEntry[], opened: Opened): Moment[] {
  const moments: Moment[] = [];
  const seen = new Map<string, number>();
  for (const entry of entries) {
    for (const file of opened[entry.step - 1] ?? []) {
      const times = (seen.get(file) ?? 0) + 1;
      seen.set(file, times);
      if (isImplementation(file) && times === 1) {
        moments.push({ kind: "read-implementation", step: entry.step, until: null, what: `opened the compiled ${file} at step ${entry.step}`, evidence: [`opened ${file}`] });
      } else if (/\.md$/.test(file) && times === 2) {
        moments.push({ kind: "reread", step: entry.step, until: null, what: `went back to ${file} at step ${entry.step}`, evidence: [`opened ${file} again`] });
      }
    }
  }
  return moments;
}

function asides(timeline: Entry[]): Moment[] {
  const moments: Moment[] = [];
  const said = new Set<string>();
  for (const entry of timeline) {
    if (entry.kind !== "said") continue;
    for (const sentence of entry.text.split(/(?<=[.!?])\s+|\n+/)) {
      const words = sentence.trim().slice(0, 240);
      if (!HEDGE.test(words) || said.has(words)) continue;
      said.add(words);
      moments.push({ kind: "aside", step: entry.step, until: null, what: `said, after step ${entry.step}: “${words}”`, evidence: [`said: ${words}`] });
    }
  }
  return moments.slice(0, MAX_ASIDES);
}

export function momentsOf(t: Transcript): Moment[] {
  const entries = t.timeline.filter((entry): entry is ToolEntry => entry.kind === "tool");
  if (entries.length === 0) return [];
  const cwd = t.init?.cwd ?? null;
  const opened = packageFilesByStep(t);
  return [...checkMoments(entries, opened, cwd), ...docMoments(entries, opened), ...asides(t.timeline)].sort((a, b) => a.step - b.step || a.kind.localeCompare(b.kind));
}

const PRIORITY: MomentKind[] = ["never-passed", "stuck", "read-implementation", "reread", "aside"];

/** The moments worth an interview question, at most `max`, the hardest kinds first, then told in session order. */
export function forInterview(moments: readonly Moment[], max = 10): Moment[] {
  return [...moments]
    .sort((a, b) => PRIORITY.indexOf(a.kind) - PRIORITY.indexOf(b.kind) || a.step - b.step)
    .slice(0, max)
    .sort((a, b) => a.step - b.step);
}

export interface Note {
  text: string;
  /** The step whose tool call wrote it, when it can be found. */
  step: number | null;
}

/** What a tool call wrote: a file's content, an edit's new text, a shell command's words. */
function written(entry: ToolEntry): string {
  const input = entry.use.input;
  return [input.content, input.new_string, commandOf(entry.use)].filter((value) => typeof value === "string").join("\n");
}

/** The think-aloud log, one entry per line, each placed at the first step that wrote it. */
export function notesOf(text: string | null, t: Transcript): Note[] {
  if (!text) return [];
  const entries = t.timeline.filter((entry): entry is ToolEntry => entry.kind === "tool");
  return text
    .split("\n")
    .map((line) => line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "").trim())
    .filter((line) => line !== "" && !line.startsWith("#"))
    .map((line) => ({ text: line, step: entries.find((entry) => written(entry).includes(line))?.step ?? null }));
}

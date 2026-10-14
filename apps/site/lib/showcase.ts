/**
 * The front page's code carousel: a few sketches, one per thing people build
 * with knew, each showing the idea and the values it produces. They are not
 * the API (the guide is): the calls are simplified by `showcase/kit.ts`.
 *
 * Each is a file in `showcase/`, compiled by the site's typecheck and run here
 * when the site builds. The model's reading of each note is scripted; every
 * value shown after it is the engine's own output, so the page changes when
 * the engine does.
 *
 * In a file, a line ending in `// hidden`, or a block between `// hidden:start`
 * and `// hidden:end`, runs but isn't shown: the imports, the notebook, the
 * script. A `show(expression);` line is shown as the expression, with the value
 * it produced under it, and every `await` is left out.
 *
 * This runs at build time, in server components only.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import friend from "../showcase/friend";
import type { Show } from "../showcase/kit";
import place from "../showcase/place";
import regular from "../showcase/regular";

export type Token = { readonly kind: "plain" | "comment" | "string"; readonly text: string };

export type Segment =
  | { readonly kind: "code"; readonly tokens: readonly Token[]; /** Set apart from the value above it, as the source was. */ readonly spaced: boolean }
  | { readonly kind: "value"; readonly text: string };

export interface Scenario {
  readonly id: string;
  readonly title: string;
  readonly blurb: string;
  readonly file: string;
  readonly segments: readonly Segment[];
}

const SHOWCASE = [
  {
    id: "friend",
    title: "Remember a friend",
    blurb: "One note becomes a page of dated facts and specific things to learn next. A second note answers two of them and opens a thread.",
    file: "friend.ts",
    run: friend,
  },
  {
    id: "regular",
    title: "Greet a regular",
    blurb: "A restaurant's goal for the same person: the allergy on every page, and a different first thing to learn.",
    file: "regular.ts",
    run: regular,
  },
  {
    id: "place",
    title: "Become a regular",
    blurb: "A jazz club you keep going back to. Each visit, knew points at what you haven't noticed yet, and later at what may have changed.",
    file: "place.ts",
    run: place,
  },
] as const satisfies ReadonlyArray<{ id: string; title: string; blurb: string; file: string; run: (show: Show) => Promise<void> }>;

const HIDDEN_LINE = /\/\/ hidden\s*$/;
const SHOW = /^(\s*)show\((.*)\);(\s*\/\/.*)?$/;

/** The lines as shown: hidden ones out, and the indentation they shared removed. */
export function shownLines(source: string): string[] {
  const lines: string[] = [];
  let hiding = false;
  for (const line of source.split("\n")) {
    if (/\/\/ hidden:start\s*$/.test(line)) hiding = true;
    else if (/\/\/ hidden:end\s*$/.test(line)) hiding = false;
    // A sketch waves away the awaits: what matters is what each call gives back.
    else if (!hiding && !HIDDEN_LINE.test(line)) lines.push(line.replace(/\bawait /g, ""));
  }
  const indent = Math.min(...lines.filter((line) => line.trim()).map((line) => line.match(/^ */)![0].length));
  const dedented = lines.map((line) => line.slice(indent));
  // No run of blank lines where something was hidden, and none at the ends.
  return dedented.filter((line, at) => line.trim() || (at > 0 && dedented[at - 1]!.trim())).join("\n").trim().split("\n");
}

/** A value as a reader would write it: dates as days, strings quoted, short lists on one line. */
export function formatValue(value: unknown, indent = ""): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (value instanceof Date) return JSON.stringify(value.toISOString().slice(0, 10));
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value !== "object") return String(value);
  const inner = indent + "  ";
  const entries = Array.isArray(value)
    ? value.map((item) => formatValue(item, inner))
    : Object.entries(value).map(([key, item]) => `${/^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key)}: ${formatValue(item, inner)}`);
  const [open, close] = Array.isArray(value) ? ["[", "]"] : ["{", "}"];
  if (entries.length === 0) return `${open}${close}`;
  const flat = Array.isArray(value) ? `[${entries.join(", ")}]` : `{ ${entries.join(", ")} }`;
  if (flat.length + indent.length <= 72 && !flat.includes("\n")) return flat;
  return `${open}\n${entries.map((entry) => `${inner}${entry},`).join("\n")}\n${indent}${close}`;
}

/** A shown value: text with lines of its own (a page) as it reads, anything else as a literal. */
const shownValue = (value: unknown) => (typeof value === "string" && value.includes("\n") ? value : formatValue(value));

const TOKEN = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)/g;

/** Just enough highlighting for a black-and-white page: comments and strings. */
export function tokenize(code: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  for (const match of code.matchAll(TOKEN)) {
    if (match.index > last) tokens.push({ kind: "plain", text: code.slice(last, match.index) });
    tokens.push({ kind: match[1] ? "comment" : "string", text: match[0] });
    last = match.index + match[0].length;
  }
  if (last < code.length) tokens.push({ kind: "plain", text: code.slice(last) });
  return tokens;
}

/** The code as shown, each `show(…)` line its expression with the value after it, in order. */
export function segmentsOf(source: string, values: readonly unknown[]): Segment[] {
  const segments: Segment[] = [];
  let code: string[] = [];
  let shown = 0;
  const flush = () => {
    // After a value, a blank line in the source becomes space above the code, not an empty line.
    let spaced = false;
    if (segments.at(-1)?.kind === "value") {
      while (code[0]?.trim() === "") {
        code.shift();
        spaced = true;
      }
    }
    if (code.length > 0) segments.push({ kind: "code", tokens: tokenize(code.join("\n")), spaced });
    code = [];
  };
  for (const line of shownLines(source)) {
    const match = SHOW.exec(line);
    if (!match) {
      code.push(line);
      continue;
    }
    if (shown >= values.length) throw new Error(`the showcase shows more lines than its run produced values`);
    code.push(`${match[1]}${match[2]}${match[3] ?? ""}`);
    flush();
    segments.push({ kind: "value", text: shownValue(values[shown]) });
    shown += 1;
  }
  flush();
  if (shown !== values.length) throw new Error(`the showcase run produced ${values.length} values for ${shown} show lines`);
  return segments;
}

export function readShowcase(file: string): string {
  return readFileSync(/*turbopackIgnore: true*/ join(/*turbopackIgnore: true*/ process.cwd(), "showcase", file), "utf8");
}

export async function scenarios(): Promise<Scenario[]> {
  const all: Scenario[] = [];
  for (const entry of SHOWCASE) {
    const values: unknown[] = [];
    await entry.run((value) => values.push(value));
    all.push({ id: entry.id, title: entry.title, blurb: entry.blurb, file: entry.file, segments: segmentsOf(readShowcase(entry.file), values) });
  }
  return all;
}

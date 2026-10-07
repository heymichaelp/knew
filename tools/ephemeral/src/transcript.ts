/**
 * Reading a `claude -p --output-format stream-json` transcript: pure, and
 * tolerant of what it does not know. Every line is an event — `system`
 * (`init` first), `assistant` and `user` messages, and a closing `result`
 * unless the session was killed. Unknown event types and unparsable lines are
 * counted, never fatal.
 */

export interface ToolUse {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  toolUseId: string;
  isError: boolean;
  text: string;
}

export interface InitEvent {
  sessionId: string | null;
  cwd: string | null;
  model: string | null;
  tools: string[];
  mcpServers: unknown[];
  slashCommands: string[];
  skills: string[];
  /** Plugins the session loaded, by name and where they came from (`builtin`, or a path). */
  plugins: Array<{ name: string; path: string }>;
  permissionMode: string | null;
  version: string | null;
}

export interface ResultEvent {
  subtype: string | null;
  isError: boolean;
  numTurns: number | null;
  costUsd: number | null;
  durationMs: number | null;
  permissionDenials: unknown[];
  text: string | null;
  structuredOutput: unknown;
  sessionId: string | null;
}

/**
 * The session in order: each tool call, numbered from 1 as a step, with what
 * it printed; and each thing the agent said, at the step it said it after.
 */
export type Entry = { kind: "tool"; step: number; use: ToolUse; result: ToolResult | null } | { kind: "said"; step: number; text: string };

export interface Transcript {
  init: InitEvent | null;
  result: ResultEvent | null;
  toolUses: ToolUse[];
  toolResults: ToolResult[];
  assistantText: string[];
  timeline: Entry[];
  /** Lines that were not JSON, and events of a type this reader does not know. */
  unparsed: number;
  unknown: number;
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string | null => (typeof value === "string" ? value : null);
const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((item) => (typeof item === "string" ? item : isObject(item) ? (str(item.name) ?? "") : "")).filter(Boolean) : [];

/** A tool result's content is a string or a list of blocks; only the text matters here. */
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => (isObject(block) && typeof block.text === "string" ? block.text : ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function parseInit(event: Json): InitEvent {
  return {
    sessionId: str(event.session_id),
    cwd: str(event.cwd),
    model: str(event.model),
    tools: strings(event.tools),
    mcpServers: Array.isArray(event.mcp_servers) ? event.mcp_servers : [],
    slashCommands: strings(event.slash_commands),
    skills: strings(event.skills),
    plugins: Array.isArray(event.plugins)
      ? event.plugins.filter(isObject).map((plugin) => ({ name: str(plugin.name) ?? "", path: str(plugin.path) ?? "" }))
      : [],
    permissionMode: str(event.permissionMode) ?? str(event.permission_mode),
    version: str(event.claude_code_version) ?? str(event.version),
  };
}

function parseResult(event: Json): ResultEvent {
  return {
    subtype: str(event.subtype),
    isError: event.is_error === true,
    numTurns: num(event.num_turns),
    costUsd: num(event.total_cost_usd) ?? num(event.cost_usd),
    durationMs: num(event.duration_ms),
    permissionDenials: Array.isArray(event.permission_denials) ? event.permission_denials : [],
    text: str(event.result),
    structuredOutput: event.structured_output ?? null,
    sessionId: str(event.session_id),
  };
}

/** Events as `runClaude` collected them, or as a transcript file stores them (`{ at, event }` per line). */
export function parseTranscript(events: readonly unknown[]): Transcript {
  const transcript: Transcript = { init: null, result: null, toolUses: [], toolResults: [], assistantText: [], timeline: [], unparsed: 0, unknown: 0 };
  const calls = new Map<string, Extract<Entry, { kind: "tool" }>>();
  for (const raw of events) {
    const event = isObject(raw) && "event" in raw && "at" in raw ? raw.event : raw;
    if (!isObject(event)) {
      transcript.unparsed += 1;
      continue;
    }
    const type = str(event.type);
    if (type === "unparsed") {
      transcript.unparsed += 1;
    } else if (type === "system") {
      if (event.subtype === "init") transcript.init = parseInit(event);
    } else if (type === "result") {
      transcript.result = parseResult(event);
    } else if (type === "assistant" || type === "user") {
      const message = isObject(event.message) ? event.message : null;
      const content = message && Array.isArray(message.content) ? message.content : typeof message?.content === "string" ? [{ type: "text", text: message.content }] : [];
      for (const block of content) {
        if (!isObject(block)) continue;
        if (block.type === "tool_use") {
          const use = { id: str(block.id) ?? "", name: str(block.name) ?? "", input: isObject(block.input) ? block.input : {} };
          transcript.toolUses.push(use);
          const entry = { kind: "tool" as const, step: transcript.toolUses.length, use, result: null };
          transcript.timeline.push(entry);
          calls.set(use.id, entry);
        } else if (block.type === "tool_result") {
          const result = { toolUseId: str(block.tool_use_id) ?? "", isError: block.is_error === true, text: textOf(block.content) };
          transcript.toolResults.push(result);
          const call = calls.get(result.toolUseId);
          if (call) call.result = result;
        } else if (block.type === "text" && type === "assistant" && typeof block.text === "string") {
          transcript.assistantText.push(block.text);
          transcript.timeline.push({ kind: "said", step: transcript.toolUses.length, text: block.text });
        }
      }
    } else {
      transcript.unknown += 1;
    }
  }
  return transcript;
}

/** A transcript file's lines, as `runClaude` wrote them. */
export function eventsFromFile(text: string): unknown[] {
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      try {
        return JSON.parse(line) as unknown;
      } catch {
        return { type: "unparsed", raw: line };
      }
    });
}

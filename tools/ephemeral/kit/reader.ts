import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * A real model, for a brief whose notes are read for real: one structured
 * call per request, through `claude -p` on the runner's login, with no tools,
 * no customisation and no saved session. Both arms of a reading brief read
 * through the same function and the same model, so what differs is what each
 * asks of it.
 *
 * Readings are recorded by request, so the dry run and the brief tests
 * replay them and never call a model:
 *
 *   KNEW_READING=live     call the model (an agent run's checker)
 *   KNEW_READING=record   answer from the cache, calling the model only for a request it has not seen, and keep what it answered
 *   KNEW_READING=replay   answer from the cache, and fail on a request it never saw (the default)
 *
 * KNEW_READING_CACHE names the cache file; KNEW_READER_MODEL the model.
 */

export interface ModelRequest {
  system: string;
  prompt: string;
  /** A JSON Schema the answer must match. */
  schema: object;
}

/** What a reading brief's baseline app is handed: a model that answers in JSON. */
export type Model = (request: ModelRequest) => Promise<unknown>;

export const DEFAULT_READER_MODEL = "claude-sonnet-5-5";

type Mode = "live" | "record" | "replay";

export interface Reader {
  model: Model;
  /** The calls made to a real model, and what they cost at API rates. */
  spent(): { calls: number; costUsd: number };
  /** Write recorded readings back, and clean up. */
  close(): void;
}

/** The CLI validates a schema against its own draft and rejects a `$schema` marker naming another; the shape is what matters. */
function forCli(schema: object): object {
  const { $schema: _marker, ...shape } = schema as Record<string, unknown>;
  return shape;
}

const keyOf = (model: string, request: ModelRequest) =>
  createHash("sha256").update(JSON.stringify([model, request.system, request.prompt, request.schema])).digest("hex");

/** The child's environment: enough to find the login, nothing of the caller's session. */
function readerEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ["PATH", "HOME", "USER", "LOGNAME", "LANG", "SHELL", "TMPDIR", "XDG_RUNTIME_DIR"]) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return { ...env, DISABLE_AUTOUPDATER: "1", CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" };
}

export function openReader(options: { mode?: Mode; cache?: string; model?: string } = {}): Reader {
  const mode = (options.mode ?? (process.env.KNEW_READING as Mode | undefined) ?? "replay") as Mode;
  const cachePath = options.cache ?? process.env.KNEW_READING_CACHE ?? null;
  const modelId = options.model ?? process.env.KNEW_READER_MODEL ?? DEFAULT_READER_MODEL;
  const cache: Record<string, unknown> = cachePath && existsSync(cachePath) ? (JSON.parse(readFileSync(cachePath, "utf8")) as Record<string, unknown>) : {};
  let dirty = false;
  let calls = 0;
  let costUsd = 0;
  let cwd: string | null = null;

  const live = (request: ModelRequest): unknown => {
    cwd ??= realpathSync(mkdtempSync(join(tmpdir(), "knew-ephemeral-reader-")));
    const result = spawnSync(
      "claude",
      [
        "-p",
        request.prompt,
        "--model",
        modelId,
        "--system-prompt",
        request.system,
        "--output-format",
        "json",
        "--json-schema",
        JSON.stringify(forCli(request.schema)),
        "--tools",
        "",
        "--safe-mode",
        "--strict-mcp-config",
        "--disable-slash-commands",
        "--no-session-persistence",
        "--max-budget-usd",
        "1",
      ],
      { cwd, encoding: "utf8", env: readerEnv(), timeout: 180_000, maxBuffer: 16 * 1024 * 1024 },
    );
    calls += 1;
    let answer: { structured_output?: unknown; result?: string; total_cost_usd?: number; is_error?: boolean } = {};
    try {
      answer = JSON.parse(result.stdout ?? "") as typeof answer;
    } catch {
      throw new Error(`the reader model answered nothing readable: ${(result.stderr ?? "").slice(-400) || (result.stdout ?? "").slice(-400)}`);
    }
    costUsd += answer.total_cost_usd ?? 0;
    if (answer.is_error) throw new Error(`the reader model failed: ${String(answer.result ?? "").slice(0, 400)}`);
    if (answer.structured_output !== undefined) return answer.structured_output;
    try {
      return JSON.parse(answer.result ?? "");
    } catch {
      throw new Error(`the reader model's answer was not JSON: ${String(answer.result ?? "").slice(0, 400)}`);
    }
  };

  const model: Model = async (request) => {
    const key = keyOf(modelId, request);
    if (mode === "replay" || (mode === "record" && key in cache)) {
      if (!(key in cache)) throw new Error(`no recorded reading for this request (${key.slice(0, 12)}); record readings with KNEW_READING=record`);
      return structuredClone(cache[key]);
    }
    const answer = live(request);
    if (mode === "record") {
      cache[key] = answer;
      dirty = true;
    }
    return structuredClone(answer);
  };

  return {
    model,
    spent: () => ({ calls, costUsd }),
    close() {
      if (dirty && cachePath) {
        const sorted = Object.fromEntries(Object.entries(cache).sort(([a], [b]) => a.localeCompare(b)));
        writeFileSync(cachePath, `${JSON.stringify(sorted, null, 2)}\n`);
      }
      if (cwd) rmSync(cwd, { recursive: true, force: true });
    },
  };
}

import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { CheckResult } from "../kit/check-kit.ts";
import { BRIEFS, SCAFFOLD_COMPILER_OPTIONS, WORKSPACE } from "./prep.ts";

/**
 * Running a brief's hidden checker. It goes into the app only once the agent
 * is finished — the agent never sees it — and runs in a child process with
 * the app's own tsx, so it judges the tarball the app installed.
 */

/** The scaffold's tsconfig, untouched, for typechecking an app whose own tsconfig the agent may have loosened. */
export function untouchedTsconfig(): string {
  return `${JSON.stringify({ compilerOptions: SCAFFOLD_COMPILER_OPTIONS, include: ["../src", "../test"] }, null, 2)}\n`;
}

/** Lay the checker, the kit and the untouched tsconfig into `<dir>/.check/`, keeping the kit's relative path from the checker. */
export function layChecker(dir: string, brief: string): void {
  const into = join(dir, ".check");
  mkdirSync(join(into, "briefs", brief), { recursive: true });
  cpSync(join(BRIEFS, brief, "check.ts"), join(into, "briefs", brief, "check.ts"));
  cpSync(join(WORKSPACE, "kit"), join(into, "kit"), { recursive: true });
  writeFileSync(join(into, "tsconfig.json"), untouchedTsconfig());
}

/** This process's environment for the checker, minus a test runner's context, which would turn the app's nested test run into a report to nobody. */
function checkerEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_OPTIONS: "" };
  delete env.NODE_TEST_CONTEXT;
  return env;
}

/** Run a brief's checker against an app directory in a child process, and read back its JSON. */
export function runChecker(dir: string, brief: string, options: { typecheck: boolean; timeoutMs?: number }): CheckResult {
  layChecker(dir, brief);
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", join(".check", "kit", "run-check.ts"), join(".check", "briefs", brief, "check.ts"), dir, options.typecheck ? "1" : "0"],
    { cwd: dir, encoding: "utf8", timeout: options.timeoutMs ?? 600_000, env: checkerEnv() },
  );
  const line = (result.stdout ?? "").trim().split("\n").filter(Boolean).pop();
  try {
    if (line) return JSON.parse(line) as CheckResult;
  } catch {
    /* fall through */
  }
  const why = result.error ? result.error.message : `${result.stderr ?? ""}`.slice(-2000) || "it printed no result";
  return { passed: false, checks: [{ name: "the checker ran", passed: false, detail: why }] };
}

/** Run a brief's checker in this process, against a directory whose `@popjoker/knew` resolves to the same copy this process sees. */
export async function checkInProcess(dir: string, brief: string, options: { typecheck: boolean; appTests?: boolean }): Promise<CheckResult> {
  const module = (await import(pathToFileURL(join(BRIEFS, brief, "check.ts")).href)) as {
    check: (dir: string, options: { typecheck: boolean; appTests?: boolean }) => Promise<CheckResult>;
  };
  return module.check(dir, options);
}

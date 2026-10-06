import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { briefHash, briefNames, loadBrief } from "./brief.ts";
import { runChecker } from "./check.ts";
import {
  BUILD_PROMPT,
  DEBRIEF_PROMPT,
  DEBRIEF_SCHEMA,
  DEFAULT_MODEL,
  TOOLS,
  buildArgs,
  cliVersion,
  debriefArgs,
  killStragglers,
  purge,
  runClaude,
} from "./claude.ts";
import { classify, contaminationOf, isolationProblems, measure, sourceMetrics } from "./metrics.ts";
import { BRIEFS, REPO, WORKSPACE, layBrief, packTarball, prepareDir, removeDir, tarballAt, type Tarball } from "./prep.ts";
import { archiveTree, printTable, summaryMarkdown, verifyDebrief, writeRun, type RunRecord } from "./report.ts";
import { parseTranscript } from "./transcript.ts";

/**
 * The harness's three commands:
 *
 *   agent      a model builds each brief's app; checked, debriefed, measured, reported
 *   dry-run    each brief's reference solution stands in for the agent; no model is called
 *   preflight  two tiny real sessions proving the clean room and the budget cap work
 *
 * Model runs spend real money (on a Claude login, against its limits) and so
 * never run in CI; the dry run does.
 */

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    brief: { type: "string", multiple: true },
    runs: { type: "string" },
    model: { type: "string" },
    effort: { type: "string" },
    budget: { type: "string" },
    "timeout-min": { type: "string" },
    tarball: { type: "string", multiple: true },
    keep: { type: "boolean" },
    "save-fixture": { type: "boolean" },
    help: { type: "boolean", short: "h" },
  },
});

const USAGE = [
  "usage: cli.ts <command> [options]",
  "",
  "  agent       a model builds each brief's app; it is checked, debriefed, measured and reported",
  "  dry-run     each brief's reference solution stands in for the agent; no model is called",
  "  preflight   two tiny real sessions prove the clean room and the budget cap",
  "",
  "  --brief <name>     one brief (repeatable; default every brief)",
  "  --runs <n>         runs per brief (default 1)",
  "  --model <id>       builder model (default claude-opus-5-5)",
  "  --effort <level>   builder effort (default the CLI's)",
  "  --budget <usd>     cap for the whole pass (default 30)",
  "  --timeout-min <m>  wall clock per build (default the brief's)",
  "  --tarball <path>   test this tarball instead of packing (repeatable, for A/B)",
  "  --keep             keep the throwaway directories",
  "  --save-fixture     preflight: save its transcript, redacted, as the test fixture",
].join("\n");

const log = (line: string) => process.stdout.write(`${line}\n`);
const hash = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 16);
const PROMPT_HASH = hash(`${BUILD_PROMPT}\n${DEBRIEF_PROMPT}\n${JSON.stringify(DEBRIEF_SCHEMA)}`);

function gitState(): { sha: string; dirty: boolean } {
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO, encoding: "utf8" }).trim();
  const status = execFileSync("git", ["status", "--porcelain"], { cwd: REPO, encoding: "utf8" }).trim();
  return { sha, dirty: status !== "" };
}

/** The tarballs under test: the ones named, or one packed fresh into a directory `done` removes. */
function tarballs(): { packed: Tarball[]; done: () => void } {
  if (values.tarball && values.tarball.length > 0) return { packed: values.tarball.map((path) => tarballAt(realpathSync(path))), done: () => {} };
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "knew-ephemeral-pack-")));
  return { packed: [packTarball(dir)], done: () => removeDir(dir) };
}

/** Your skills' names, so a session that loaded one of them is caught. */
function personalSkills(): string[] {
  const dir = join(homedir(), ".claude", "skills");
  return existsSync(dir) ? readdirSync(dir) : [];
}

function zodVersion(dir: string): string | null {
  try {
    return (JSON.parse(readFileSync(join(dir, "node_modules", "zod", "package.json"), "utf8")) as { version: string }).version;
  } catch {
    return null;
  }
}

function structured(result: { structuredOutput: unknown; text: string | null } | null): unknown {
  if (!result) return null;
  if (result.structuredOutput) return result.structuredOutput;
  try {
    return result.text ? JSON.parse(result.text) : null;
  } catch {
    return null;
  }
}

async function agent(): Promise<void> {
  const names = values.brief ?? briefNames();
  const runs = Number(values.runs ?? 1);
  const model = values.model ?? DEFAULT_MODEL;
  const passBudget = Number(values.budget ?? 30);
  const git = gitState();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportRoot = join(WORKSPACE, "reports", `${stamp}-${git.sha.slice(0, 8)}${git.dirty ? "-dirty" : ""}`);
  const cli = cliVersion();
  const skills = personalSkills();
  const { packed, done } = tarballs();
  const records: RunRecord[] = [];
  let spent = 0;
  log(`ephemeral: ${names.join(", ")} × ${runs} on ${model} (CLI ${cli}), pass budget $${passBudget}, reports in ${reportRoot}`);

  // Interleaved — run by run, tarball by tarball — so an A/B comparison shares its conditions.
  for (let run = 1; run <= runs; run += 1) {
    for (const tarball of packed) {
      for (const name of names) {
        if (spent >= passBudget) {
          log(`the pass budget of $${passBudget} is spent; no more runs start`);
          break;
        }
        const brief = loadBrief(name);
        const label = packed.length > 1 ? `${name}-${tarball.sha256.slice(0, 8)}` : name;
        const out = join(reportRoot, label, String(run));
        mkdirSync(out, { recursive: true });
        log(`→ ${label} #${run}: preparing`);
        const prepared = prepareDir(name, tarball);
        layBrief(prepared.dir, name, brief.inputs);
        const sessionId = randomUUID();
        const budgetUsd = Math.min(brief.budgetUsd, passBudget - spent);
        log(`  building (cap $${budgetUsd.toFixed(2)}, ${brief.timeoutMin} min)`);
        const build = await runClaude(buildArgs({ sessionId, model, effort: values.effort, budgetUsd }), {
          cwd: prepared.dir,
          transcriptPath: join(out, "transcript.jsonl"),
          timeoutMs: Number(values["timeout-min"] ?? brief.timeoutMin) * 60_000,
          idleMs: 10 * 60_000,
        });
        killStragglers(prepared.dir);
        const transcript = parseTranscript(build.events);
        spent += transcript.result?.costUsd ?? 0;

        log("  debriefing");
        const debrief = await runClaude(debriefArgs({ sessionId, model, budgetUsd: 1 }), {
          cwd: prepared.dir,
          transcriptPath: join(out, "debrief.jsonl"),
          timeoutMs: 5 * 60_000,
          idleMs: 3 * 60_000,
        });
        killStragglers(prepared.dir);
        const debriefResult = parseTranscript(debrief.events).result;
        spent += debriefResult?.costUsd ?? 0;

        log("  checking");
        const check = runChecker(prepared.dir, name, { typecheck: true });
        const metrics = measure(transcript);
        const isolation = isolationProblems(transcript, { tools: TOOLS, model, cwd: prepared.dir, personalSkills: skills });
        const contamination = contaminationOf(transcript, { runDir: prepared.dir, repo: REPO, home: homedir() });
        const verdict = classify({
          contamination,
          isolation,
          timedOut: build.timedOut || build.idledOut,
          resultSubtype: transcript.result?.subtype ?? null,
          resultIsError: transcript.result?.isError ?? false,
          hasResult: transcript.result !== null,
          checkPassed: check.passed,
        });
        const record: RunRecord = {
          identity: {
            brief: name,
            briefVersion: brief.version,
            briefHash: briefHash(brief),
            run,
            model: transcript.init?.model ?? model,
            effort: values.effort ?? null,
            cliVersion: transcript.init?.version ?? cli,
            tarballSha256: tarball.sha256,
            gitSha: git.sha,
            dirty: git.dirty,
            promptHash: PROMPT_HASH,
            zodVersion: zodVersion(prepared.dir),
          },
          ...verdict,
          timedOut: build.timedOut || build.idledOut,
          budgetHit: transcript.result?.subtype?.includes("budget") ?? false,
          durationMs: build.durationMs,
          metrics,
          source: sourceMetrics(prepared.dir, prepared.scaffold),
          isolation,
          contamination,
          check,
          debrief: verifyDebrief(structured(debriefResult), transcript),
        };
        writeRun(out, record);
        archiveTree(prepared.dir, out);
        purge(prepared.dir);
        if (!values.keep) removeDir(prepared.dir);
        records.push(record);
        log(`  ${record.outcome}: ${record.reason} — $${(metrics.costUsd ?? 0).toFixed(2)}, ${metrics.turns ?? "?"} turns, ${(build.durationMs / 60_000).toFixed(1)} min`);
      }
    }
  }
  done();
  mkdirSync(reportRoot, { recursive: true });
  writeFileSync(join(reportRoot, "summary.md"), summaryMarkdown(records, { stamp, gitSha: git.sha, dirty: git.dirty, model }));
  log("");
  printTable(records);
  log(`\nsummary: ${join(reportRoot, "summary.md")} (spent about $${spent.toFixed(2)} at API rates)`);
}

/** Every brief's reference solution through its checker, against one packed install: the deterministic half, for CI. */
function dryRun(): void {
  const names = values.brief ?? briefNames();
  const { packed, done } = tarballs();
  const install = prepareDir("dry-run", packed[0]!);
  let failed = 0;
  try {
    for (const name of names) {
      const brief = loadBrief(name);
      const dir = join(install.dir, name);
      cpSync(join(BRIEFS, name, "reference"), dir, { recursive: true });
      layBrief(dir, name, brief.inputs);
      const result = runChecker(dir, name, { typecheck: true });
      log(`${result.passed ? "✓" : "✗"} ${name} (v${brief.version}): ${result.checks.filter((c) => c.passed).length}/${result.checks.length} checks`);
      for (const check of result.checks.filter((c) => !c.passed)) log(`    ✗ ${check.name}: ${check.detail.split("\n").slice(0, 6).join("\n      ")}`);
      if (!result.passed) failed += 1;
    }
  } finally {
    if (!values.keep) removeDir(install.dir);
    done();
  }
  if (failed > 0) {
    log(`${failed} brief(s) failed against their own reference`);
    process.exit(1);
  }
}

const PREFLIGHT_PROMPT =
  "Create a file named hello.txt containing exactly the word ready, then run " +
  "`node -e \"process.stdout.write(require('fs').readFileSync('hello.txt', 'utf8'))\"` with Bash, and stop.";

/** Two tiny real sessions with the harness's exact flags: one proves the clean room works, one proves the budget cap trips. */
async function preflight(): Promise<void> {
  const model = values.model ?? DEFAULT_MODEL;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const out = join(WORKSPACE, "reports", `preflight-${stamp}`);
  mkdirSync(out, { recursive: true });
  const results: Array<[string, boolean, string]> = [];
  const expect = (name: string, ok: boolean, detail = "") => {
    results.push([name, ok, detail]);
    log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  };
  const cli = cliVersion();
  log(`preflight: CLI ${cli}, model ${model}`);

  const dir = realpathSync(mkdtempSync(join(tmpdir(), "knew-ephemeral-preflight-")));
  const sessionId = randomUUID();
  const run = await runClaude(buildArgs({ sessionId, model, budgetUsd: 1 }, PREFLIGHT_PROMPT), {
    cwd: dir,
    transcriptPath: join(out, "transcript.jsonl"),
    timeoutMs: 5 * 60_000,
    idleMs: 3 * 60_000,
  });
  killStragglers(dir);
  const transcript = parseTranscript(run.events);
  const init = run.events.find((e) => typeof e === "object" && e !== null && (e as { type?: string }).type === "system") as Record<string, unknown> | undefined;
  const result = run.events.find((e) => typeof e === "object" && e !== null && (e as { type?: string }).type === "result") as Record<string, unknown> | undefined;
  log(`  init keys: ${init ? Object.keys(init).join(", ") : "none"}`);
  log(`  result keys: ${result ? Object.keys(result).join(", ") : "none"}`);
  expect("the session reported init and result", transcript.init !== null && transcript.result !== null, `exit ${run.exitCode}${run.stderr ? `; stderr: ${run.stderr.slice(-300)}` : ""}`);
  const isolation = isolationProblems(transcript, { tools: TOOLS, model, cwd: dir, personalSkills: personalSkills() });
  expect("the init event matches the clean room asked for", isolation.length === 0, isolation.join("; ") || `tools ${transcript.init?.tools.join(",")}`);
  expect("no permission was denied", (transcript.result?.permissionDenials.length ?? 0) === 0, JSON.stringify(transcript.result?.permissionDenials ?? []).slice(0, 300));
  const wrote = existsSync(join(dir, "hello.txt")) && readFileSync(join(dir, "hello.txt"), "utf8").trim() === "ready";
  expect("a file was written in the run directory", wrote);
  const ranNode = transcript.toolUses.some((use) => use.name === "Bash" && String(use.input.command ?? "").includes("node -e"));
  expect("Bash ran node -e", ranNode);
  expect("cost and turns were reported", transcript.result?.costUsd != null && transcript.result?.numTurns != null, `$${transcript.result?.costUsd ?? "?"}, ${transcript.result?.numTurns ?? "?"} turns`);

  const debrief = await runClaude(debriefArgs({ sessionId, model, budgetUsd: 0.5 }), { cwd: dir, timeoutMs: 3 * 60_000, idleMs: 2 * 60_000 });
  const debriefResult = parseTranscript(debrief.events).result;
  const answered = structured(debriefResult);
  expect("the debrief resumed the session and answered in the schema", typeof answered === "object" && answered !== null && "guessed" in answered, JSON.stringify(answered).slice(0, 200));

  const poorDir = realpathSync(mkdtempSync(join(tmpdir(), "knew-ephemeral-preflight-budget-")));
  const poor = await runClaude(buildArgs({ sessionId: randomUUID(), model, budgetUsd: 0.0001 }, PREFLIGHT_PROMPT), { cwd: poorDir, timeoutMs: 3 * 60_000, idleMs: 2 * 60_000 });
  const poorResult = parseTranscript(poor.events).result;
  expect("the budget cap trips", poorResult?.subtype?.includes("budget") === true, `result subtype ${poorResult?.subtype ?? "none"}, is_error ${poorResult?.isError ?? "?"}`);

  for (const target of [dir, poorDir]) {
    killStragglers(target);
    purge(target);
    removeDir(target);
  }
  const projects = join(homedir(), ".claude", "projects");
  const leftovers = existsSync(projects) ? readdirSync(projects).filter((name) => name.includes("knew-ephemeral-preflight")) : [];
  expect("purge left nothing of the sessions behind", leftovers.length === 0, leftovers.join(", "));

  if (values["save-fixture"]) {
    const fixture = readFileSync(join(out, "transcript.jsonl"), "utf8").replaceAll(dir, "/RUN").replaceAll(homedir(), "/HOME");
    mkdirSync(join(WORKSPACE, "test", "fixtures"), { recursive: true });
    writeFileSync(join(WORKSPACE, "test", "fixtures", "preflight.jsonl"), fixture);
    log("  saved the transcript, redacted, as test/fixtures/preflight.jsonl");
  }
  const failed = results.filter(([, ok]) => !ok).length;
  log(failed === 0 ? "preflight passed" : `${failed} preflight check(s) failed`);
  if (failed > 0) process.exit(1);
}

const commands: Record<string, () => unknown> = { agent, "dry-run": dryRun, preflight };
const command = positionals[0] ?? "";
if (values.help) {
  log(USAGE);
  process.exit(0);
}
if (!(command in commands)) {
  process.stderr.write(`${USAGE}\n`);
  process.exit(2);
}
await commands[command]!();

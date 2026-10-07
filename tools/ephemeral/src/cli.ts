import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { briefHash, briefNames, changeFileOf, loadBrief, referenceOf, type Brief } from "./brief.ts";
import { checkInCopy, runChecker, type Phase } from "./check.ts";
import {
  DEBRIEF_SCHEMA,
  DEFAULT_MODEL,
  TOOLS,
  buildArgs,
  buildPrompt,
  changeArgs,
  cliVersion,
  debriefArgs,
  debriefPrompt,
  killStragglers,
  purge,
  runClaude,
} from "./claude.ts";
import { findingsOf } from "./findings.ts";
import { classify, contaminationOf, isolationProblems, measure, sourceMetrics } from "./metrics.ts";
import { forInterview, momentsOf, notesOf } from "./moments.ts";
import { packageNames } from "./names.ts";
import { BRIEFS, REPO, WORKSPACE, installForCheck, layBrief, packTarball, prepareDir, removeDir, tarballAt, type Arm, type Tarball } from "./prep.ts";
import { archiveTree, printTable, summaryMarkdown, verifyDebrief, writeRun, type RunRecord } from "./report.ts";
import { parseTranscript } from "./transcript.ts";

/**
 * The harness's three commands:
 *
 *   agent      a model builds each brief's app; checked, debriefed, measured, reported
 *              (with --arm baseline or both, a paired brief is also built with no knew;
 *              a brief with a CHANGE.md is then changed in the same session, and checked again)
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
    "think-aloud": { type: "boolean" },
    arm: { type: "string" },
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
  "  --think-aloud      the agent keeps NOTES.md as it works (changes its effort; off by default)",
  "  --arm <arm>        knew (default), baseline, or both: a paired brief built with no knew too",
  "  --save-fixture     preflight: save its transcript, redacted, as the test fixture",
].join("\n");

const log = (line: string) => process.stdout.write(`${line}\n`);
const hash = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 16);
/** The prompts a pass used, as a hash: the build prompt in its mode, and the debrief's template and schema. */
const promptHash = (thinkAloud: boolean, arm: Arm) => hash(`${buildPrompt(thinkAloud, arm)}\n${debriefPrompt([])}\n${JSON.stringify(DEBRIEF_SCHEMA)}`);

/** The arms to build a brief in: those asked for that it has. A brief with no `BASELINE.md` is built on knew only. */
function armsFor(brief: Brief): Arm[] {
  const asked = values.arm ?? "knew";
  if (!["knew", "baseline", "both"].includes(asked)) throw new Error(`--arm is knew, baseline or both, not ${asked}`);
  const wanted: Arm[] = asked === "both" ? ["knew", "baseline"] : [asked as Arm];
  return wanted.filter((arm) => brief.arms.includes(arm));
}

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
  const thinkAloud = values["think-aloud"] === true;
  const git = gitState();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportRoot = join(WORKSPACE, "reports", `${stamp}-${git.sha.slice(0, 8)}${git.dirty ? "-dirty" : ""}`);
  const cli = cliVersion();
  const skills = personalSkills();
  const { packed, done } = tarballs();
  const records: RunRecord[] = [];
  let spent = 0;
  log(`ephemeral: ${names.join(", ")} × ${runs} on ${model} (CLI ${cli})${thinkAloud ? ", thinking aloud" : ""}, pass budget $${passBudget}, reports in ${reportRoot}`);

  // Interleaved — run by run, tarball by tarball — so an A/B comparison shares its conditions.
  for (let run = 1; run <= runs; run += 1) {
    for (const tarball of packed) {
      for (const [name, arm] of names.flatMap((briefName) => armsFor(loadBrief(briefName)).map((each) => [briefName, each] as const))) {
        if (spent >= passBudget) {
          log(`the pass budget of $${passBudget} is spent; no more runs start`);
          break;
        }
        const brief = loadBrief(name);
        const label = `${name}${arm === "baseline" ? "-baseline" : ""}${packed.length > 1 ? `-${tarball.sha256.slice(0, 8)}` : ""}`;
        const out = join(reportRoot, label, String(run));
        mkdirSync(out, { recursive: true });
        log(`→ ${label} #${run}: preparing`);
        const prepared = prepareDir(arm === "knew" ? name : `${name}-baseline`, tarball, arm);
        layBrief(prepared.dir, name, brief.inputs, arm);
        const sessionId = randomUUID();
        const budgetUsd = Math.min(brief.budgetUsd, passBudget - spent);
        log(`  building (cap $${budgetUsd.toFixed(2)}, ${brief.timeoutMin} min)`);
        const build = await runClaude(buildArgs({ sessionId, model, effort: values.effort, budgetUsd }, buildPrompt(thinkAloud, arm)), {
          cwd: prepared.dir,
          transcriptPath: join(out, "transcript.jsonl"),
          timeoutMs: Number(values["timeout-min"] ?? brief.timeoutMin) * 60_000,
          idleMs: 10 * 60_000,
        });
        killStragglers(prepared.dir);
        const transcript = parseTranscript(build.events);
        spent += transcript.result?.costUsd ?? 0;

        const moments = momentsOf(transcript);
        const asked = forInterview(moments);
        const notesFile = join(prepared.dir, "NOTES.md");
        const notes = thinkAloud ? notesOf(existsSync(notesFile) ? readFileSync(notesFile, "utf8") : null, transcript) : null;

        // A brief that changes: check the build as it stands, then hand the same session the change.
        let change: RunRecord["change"] = null;
        if (brief.changes) {
          log("  checking the build");
          const checkBefore = checkInCopy(prepared.dir, name, { arm, phase: 1, tarball });
          copyFileSync(join(BRIEFS, name, changeFileOf(arm)), join(prepared.dir, "CHANGE.md"));
          const changeBudget = Math.min(brief.budgetUsd, passBudget - spent);
          log(`  changing (${checkBefore.passed ? "the build passed" : "the build did not pass"}; cap $${changeBudget.toFixed(2)})`);
          const changed = await runClaude(changeArgs({ sessionId, model, effort: values.effort, budgetUsd: changeBudget }), {
            cwd: prepared.dir,
            transcriptPath: join(out, "change.jsonl"),
            timeoutMs: Number(values["timeout-min"] ?? brief.timeoutMin) * 60_000,
            idleMs: 10 * 60_000,
          });
          killStragglers(prepared.dir);
          const changeTranscript = parseTranscript(changed.events);
          spent += changeTranscript.result?.costUsd ?? 0;
          change = {
            metrics: measure(changeTranscript),
            durationMs: changed.durationMs,
            timedOut: changed.timedOut || changed.idledOut,
            checkBefore,
            isolation: isolationProblems(changeTranscript, { tools: TOOLS, model, cwd: prepared.dir, personalSkills: skills }),
            contamination: contaminationOf(changeTranscript, { runDir: prepared.dir, repo: REPO, home: homedir() }),
          };
        }

        // A baseline run is measured, not interviewed: its questions are about knew, which it never had.
        let debriefResult: ReturnType<typeof parseTranscript>["result"] = null;
        if (arm === "knew") {
          log(`  debriefing (${asked.length} moment${asked.length === 1 ? "" : "s"} to ask about)`);
          const debrief = await runClaude(debriefArgs({ sessionId, model, budgetUsd: 1 }, debriefPrompt(asked)), {
            cwd: prepared.dir,
            transcriptPath: join(out, "debrief.jsonl"),
            timeoutMs: 5 * 60_000,
            idleMs: 3 * 60_000,
          });
          killStragglers(prepared.dir);
          debriefResult = parseTranscript(debrief.events).result;
          spent += debriefResult?.costUsd ?? 0;
        }

        log("  checking");
        if (arm === "baseline") installForCheck(prepared.dir, tarball);
        const check = runChecker(prepared.dir, name, { typecheck: true, arm, phase: brief.changes ? 2 : 1 });
        const metrics = measure(transcript);
        const isolation = [...isolationProblems(transcript, { tools: TOOLS, model, cwd: prepared.dir, personalSkills: skills }), ...(change?.isolation ?? [])];
        const contamination = [...contaminationOf(transcript, { runDir: prepared.dir, repo: REPO, home: homedir() }), ...(change?.contamination ?? [])];
        const verdict = classify({
          contamination,
          isolation,
          timedOut: build.timedOut || build.idledOut || (change?.timedOut ?? false),
          resultSubtype: transcript.result?.subtype ?? null,
          resultIsError: transcript.result?.isError ?? false,
          hasResult: transcript.result !== null,
          checkPassed: check.passed,
        });
        const record: RunRecord = {
          change,
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
            promptHash: promptHash(thinkAloud, arm),
            zodVersion: arm === "knew" ? zodVersion(prepared.dir) : null,
            thinkAloud,
            arm,
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
          moments,
          asked,
          notes,
          debrief: arm === "knew" ? verifyDebrief(structured(debriefResult), transcript, asked) : null,
        };
        writeRun(out, record);
        archiveTree(prepared.dir, out);
        purge(prepared.dir);
        if (!values.keep) removeDir(prepared.dir);
        records.push(record);
        log(`  ${record.outcome}: ${record.reason} — $${(metrics.costUsd ?? 0).toFixed(2)}, ${metrics.turns ?? "?"} turns, ${(build.durationMs / 60_000).toFixed(1)} min`);
        if (change) log(`  the change: $${(change.metrics.costUsd ?? 0).toFixed(2)}, ${change.metrics.turns ?? "?"} turns, ${(change.durationMs / 60_000).toFixed(1)} min`);
      }
    }
  }
  done();
  mkdirSync(reportRoot, { recursive: true });
  const findings = findingsOf(records, packageNames());
  writeFileSync(join(reportRoot, "findings.json"), `${JSON.stringify(findings, null, 2)}\n`);
  writeFileSync(join(reportRoot, "summary.md"), summaryMarkdown(records, { stamp, gitSha: git.sha, dirty: git.dirty, model, thinkAloud }, findings));
  log("");
  printTable(records);
  if (findings.length > 0) {
    log("\nmost raised:");
    for (const finding of findings.slice(0, 5)) log(`  ${finding.about} (${finding.runs.length} run${finding.runs.length === 1 ? "" : "s"}, ${finding.items.length} item${finding.items.length === 1 ? "" : "s"})`);
  }
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
      // Every arm's reference: a paired brief's baseline must be passable too, or the comparison means nothing.
      for (const [arm, phase] of brief.arms.flatMap((each) => (brief.changes ? [[each, 1], [each, 2]] : [[each, 1]]) as Array<[Arm, Phase]>)) {
        const label = `${name}${arm === "knew" ? "" : "-baseline"}${phase === 2 ? "-changed" : ""}`;
        const dir = join(install.dir, label);
        cpSync(referenceOf(brief, arm, phase), dir, { recursive: true });
        layBrief(dir, name, brief.inputs, arm);
        const result = runChecker(dir, name, { typecheck: true, arm, phase });
        log(`${result.passed ? "✓" : "✗"} ${label} (v${brief.version}): ${result.checks.filter((c) => c.passed).length}/${result.checks.length} checks`);
        for (const check of result.checks.filter((c) => !c.passed)) log(`    ✗ ${check.name}: ${check.detail.split("\n").slice(0, 6).join("\n      ")}`);
        if (!result.passed) failed += 1;
      }
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

# Ephemeral testing for @popjoker/knew

An agent builds a throwaway app on the packed tarball from a product brief. The package is judged
by how that app turns out and how hard it was to build, and then the app is deleted. This is
[Lemire's idea](https://lemire.me/blog/2026/10/05/ephemeral-testing/). It complements the unit
tests and the contract suite: those prove the engine behaves as specified, and this proves the
shipped docs, errors and API are enough to build on.

Private workspace, never published.

## Commands

| Command | What it does | Cost |
|---|---|---|
| `npm run dry-run -w @knew/ephemeral` | Runs each brief's reference app through its hidden checker against a freshly packed tarball, with no model. CI runs this. | Free, about 15 seconds |
| `npm run preflight -w @knew/ephemeral` | Runs two tiny real sessions: the clean room holds, the budget cap trips, and purge leaves nothing behind. Rerun it after any Claude Code upgrade. | A few cents |
| `npm run agent -w @knew/ephemeral -- --brief places` | A model builds the brief's app, which is then debriefed, checked, measured and reported. | About $2–5 per run at API rates |

`agent` options:
- `--brief`: repeatable; default is every brief.
- `--runs <n>`
- `--model`: default `claude-opus-5-5`.
- `--effort`
- `--budget <usd>`: caps the whole pass; default 30.
- `--timeout-min`
- `--tarball <path>`: repeatable. Two tarballs run interleaved, as an A/B comparison under the
  same conditions.
- `--keep`: keeps the throwaway directories.
- `--think-aloud`: the agent keeps a `NOTES.md` as it works, one line per guess, confusion or
  workaround, as a participant in a usability study would. Off by default, because reflecting
  changes the work: a think-aloud pass's cost and turns aren't comparable with a plain one's.

Model runs spend real money on your Claude login and run one at a time, sharing your limits. They
never run in CI.

## One run

1. **Prepare** (not timed). `npm pack` the package and make a directory under the system temp dir,
   with no `package.json` or `node_modules` above it. Scaffold it:
   - the tarball in `vendor/`;
   - tsx, typescript and @types/node pinned to the root lockfile's exact versions;
   - a strict NodeNext `tsconfig.json` with `skipLibCheck` off;
   - the brief's `BRIEF.md` and inputs.

   Then install.
2. **Build.** `claude -p` runs in a clean room:
   - `--safe-mode --restricted`, six tools, no MCP and no slash commands;
   - an environment allowlist;
   - a budget cap, a wall clock and an inactivity watchdog.

   The session's init event is checked, not trusted. A mismatch, or any denied permission, makes
   the run `infra`.
3. **Find the moments, then debrief.** The transcript is replayed for the moments a usability
   researcher would ask about, with no model involved:
   - a test or typecheck that failed twice in a row before passing, or never passed;
   - the compiled `dist/*.js` opened, because the docs fell short;
   - a doc read a second time;
   - the agent saying, mid-task, that it was unsure, guessing or working around something.

   The same session is then resumed and answers in a schema: five open questions (what it
   guessed, which errors didn't help, what the docs lacked, what fought it, what it would change),
   then one question per moment, by number ("M3: you opened `dist/readiness.js` at step 14"):
   what it was doing, what confused it, and what would have made it unnecessary. A quoted error
   is kept only if a tool actually printed it, and an answer only if its moment was asked about.
4. **Check.** The brief's `check.ts` goes in only now, so the agent never sees it. It runs with the
   app's own tsx against the tarball the app installed.
5. **Report, then clean up.** `claude purge` the run directory, then remove it.

## Reading a report

`reports/<stamp>-<sha8>[-dirty]/<brief>/<run>/` is gitignored. Each run directory holds:
- `result.json`: the whole record, with every moment found and, in think-aloud mode, the notes,
  each at the step that wrote it.
- `check.json` and `debrief.json`.
- `transcript.jsonl`.
- `tree.tgz`: the finished app, without `node_modules`.

`summary.md` beside them gives:
- pass k/N per brief;
- median cost, turns and time;
- the findings, also in `findings.json`. Everything the pass heard about the package is grouped by
  what it's about: an error by its message with the app-specific names blanked out, anything else
  by the first package name or file it mentions, and the rest by overlapping words. Groups are
  ranked by how many runs and briefs raised them. Each item says what backs it, strongest first:
  - behaviour: what the agent did;
  - an aside: what it said mid-task;
  - an interview answer about a numbered moment;
  - a think-aloud note;
  - recall and suggestions from the debrief.

  One run complaining is noise. The same thing from three runs, or two briefs, is a finding. A
  suggestion is a lead, not a decision.

Each run gets one outcome, in this order of precedence:
- `contaminated`: it named the repo, `~/.claude`, a path outside its directory, or the network.
- `infra`: the clean room didn't hold, or the session never finished.
- `pass`: the checker passed.
- `timeout`.
- `budget`.
- `fail`.

`contaminated` and `infra` runs are left out of k/N. Draw trends only between runs of the same
brief version.

## The briefs

| Brief | The product | What it exercises |
|---|---|---|
| `places` | Notes on cafés and venues, for planning a visit | A vocabulary written from scratch; hours that go stale after about a month; what kind of place before what it's like |
| `gifting` | A gift guide that asks before it shows picks | The person preset extended with its types unchanged; five facts in any mix before picks; what to steer clear of and what they have, handed over as rules |
| `migrate` | A florist's customer book on 0.2.1 | The move from 0.x, with every page, must-honor list and question unchanged from what 0.2.1 itself rendered |

Each brief holds:
- `BRIEF.md`: a product story in a client developer's voice.
- `brief.json`: its version, the ids the checker may rely on, its budget and clock, its inputs,
  and the package words it may say anyway.
- `check.ts`: the hidden checker. It runs the package's own functions over the agent's own JSON
  and judges against bounds, never exact numbers. It then drives the app through the package's
  fake behind a recorder, built from the agent's own lenses.
- `reference/`: a known-good app. It proves the brief can be solved and that the checker passes
  a good solution.

`test/briefs.test.ts` holds every brief to four rules:
- it names no API;
- it names every id its checker relies on;
- its reference passes;
- its checker fails the reference when it's broken in each way the checker claims to catch.

## Adding a brief

1. **`BRIEF.md`.** Say what the product needs, never the package's names. Finding the API is part
   of what a run measures.
2. **`brief.json`.** Pin only what a product spec would name anyway.
3. **`check.ts`.** Write probes of behavior, using `kit/check-kit.ts`. A valid design that names
   things differently must pass.
4. **`reference/`.** Add the known-good app; `briefs/tsconfig.json` holds it to the scaffold's
   settings.
5. **Mutations.** Add them to `MUTATIONS` in `test/briefs.test.ts`. A probe no mutation fails has
   not shown it can fail.
6. **Verify.** Run `npm test -w @knew/ephemeral`, then `npm run dry-run -w @knew/ephemeral`.

Bump a brief's version whenever its brief, checker or inputs change.

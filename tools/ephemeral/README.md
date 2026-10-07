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
- `--arm <arm>`: `knew` (the default), `baseline`, or `both`. See "Baseline mode".
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

## Baseline mode

A paired brief is one product built two ways and judged by one checker:
- on knew, from its `BRIEF.md`;
- with no knew at all, from its `BASELINE.md`, as an agent asked to build the product directly would.

Its probes target what goes wrong once an app is a year old: corrections that keep their history,
as-of reads, statements that end, repeats, stale information, notes about things nobody added,
and users who never see each other's data. Where the baseline fails and knew passes, that is
what knew adds. Where both pass, knew adds little there.

- **Same statements in both arms.** Neither arm does a model's job. The checker scripts what each
  note says. The knew arm receives it as the package's fake extraction and reconciliation; the
  baseline gets a `read` function returning the same statements.
- **No knew in the baseline.** The baseline is scaffolded with no dependency and no tarball, its
  prompt names no package, and it is not debriefed. Its checker gets the package installed only
  after the build, with `--no-save`.
- **Both references pass.** `baseline-reference/` is a plain app that passes the same checker,
  so a baseline failure is the agent's, not the brief's.
- **The summary compares them.** A probe-by-probe table gives each arm's passes.

`npm run agent -w @knew/ephemeral -- --brief notebook --arm both` runs one pair.

## The change phase

Requirements move after an app is built, and a design that made the first build easy can make
the second change hard. A brief with a `CHANGE.md` (and `CHANGE-BASELINE.md`, if it is paired)
measures that:

1. The app is built as usual.
2. It is checked as it stands, on a throwaway copy, so the hidden checker is never left where the
   agent works.
3. The same session is resumed with the change.
4. The app is checked again: every earlier probe, adjusted for the change, and the new behaviour
   besides.

The summary's "What the change cost" table gives each arm's change cost, turns and time, and
whether the app passed before and after. `reference-changed/` (and
`baseline-reference-changed/`) are the known-good apps after the change, and the change has
mutations of its own.

For `notebook`, the change adds a fifth kind of statement, `PRICE`, a second planning view for
tonight, and a last step on the visit view. On knew, that is a vocabulary addition and a new
lens; from scratch, it is whatever the app's design makes it.

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
| `notebook` | A notebook of places, built on knew and without it | Paired. What an app must get right a year in: corrections, as-of reads, ended statements, repeats, stale hours, unknown places, separate notebooks |
| `gifting` | A gift guide that learns more before it shows picks | The person preset extended with its types unchanged; five facts in any mix before picks; what to steer clear of and what they have, handed over as rules |

Each brief holds:
- `BRIEF.md`: a product story in a client developer's voice.
- `brief.json`: its version, the ids the checker may rely on, its budget and clock, its inputs,
  and the package words it may say anyway.
- `check.ts`: the hidden checker. It runs the package's own functions over the agent's own JSON
  and judges against bounds, never exact numbers. It then drives the app through the package's
  fake behind a recorder, built from the agent's own lenses.
- `reference/`: a known-good app. It proves the brief can be solved and that the checker passes
  a good solution.
- For a paired brief, `BASELINE.md` and `baseline-reference/`: the same product without knew.

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

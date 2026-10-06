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
3. **Debrief.** The same session is resumed and answers five questions in a schema: what it
   guessed, which errors didn't help, what the docs lacked, what fought it, and what it would
   change. A quoted error is kept only if a tool actually printed it.
4. **Check.** The brief's `check.ts` goes in only now, so the agent never sees it. It runs with the
   app's own tsx against the tarball the app installed.
5. **Report, then clean up.** `claude purge` the run directory, then remove it.

## Reading a report

`reports/<stamp>-<sha8>[-dirty]/<brief>/<run>/` is gitignored. Each run directory holds:
- `result.json`: the whole record.
- `check.json` and `debrief.json`.
- `transcript.jsonl`.
- `tree.tgz`: the finished app, without `node_modules`.

`summary.md` beside them gives:
- pass k/N per brief;
- median cost, turns and time;
- the friction list: errors raised from the package (verbatim, with counts), the docs opened, and
  whether the agent read `dist/*.js`.

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

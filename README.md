# knew

The attention engine. You write down what you noticed about someone; knew reads it into typed,
dated facts, hands back the page you start from, and names the one thing still worth asking.

This repo holds two of the three pieces. The third, the Postgres service, lives in
`heymichaelp/knew-service` and deploys on its own schedule.

| | | |
|---|---|---|
| `packages/knew` | [`@popjoker/knew`](https://www.npmjs.com/package/@popjoker/knew) | The pure core: the contract, vocabularies and lenses, readiness, the brief, the reconciliation plan, the prompts, the HTTP client, the opt-in presets, and the contract suite. No database, no model, no React. |
| `apps/site` | [knew.dev](https://knew.dev) | The site and the developer docs. |

## Working on it

```sh
npm install
npm run build        # the package first, then the site — turbo enforces the order
npm run typecheck
npm test
npm run site         # knew.dev on :3000
```

Node 22 or later. npm workspaces, one lockfile at the root.

## How the docs cannot drift

knew.dev describes the engine by importing it, not by transcribing it. `ADOPTING.md` and
`CHANGELOG.md` are read out of the installed package at build time; the vocabulary and lens field
tables are generated from their schemas and the defaults table from `ENGINE_DEFAULTS`; the
presets page outlines every preset `@popjoker/knew/presets` exports; the contract page lists
whatever `contractCases()` returns; the front page's worked example is the person preset, rendered
by the engine's own `renderBrief` and `readinessFor`. The tests in
`apps/site/test` fail the build if the prose beside any of that falls behind — add a field to a
definition schema without documenting it and `npm test` goes red.

## Releasing the package

Bump `version` in `packages/knew/package.json` and merge to `main`. `.github/workflows/release.yml`
compares it against the published version and publishes when they differ, using npm trusted
publishing — no token in the repo, and provenance is attached automatically. The package's own
`prepublishOnly` still regenerates the prompts, builds, and runs the tests before anything leaves.

## The site

Git-connected to Vercel, root directory `apps/site`. Merges to `main` go to production; pull
requests get a preview. `robots.txt` disallows everything until `SITE_INDEXABLE=1` is set on the
production environment.

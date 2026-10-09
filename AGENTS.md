# knew

The attention engine: one engine, distinct clients. This repo is the npm package and the
knew.dev site. The Postgres service is `heymichaelp/knew-service`.

## What it is

| Workspace | Name | What it holds |
|---|---|---|
| `packages/knew` | `@popjoker/knew` | The engine: the core, and the whole pipeline in your process (`localIntelligence`). No database and no network of its own: the model is the app's (`Model`), with Claude in `./anthropic` and Apple's on-device model in `./apple`. One runtime dependency: zod. |
| `apps/site` | `@knew/site` | knew.dev — marketing and developer docs, Next App Router. |
| `tools/ephemeral` | `@knew/ephemeral` | Ephemeral testing: an agent builds a throwaway app on the packed tarball from a product brief, and the package is judged by how that goes. Private. |

## Rules

- **knew reports understanding; it writes no questions.** Per entity and lens it gives the
  current understanding by dimension, the missing understanding (needs not met), and the next
  directions. Nothing in the package produces a question for the knower; what to do with a
  direction is the client's call. Understanding has three subjects: the entity, the relationship
  with it (kept on the entity, one to each), and the knower (kept on `self`, the same beside every
  entity). Keep the knower separate, and never move relationship facts off their entity.
- **Nothing client-specific lives in the package.** The core ships no vocabulary and no lens: no
  fact type, no dimension, no heading, no charter. Vocabularies and lenses are data a client
  registers. The one exception is `@popjoker/knew/presets`: opt-in, generic starter vocabularies
  and lenses per kind (`person`, `place` and `product` today). A product's own content —
  knewpeople's `relationships` lens, Sweeket's gifting charter — stays in its repo, and
  `test/presets.test.ts` fails if any preset's type key appears in the core's code.
  The site's worked example is the person preset; the fixture vocabulary and its three lenses in
  `@popjoker/knew/testing` back the contract suite.
- **Weights order directions; they never weigh what is believed.** Readiness ranks needs and
  revisits; it never reorders, filters or annotates a page, and a fact due for a revisit is still
  printed exactly as before. Revisit windows are opt-in per fact type and refused on enduring
  types.
- **The site imports the engine; it never transcribes it.** Long-form pages render the package's
  own `ADOPTING.md`/`CHANGELOG.md`, read from the installed tarball at build time. The vocabulary
  and lens tables come from `vocabularyDefinitionSchema` and `lensDefinitionSchema` via
  `z.toJSONSchema`, the defaults table from `ENGINE_DEFAULTS`, the presets page from every export
  of `@popjoker/knew/presets` (its example of extending one from `ADOPTING.md`), the contract list
  from `contractCases()`, the API surface check from the client's runtime keys, and the front
  page's example from `renderBrief` and `readinessFor`. If you find yourself typing a fact the
  package already knows, stop and import it instead.
- **The drift guards live in `apps/site/test/drift.test.ts`** and are the reason the above holds.
  Adding a vocabulary or lens field — top-level, or inside a fact type, a dimension, an ask or a
  section — without a note in `apps/site/lib/vocabulary-notes.ts` or `lens-notes.ts`, an engine
  default without a note in `default-notes.ts`, or a client method without a row in
  `apps/site/lib/api-routes.ts`, fails the build. Do not loosen them to get green.
- **A monospace is for code only.** Geist Mono appears in `<pre>` blocks and in `.code` spans that
  wrap something you would actually type — an identifier, a route, a header, a regex. Labels,
  dates, counts and HTTP verbs are set in Lato. This is a deliberate softening; it reverts easily
  and should not.
- **Tailwind v4, CSS-first.** There is no `tailwind.config.js`. Tokens live in `@theme inline` in
  `apps/site/app/globals.css`; a size token declared there is used as `text-hero`, not
  `text-[var(--text-hero)]` — the arbitrary form is ambiguous to Tailwind and silently drops.
- **Reading a file at build time needs `/*turbopackIgnore: true*/`** on the `join`/`readFileSync`
  calls, or Turbopack traces the whole project into the server bundle. See
  `apps/site/lib/package-docs.ts`, which also explains why `require.resolve` cannot be used to
  find the package directory: the bundler rewrites it to a module id.
- **The model is the app's.** The package opens no connection and holds no key. Its root, its
  store and its on-device adapter run in React Native and the browser as well as Node:
  `test/portable.test.ts` fails on a Node-only API in them. `@anthropic-ai/sdk` is an optional
  peer, imported only by `./anthropic`. Every test answers with a script or a stand-in; no test
  calls a real model. `apple/KnewFoundationModels.swift` is a reference the package can't
  compile, so a change to it is checked on a device.
- **The package builds with plain `tsc`** and tests with `node --import tsx --test`. No bundler,
  no vitest. `scripts/embed-prompts.mjs` generates `src/prompts/*.ts` from `prompts/*.md`, and
  `test/prompts.test.ts` fails when the two drift — regenerate with `npm run prompts -w @popjoker/knew`,
  never hand-edit the generated files.
- **A brief names no API.** A `tools/ephemeral` brief is a product story, and finding the API is
  part of what a run measures. `test/briefs.test.ts` fails a `BRIEF.md` that says a runtime export
  of the package or a field of either definition schema — a name with a capital anywhere, an
  ordinary word only as code. A word the product needs anyway goes in the brief's `allow`.
- **Never loosen a checker to get green.** A checker that passes its reference and fails a real
  run has found something: fix the package, its docs or its errors. If the brief was unfair,
  change it and bump its version. Every probe is shown failing a broken reference by a mutation
  in `test/briefs.test.ts`; a probe without one has not shown it can fail.
- **Model runs are on demand, never in CI.** `npm run agent -w @knew/ephemeral` spends real money
  on a Claude login. CI runs only the dry run: each reference through its checker against the
  packed tarball. A full pass, every brief on Opus 5.5, gates any release that changes the API,
  starting with 1.0. See `tools/ephemeral/README.md`.
- **A release is a version bump on `main`**, nothing else. Do not run `npm publish` by hand.

## Verifying

`npm run build && npm run typecheck && npm test && npm run lint` from the root. Turbo builds the
package before the site typechecks, which matters: the site imports the package's `dist`. CI then
packs the tarball and runs `npm run dry-run -w @knew/ephemeral -- --tarball <path>`, which installs it
the way an adopter would and runs every brief's reference against it.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->

# knew

The attention engine: one engine, distinct clients. This repo is the npm package and the
knew.dev site. The Postgres service is `heymichaelp/knew-service`.

## What it is

| Workspace | Name | What it holds |
|---|---|---|
| `packages/knew` | `@popjoker/knew` | The pure core. No database, no model, no React. One runtime dependency: zod. |
| `apps/site` | `@knew/site` | knew.dev — marketing and developer docs, Next App Router. |

## Rules

- **Nothing client-specific lives in the package.** It ships no lens of its own: no fact type,
  no heading, no charter, no question. A lens is data a client registers. knewpeople's
  `relationships` lens is that client's content and stays in its repo — the site uses the
  fixture lens from `@popjoker/knew/testing` as its worked example.
- **The site imports the engine; it never transcribes it.** Long-form pages render the package's
  own `ADOPTING.md`/`CHANGELOG.md`, read from the installed tarball at build time. The lens table
  comes from `lensDefinitionSchema` via `z.toJSONSchema`, the contract list from `contractCases()`,
  the API surface check from the client's runtime keys, and the front page's example from
  `renderBrief` and `gapsFor`. If you find yourself typing a fact the package already knows, stop
  and import it instead.
- **Three drift guards live in `apps/site/test/drift.test.ts`** and are the reason the above holds.
  Adding a lens field without a note in `apps/site/lib/lens-notes.ts`, or a client method without a
  row in `apps/site/lib/api-routes.ts`, fails the build. Do not loosen them to get green.
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
- **The package builds with plain `tsc`** and tests with `node --import tsx --test`. No bundler,
  no vitest. `scripts/embed-prompts.mjs` generates `src/prompts/*.ts` from `prompts/*.md`, and
  `test/prompts.test.ts` fails when the two drift — regenerate with `npm run prompts -w @popjoker/knew`,
  never hand-edit the generated files.
- **A release is a version bump on `main`**, nothing else. Do not run `npm publish` by hand.

## Verifying

`npm run build && npm run typecheck && npm test && npm run lint` from the root. Turbo builds the
package before the site typechecks, which matters: the site imports the package's `dist`.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->

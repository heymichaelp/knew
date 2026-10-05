# Changelog

The package follows semver from 1.0.0: a change to the lens schema that keeps every registered
lens valid is a minor; a change to `PeopleIntelligence`, to the wire types or to what a driver
must do under the contract suite is a major. Before 1.0.0 a minor may break; the entries say so.

## 0.2.0 — 2026-10-05

A home of its own, and a licence. Nothing in the contract moved.

- The package lives in `heymichaelp/knew` now, with the knew.dev site beside it and the service
  in its own repo. `repository`, `homepage` and `bugs` point there.
- **MIT.** The licence field said `UNLICENSED` and there was no licence file; both are fixed and
  `LICENSE` ships in the tarball. `publishConfig.access` is explicit rather than implied.
- `DEFAULT_TIMEOUTS` is exported. It was module-private, so an adopter could not read the budget
  a call falls under without timing it; knew.dev now documents the shipped values by importing
  them.
- `README.md` and `ADOPTING.md` §8 describe running the service from its own repo, and the
  quickstart is wrapped so it reads on a narrow page.
- Releases publish from CI on a version bump, with npm trusted publishing and provenance. The
  `prepublishOnly` gate — prompts, build, tests — still runs.

### Toward 1.0

Two changes are planned, and both are breaking, so they wait for 1.0.0:

- **Noun-neutral names.** `PeopleIntelligence`, `upsertPerson` and `personHints` read as though
  the engine only knows people. It does not: the schema already calls the thing an entity, and
  `entityKinds` already widens it. The contract, the wire types and the roster become neutral,
  while "subject" keeps its data-protection sense in the wire and the code.
- **Vocabulary separated from lens.** Extraction writes in a vocabulary per noun kind, and
  several lenses read the same facts with their own sections and asks. Today a lens is both at
  once, which is why two lenses cannot share a person's facts. This is the one architectural
  change the framework implies.

Both are a change to `PeopleIntelligence` and to what a driver must do, so both are a major, and
the contract suite changes first.

## 0.1.1 — 2026-10-05

The first live lens found two things.

- A lens with no routing fields compiled `fieldUpdates[].field` to `never`, which JSON Schema spells `not`, and every structured-output endpoint refused the whole extract call. The field is a plain string for such a lens now, and `cleanProposals` drops any update naming a field the lens does not route; the sweep, stateless mode and the fake all pass the lens's routing fields to it. `not` joins `REFUSED_SCHEMA_KEYWORDS`, and the service refuses to register a lens whose compiled schema carries a refused keyword, instead of failing every episode later.
- `package.json` is exported, so tools that read a dependency's version can.

## 0.1.0 — 2026-10-05

The first cut.

- The contract: `PeopleIntelligence`, its scope, inputs and outputs (`types.ts`).
- Lenses as data: `LensDefinition`, `lensDefinitionSchema`, `parseLensDefinition`, `compileLens`.
- The page: `renderBrief`, `mustHonorFrom`, as-of reads with `factsKnownAt`.
- The forward half: `gapsFor` over a lens's asks.
- Reconciliation as a plan: `planReconciliation`, `attributeFacts`, `orderSubjects`, `cleanProposals`.
- The two task prompts, neutral, embedded as data; the input builders and output schemas.
- `intelligenceClient`, the HTTP driver, with per-method timeouts and `revivePlan` for a client whose API relays a stateless answer.
- `@popjoker/knew/testing`: `fixtureLensDefinition`, `fakeIntelligence` (scriptable), and the contract suite (`contractSuite`, `contractCases`).

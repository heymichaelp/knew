# Changelog

## Unreleased — 1.0.0

knew reports understanding by dimension: what is understood, what a goal still needs, and the
next direction. It writes no questions.

- **Vocabularies and lenses are separate definitions.** A `VocabularyDefinition` holds the fact
  types, the dimensions they inform, `fields`, `promptFields`, the `charter` and the `kind`. A
  `LensDefinition` holds `objective`, `needs`, `pinned`, `sections`, `header`, `overHeading` and
  `attributeTags`. Several lenses read one vocabulary; writing never names a lens. `compileLens`
  checks every reference; `lensProblems` lists them.
- **Needs.** A need names a dimension, or `types` with a `label`, and may set `weight`, `enough`,
  `after` and `when`. Left out, a lens has one need per dimension. A lens's `order` is `value`
  (the default) or `listed`, which keeps directions in the lens's order.
- **Readiness.** `readinessFor` and `Intelligence.readiness` return `dimensions` (current
  understanding), `needs` (each with a state and a strength) and `next`: directions of kind
  `learn` or `revisit`, with `label`, `dimension`, `types`, `value` and `factIds`. `gapsFor` and
  `gaps()` return the `learn` directions. Fact types may set `revisitAfterDays`.
- **Three subjects.** A dimension is `about` the entity, the relationship between the knower and
  the entity (kept on the entity), or the knower (kept on `self`, `KNOWER_ID`, on every roster).
  Extraction is shown the knower and where each type attaches, and attribution drops a fact filed
  under the wrong subject (`misattributed`). Readiness, gaps and the page read the knower beside
  every entity, and directions rank all three. The person preset has relationship and knower
  dimensions; place and product mark the knower's relationship with them.
- **Runs in your process, on your own key, or on the device.** `localIntelligence` is the whole
  engine in-process: roster, episodes, extraction, reconciliation, reads, with each knower's
  notebook in a `LocalStore` (`memoryStore()` by default; one JSON-safe `ScopeRecord` per knower).
  The model is the app's: a `Model` function, `anthropicModel` in `./anthropic` (the official SDK
  as an optional peer), or `appleModel` in `./apple` (Apple's on-device model through the Swift
  bridge in `apple/`), with `fallbackModel` for on-device first. `statelessIntelligence` is
  stateless mode in-process. `fakeIntelligence` is now the local driver with a script.
- **Defaults and presets.** `ENGINE_DEFAULTS`; `extendVocabulary` and `extendLens`, which record
  `basedOn`; presets `person`, `place` and `product` in `./presets`.
- **`Fact.lastSaidAt`**: the newest episode that said a fact. As-of reads withhold later
  retellings.
- **`getEntity`** returns an entity on the roster with no facts when nothing is known yet; null
  means not on the roster. **`factsTrueAt`** keeps what is true at a moment: believed then, and
  not past its own end date.
- **`EpisodeInput.inReplyTo`**: the question your app asked, so extraction reads the answer in
  context.
- **Noun-neutral names**: `Intelligence`, `upsertEntity`, `deleteEntity`, `entityHints`,
  `entityId`, routes under `/v1/entities`.
- **Prompts v2**: `extract.v2` and `reconcile.v2` are the defaults.
- **Drivers** implement `readiness`, honor `lens` on every read that renders, stamp `lastSaidAt`,
  keep `inReplyTo`, and pass the contract cases.

## 0.2.1 — 2026-10-05

The listing, since npm is where most people meet this.

- The README opens with what the engine is for rather than its mechanics, and says "subject"
  where the engine means subject.
- It links to knew.dev. `ADOPTING.md` and `CHANGELOG.md` ship in the tarball but are not
  clickable on npm, so pointing at the files alone was a dead end for the reader npm sends.
- `memory` leaves the keywords. The engine's own rulings reject the word — it looks forward,
  which is why it is intelligence and not memory — so advertising it was a contradiction.

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

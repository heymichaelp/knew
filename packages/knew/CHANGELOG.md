# Changelog

The package follows semver from 1.0.0: a change to a definition schema that keeps every
registered vocabulary and lens valid is a minor; a change to `Intelligence`, to the wire types or to
what a driver must do under the contract suite is a major. A preset is reviewed like API: an
addition to it is a minor, and a change to what an existing preset type means is a major. Before
1.0.0 a minor may break; the entries say so.

## Unreleased — 1.0.0

The two changes "Toward 1.0" promised, and the forward half grown up: the vocabulary and the lens
are separate definitions, the names are noun-neutral, and the engine says what is known, how
strongly, and what to learn next. Breaking, as a major is; nothing ships until knew-service runs
it.

**The vocabulary and the lens, apart.**

- `VocabularyDefinition` is what extraction writes in: fact types, the **dimensions** of an
  entity they inform (each type informs one; each dimension may carry the question that probes
  it), the entity's `fields` (formerly `routingFields`), `promptFields`, the charter, source labels,
  prompt overrides, and the `kind` it describes (formerly `entityKinds`).
- `LensDefinition` is a direction over a vocabulary for one objective: `objective`, `asks`,
  `pinned`, `sections` (of dimensions), `header` (formerly `briefHeader`), `overHeading`,
  `attributeTags` (formerly `briefAttributeTags`). It says only what differs: sections default to
  one per dimension, pinned types to the vocabulary's, asks to each dimension's question.
- Several lenses read one vocabulary's facts, and writing never names a lens, so a lens change
  touches no episode. Episodes are stamped `vocabulary@version:promptRef`.
- `compileLens(definition, vocabulary)` checks every reference; `lensProblems` lists them.
- `fromLegacyLens` splits a 0.x lens into a vocabulary and a lens that report the same gaps and
  render the same page — proved against strings captured from 0.2.1 — unless the 0.x lens had a
  heading no type used or listed a section twice. Its `notes` name every such difference, along
  with any section id or kind slugged to the 1.0 patterns and any extra kind dropped.

**Defaults, then overrides.**

- `ENGINE_DEFAULTS`: what the engine assumes when a definition says nothing — mechanics only.
- `@popjoker/knew/presets`, opt-in: a generic `person` vocabulary and starter lens. The core still
  names no domain; a preset is reviewed like API.
- `extendVocabulary` and `extendLens` start a client's own definition from a base and say only
  what differs (`null` removes). An extended vocabulary is stamped `basedOn`: the first base, what
  of it changed and what was added. A lens that asks its vocabulary's dimension questions is
  extended with that vocabulary in hand, so its asks can be patched by id.

**Readiness.**

- `readinessFor(lens, entity, facts, at)` and `Intelligence.readiness(scope, entityId, { lens,
  asOf })`: evidence per dimension (current facts, how many are due for a revisit, when last
  said), each ask's standing (`met`, `waiting`, `due`, `thin`, `open`, with a strength from 0 to
  1), the overall readiness, and the next steps in order — `ask`, anchored on what is known, or
  `revisit`.
- New on an ask: `weight` (at most 1,000), `enough`, `after` (coarse before fine), and the
  `dimension` form. New on a fact type: `revisitAfterDays`, refused on an enduring type. New on a
  lens: `objective`.
- `gapsFor` is the "ask" steps of readiness, in order; a `Gap` names its `dimension`. With none of
  the new fields declared, the gaps are exactly 0.x's.
- Weights order what to learn; they never weigh what is believed. The page is unchanged.

**Facts know when they were last said.** `Fact.lastSaidAt` is the newest episode that said it: a
merge moves it, forward only. An as-of read withholds a retelling that came after the moment.

**A reply keeps its question.** `EpisodeInput.inReplyTo` is the question the knower was
answering. Extraction reads the answer as an answer; the content stays their words, and the
export keeps the question apart.

**Noun-neutral names.**

- `PeopleIntelligence` → `Intelligence`.
- `upsertPerson`/`deletePerson` → `upsertEntity`/`deleteEntity`, with an optional `kind`.
- `personHints`/`personId` → `entityHints`/`entityId` everywhere.
- `Fact.subjectId` → `Fact.entityId`, the client's id; `Entity.id` is the client's id and
  `Entity.personId` is gone.
- `orderSubjects` → `orderEntities`.
- Routes `/v1/people/*` → `/v1/entities/*`, plus `/readiness`. Registration is
  `PUT /v1/vocabulary` and `PUT /v1/lens`.
- "Subject" keeps its data-protection sense: the scope's `subjectId` is the knower.

**Prompts v2.** `extract.v2` and `reconcile.v2` are the defaults: noun-neutral, no "memory",
`entityId` in the output, a reply read as a reply, and a date written only when one was said.
v1 stays embedded for provenance.

**What a driver must now do.**

- Implement `readiness` and honor `lens` on every read that renders, refusing a lens the client
  never registered; refuse an entity of a kind the vocabulary does not describe.
- Stamp `lastSaidAt` on insert, and on merge as `max(lastSaidAt, knownAt)`; an as-of read
  withholds a retelling that came after the moment (`lastSaidAt: null`, as `asKnownAt` does).
- Keep `inReplyTo` on the episode and in the export.
- Pass the new contract cases: replies that keep their question, readiness by name and over
  time, a retelling that merges, and two lenses over one ledger.

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

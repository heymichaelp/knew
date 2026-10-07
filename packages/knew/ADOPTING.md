# Adopting the engine

How a client takes `@popjoker/knew` on, in the order the questions come up. A second client
follows it without reading anybody else's code.

The words: the **knower** is the client's own user, whose notebook this is — the scope's
`subjectId`. What they know about is an **entity** on their roster, of the vocabulary's **kind**: a
person, a place, a thing. A **vocabulary** is what extraction writes in; a **lens** is a direction
over it for one objective.

## 1. Install, and bind once per process

```sh
npm install @popjoker/knew
```

The package is ES modules for Node 22 or later, or any bundler that reads `exports`. Until it is
on a registry, `npm pack` in `packages/knew` makes a tarball that installs the same way.

Make one `Intelligence` per process and hand it around; never build one per request. The HTTP
client holds no connection, so the cost is only the discipline: one place knows the URL and the
key, and one place can swap the driver.

```ts
// intelligence.ts
import { intelligenceClient, type Intelligence } from "@popjoker/knew";

export const intelligence: Intelligence = intelligenceClient({
  baseUrl: process.env.INTELLIGENCE_URL!,
  serviceKey: process.env.INTELLIGENCE_SERVICE_KEY!,
  timeouts: { read: 2_000, write: 3_000, search: 2_000, export: 30_000, extractNow: 45_000, stateless: 90_000 },
});
```

Everything in the client's own code imports `intelligence` from here. The scope goes on every
call: `{ clientId, subjectId }`, where `clientId` is what the service minted the key for and
`subjectId` is the client's own id for the knower. A subject id means nothing outside the client
that sent it; nothing in the engine links scopes.

## 2. Register a vocabulary and its lenses

Both are JSON. Write them in the client's repo, validate them in a test, and register each once
per version, at boot or by hand.

**Start from a preset, or from nothing.** `@popjoker/knew/presets` ships a generic `person`
vocabulary and a starter lens. `extendVocabulary` and `extendLens` take a base and the client's
overrides — a key given replaces or merges, `null` removes, a key left out keeps the base's — and
return a complete definition. The vocabulary is stamped `basedOn`, naming the preset and every
type or dimension of it that changed.

```ts
import { compileLens, compileVocabulary, extendLens, extendVocabulary } from "@popjoker/knew";
import { person } from "@popjoker/knew/presets";

export const vocabulary = extendVocabulary(person.vocabulary(), {
  id: "my-app",
  version: 1,
  factTypes: { CIRCUMSTANCE: { revisitAfterDays: null } }, // switch a preset default off
  charter: "# What we keep\n\n…",
});

export const prep = extendLens(person.lens(), {
  id: "prep",
  version: 1,
  vocabulary: "my-app",
  objective: "Walk into the next conversation ready.",
  asks: { ahead: { weight: 3 }, pursuits: { enough: 2, after: ["work"] } },
});

compileLens(prep, compileVocabulary(vocabulary)); // throws, naming every problem, in your own test
```

**The vocabulary** holds what extraction needs: `factTypes` with descriptions the model reads,
each informing one of the `dimensions` (`pinned` for what must be honored and comes back as
`mustHonor`; `enduring` for what is replaced only by its own type; `revisitAfterDays` for how long
until a fact of it is due for a revisit; attributes for structure), the `fields` an entity carries
that the knower edits and extraction may only propose, `promptFields` shown beside a name, and a
`charter` in the client's own words about what is worth remembering and why. `prompts.extract` and
`prompts.reconcile` override the engine's neutral task prompts only when a client has a reason; the
charter is the normal place for voice.

**A lens** holds what one objective needs: the `objective` sentence, the `asks` that are its
knowledge requirements (§5), the `pinned` types to hold in view, and how the page reads — `sections`
of dimensions, a `header`, an `overHeading`. A lens says only what differs: its sections default to
one per dimension, its pinned types to the vocabulary's, its asks to each dimension's question.

**Every field, offline.** Each field of both definitions is documented where it is declared, so the
reference ships in the tarball: `VocabularyDefinition`, `FactTypeSpec` and `DimensionSpec` in
`dist/vocabulary.d.ts`; `LensDefinition`, `AskSpec` and `SectionSpec` in `dist/lens.d.ts`.
knew.dev/lenses renders the same fields as tables.

`PUT /v1/vocabulary` with the vocabulary, then `PUT /v1/lens` with each lens, registers them (or
the service's CLI: `vocabulary set` and `lens set`). A version already registered is immutable:
re-sending it changed is 409, so a change is a new `version`. Facts carry type keys, so a type is
renamed by adding the new one and leaving the old in the vocabulary. **A lens change is free** —
writing never names a lens, so nothing is re-read — while a change to what a vocabulary's types
mean may be worth a `resetForReplay` (§7). The first lens registered is the client's default.

**Coming from 0.x**, `fromLegacyLens(definition)` splits a 0.x lens into a vocabulary and a lens
that report the same gaps and render the same page — unless the 0.x lens had a heading no type used
(0.x budgeted the page for it, so 1.0 fits a little more) or listed a section twice (0.x printed its
facts under both headings). Read its `notes`: they name every such difference, any section id or
kind slugged to the 1.0 patterns, and any extra kind dropped. Register both, keeping the 0.x id and
version.

A lens that names no asks asks its vocabulary's dimension questions. To patch those by id, hand
`extendLens` the vocabulary as a third argument and they are written out first.

## 3. Writing: the outbox pattern

The engine is enrichment. The client's own write succeeds or fails on its own, and the episode
follows it; nothing the client stores waits on the engine.

1. In the client's transaction, write the client's own row (the note, the message, the turn).
2. After commit, `addEpisode` with `sourceRef` = that row's id, `content` = what the knower said,
   `referenceAt` = when they said it, `entityHints` = what it is about when the client knows.
   `addEpisode` is idempotent on `(source, sourceRef)`: a retry answers `existing` and the same
   episode id, never a duplicate. A producer that legitimately repeats a ref appends a
   discriminator (`${turnId}#2`).
3. After that, `requestExtract(scope)`. Never inside `addEpisode`'s caller's transaction, never
   before the commit: a sweep that starts before the row exists finds nothing to cite.

A hint points into the roster; it never puts anything on it. `upsertEntity` an entity before an
episode hints it: a fact the model pins on an id that is not on the roster is dropped, and counted
as `offRoster` in the extraction's outcome.

An outbox table in the client's store makes step 2 and 3 survive a crash between the commit and
the call: write the intent in the same transaction, drain it after, delete on success. The
idempotent ref makes a drain that runs twice harmless.

`hold: "until-hinted"` records an episode the client cannot yet attribute (the first message of
a thread that will name the entity later) and keeps it out of extraction; `hintEpisodes({
sourceRefs, entityId })` names them and frees them, counting only the episodes it changed.

`extract: "inline"` plus `extractNow(scope, { maxEpisodes, deadlineMs, askedSourceRef })` is
for a turn that needs the facts now: the client runs the step itself under its own deadline and
reads `askedIngested` to know whether its own episode made it. `outcome` says why the step
stopped: `extracted`, `busy` (another worker holds this knower), `budget` (the deadline),
`failed`, `none`.

Don't loop on it. `busy` means another worker holds this knower and is reading the same pending
episodes; `budget` means the deadline came first, and what was read is kept. Either way, when
`askedIngested` is false the turn answers from what the client already holds, and
`requestExtract(scope)` hands the episode to the background sweep, which an `inline` episode does
not trigger by itself. Once `askedIngested` is true its facts are committed: the next read
includes them.

## 4. Reading

Every read that renders takes `lens`; without one it reads through the client's default.

- `brief(scope, entityId, { lens })` first. It is the page: text in the lens's sections,
  `mustHonor` for the pinned facts a reader must obey rather than consider, `gaps` for what is
  still worth asking. Null means nothing is known yet, and the client falls back to its own note.
- `readiness(scope, entityId, { lens, asOf })` when the question is how well the entity is known
  for the lens's objective, and what to learn next (§5).
- `gaps(scope, entityId, { lens })` alone, when the question is only what to ask.
- `getEntity(scope, entityId, { asOf, includeBrief, lens })` for the facts themselves, as of a
  moment when the question is what was known then. An as-of read shows each fact as it was
  believed: no end date, no successor and no retelling that came later.
- `searchFacts(scope, query, { entityId, types, asOf, limit })` for a keyword.
- `factsLearnedBy(scope, sourceRefs)` for what one source taught, current facts only: how a
  client shows "from this message, we kept…".

Every read degrades: when the engine is slow or down, answer from what the client already
holds. The timeouts above are the budget for that; a read past its timeout throws
`IntelligenceClientError` with the status, and the client catches it at the feature.

## 5. Knowing what to learn next

`readiness` answers two questions, kept apart on purpose.

**What is known** is evidence, and needs no objective: per dimension of the vocabulary, how many
current facts there are, how many are due for a revisit, and when any was last said.

**Whether it is enough** belongs to a lens. Each ask is a knowledge requirement of the lens's
objective, and stands as one of:

- `met` — at least `enough` current facts answer it, each said within its type's revisit window;
- `waiting` — an ask it comes `after` is not answered yet, so it is not offered (coarse before
  fine; an ask that does not apply to this entity holds nothing back);
- `due` — enough facts, but too few of them fresh;
- `thin` — some facts, fewer than `enough`;
- `open` — none.

Its `strength` runs from 0 to 1 (a fact due for a revisit counts for half, and never meets an ask
alone), `overall` is the weighted mean over the applicable asks, and `next` is what to do, in
order — the highest `weight · (1 − strength)` first, ties in the lens's order. A step of kind
`ask` puts the question, anchored on the facts already known so it can go one notch finer; a step
of kind `revisit` puts facts that have gone unsaid past their window back to the knower. The gaps
are the `ask` steps.

Weights order what to learn; they never weigh what is believed. The page is unchanged by any of
it — dated, not weighted — and a revisit is a question, never a judgment that a fact stopped being
true. With no `weight`, `enough`, `after` or `revisitAfterDays` declared, the gaps are exactly what
they were in 0.x.

**Closing the loop.** When the knower answers a question the client put to them, write the answer
as an episode with `inReplyTo` set to the question as it was asked. The words stay theirs —
`content` is the answer, and the export keeps the question apart — while extraction reads the
answer as an answer, so "two, both at university" after "do they have kids?" becomes facts, and
the ask closes.

**A stateless client** runs `readinessFor(lens, entity, factsKnownAt(facts, at), at)` itself.
`factsKnownAt` comes first, so a past `at` sees only what was believed then — no fact said later,
no retelling after the moment. It stamps `lastSaidAt` on a fact when a plan merges into it: the
plan's `knownAt`, never moving it back. A ledger with no `lastSaidAt` reads as last said when first
said.

## 6. Corrections and proposals

`invalidateFact(scope, factId, { at })` is the knower's own correction: the fact stops being
current and keeps its history. The engine's own corrections arrive as supersessions and need
nothing from the client.

`listProposals(scope, { entityId, status })` is what the engine would not do on its own: a name
not on the roster (`unresolved_name`), a change to one of the vocabulary's fields
(`field_update`). The client shows them, the knower decides, `resolveProposal(scope, id,
"accepted" | "dismissed")` records the decision. Accepting a field update is the client's write to
its own roster, then `upsertEntity`; the engine never writes a field.

## 7. Deletion and export

Add a `remote` entry to the client's own deletion registry, beside its tables: deleting a user
calls `deleteSubject(scope)`; removing an entity from the roster calls `deleteEntity(scope,
entityId)`, which takes its facts and every episode hinted at it or cited by its facts.
`exportSubject(scope)` returns the knower's own words, where they were said and when, with the
question each reply answered kept apart; facts and summaries are derived and stay out, by design.
`resetForReplay(scope)` forgets everything derived and marks every episode pending again, for a
new vocabulary version or a better prompt.

## 8. The usage line

`GET /v1/usage?day=YYYY-MM-DD` with the service key answers the client's model calls for a day:
requests, unpriced requests (a call that never came back is counted and left unpriced, never
shown as free), cost, by method. A client that shows cost shows this; nothing else in the engine
is a spend.

## 9. Running the service locally

The service is its own repo, and takes the package from npm like any other client:

```sh
git clone https://github.com/heymichaelp/knew-service
cd knew-service
npm install
cp .env.example .env
npm run db:start                            # one Postgres in docker compose
npm run db:migrate
npm run cli -- client add my-app --name "My app"
npm run cli -- vocabulary set my-app vocabulary.json
npm run cli -- lens set my-app lens.json
npm run dev                                 # http on 8080
npm run worker                              # the sweep, in a second terminal
```

Or the container, against any Postgres:

```sh
docker build -t knew-service .
docker run --rm -p 8080:8080 -e DATABASE_URL=postgresql://… -e OPENROUTER_API_KEY=… knew-service
docker run --rm -e DATABASE_URL=… knew-service node dist/migrate.js
docker run --rm -e DATABASE_URL=… -e OPENROUTER_API_KEY=… knew-service node dist/worker.js
```

Without `OPENROUTER_API_KEY` the service runs, registers clients, vocabularies and lenses, and
records episodes; extraction fails on its first call and the episodes stay pending.

## 10. Testing a client

`fakeIntelligence()` from `@popjoker/knew/testing` is an in-memory driver that passes the
contract suite. A client's tests bind it where `intelligenceClient` would be bound, with the
client's own lenses (all over one vocabulary; the first is the default).

```ts
import { compileLens, compileVocabulary } from "@popjoker/knew";
import { extraction, extracted, fakeIntelligence } from "@popjoker/knew/testing";

const mine = compileVocabulary(vocabulary);
const fake = fakeIntelligence({ lenses: [compileLens(prep, mine)] });      // or fakeIntelligence() for the fixture
await fake.upsertEntity(scope, { id: "linda", name: "Linda" });
fake.seedFacts(scope, "linda", [{ type: "INTEREST", fact: "Gardening" }]);  // a page without an episode
fake.script({ extraction: extraction([extracted("linda", "AVOID", "Vegan")]) }); // what the next extractNow finds
```

`script` queues what the next pending episode is read into; `extractNow` applies the same
reconciliation plan the service applies, with the same attribution rules, so a client test can
walk from a note to the page. A scripted `reconcile` returns the decisions when the test is
about a correction or a retelling.

## 11. Proving a driver

A client that wraps its own store in the contract (an in-process driver) proves it with the same
suite the service runs:

```ts
import { test } from "node:test";
import { contractSuite } from "@popjoker/knew/testing";

contractSuite({
  test,
  scripted: true,                       // false withholds the cases that need facts
  open: async () => ({
    intelligence: myDriver,             // a fresh store with the fixture vocabulary and both fixture lenses
    scope: { clientId: "c", subjectId: fresh() },
    otherScope: { clientId: "c", subjectId: fresh() },
    script: (turn) => myScriptedModel.queue(turn),
    close: async () => myDriver.deleteSubject(/* both */),
  }),
});
```

The cases are the contract: the roster and the asks, episodes once per ref, hints, scopes that
never cross, deletion, replies that keep their question, readiness by name and over time,
extraction into the page, supersession and retelling with as-of reads, two lenses over one ledger,
holds, and attribution. A driver that passes them behaves like the service for every client
feature built on the contract.

## 12. Versions

The package follows semver from 1.0.0: a change to a definition schema that keeps every
registered vocabulary and lens valid is a minor; a change to `Intelligence`, the wire types or
what the contract suite demands is a major. A preset is reviewed like API: an addition to it is a
minor, and a change to what an existing preset type means bumps the preset's version and is a
major.

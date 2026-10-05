# Adopting the engine

How a client takes `@popjoker/knew` on, in the order the questions come up. The
knewpeople app and the service in the same repo follow all of it; a second client follows it
without reading their code.

## 1. Install, and bind once per process

```sh
npm install @popjoker/knew
```

The package is ES modules for Node 22 or later, or any bundler that reads `exports`. Until it is
on a registry, `npm pack` in `packages/knew` makes a tarball that installs the same way
(`npm install ./popjoker-knew-0.1.0.tgz`).

Make one `PeopleIntelligence` per process and hand it around; never build one per request. The
HTTP client holds no connection, so the cost is only the discipline: one place knows the URL and
the key, and one place can swap the driver.

```ts
// intelligence.ts
import { intelligenceClient, type PeopleIntelligence } from "@popjoker/knew";

export const intelligence: PeopleIntelligence = intelligenceClient({
  baseUrl: process.env.INTELLIGENCE_URL!,
  serviceKey: process.env.INTELLIGENCE_SERVICE_KEY!,
  timeouts: { read: 2_000, write: 3_000, search: 2_000, export: 30_000, extractNow: 45_000, stateless: 90_000 },
});
```

Everything in the client's own code imports `intelligence` from here. The scope goes on every
call: `{ clientId, subjectId }`, where `clientId` is what the service minted the key for and
`subjectId` is the client's own id for the user whose notebook this is. A subject id means
nothing outside the client that sent it; nothing in the engine links scopes.

## 2. Register a lens

A lens is JSON. Write it in the client's repo, validate it in a test, register it once per
version at boot or by hand.

```ts
import { parseLensDefinition } from "@popjoker/knew";
import definition from "./lens.json" with { type: "json" };

parseLensDefinition(definition); // throws with the field named when the JSON is not a lens
```

`PUT /v1/lens` with the definition (or `intelligence lens set <client> lens.json` on the
service's CLI) registers it. A version already registered is immutable: re-sending it changed
is 409, so a change to the lens is a new `version`. Facts carry the type ids, so a type is
renamed by adding the new one and leaving the old in the definition.

What goes in it: `factTypes` with descriptions the model reads (`pinned` for what must be on the
page and comes back as `mustHonor`; `enduring` for what is replaced only by its own type;
attributes for structure), `briefSections` and `briefHeader` for the page, `routingFields` the
person edits and extraction may only propose, `promptFields` shown beside a name, `asks` for the
forward half, a `charter` in the client's own words about what is worth remembering and why.
`prompts.extract` and `prompts.reconcile` override the engine's neutral task prompts only when a
client has a reason; the charter is the normal place for voice.

## 3. Writing: the outbox pattern

The engine is enrichment. The client's own write succeeds or fails on its own, and the episode
follows it; nothing the client stores waits on the engine.

1. In the client's transaction, write the client's own row (the note, the message, the turn).
2. After commit, `addEpisode` with `sourceRef` = that row's id, `content` = what the person
   said, `referenceAt` = when they said it, `personHints` = who it is about when the client
   knows. `addEpisode` is idempotent on `(source, sourceRef)`: a retry answers `existing` and
   the same episode id, never a duplicate. A producer that legitimately repeats a ref appends a
   discriminator (`${turnId}#2`).
3. After that, `requestExtract(scope)`. Never inside `addEpisode`'s caller's transaction, never
   before the commit: a sweep that starts before the row exists finds nothing to cite.

An outbox table in the client's store makes step 2 and 3 survive a crash between the commit and
the call: write the intent in the same transaction, drain it after, delete on success. The
idempotent ref makes a drain that runs twice harmless.

`hold: "until-hinted"` records an episode the client cannot yet attribute (the first message of
a thread that will name the person later) and keeps it out of extraction; `hintEpisodes({
sourceRefs, personId })` names them and frees them, counting only the episodes it changed.

`extract: "inline"` plus `extractNow(scope, { maxEpisodes, deadlineMs, askedSourceRef })` is
for a turn that needs the facts now: the client runs the step itself under its own deadline and
reads `askedIngested` to know whether its own episode made it. `outcome` says why the step
stopped: `extracted`, `busy` (another worker holds this subject), `budget` (the deadline),
`failed`, `none`.

## 4. Reading

- `brief(scope, personId)` first. It is the page: text in the lens's sections, `mustHonor` for
  the pinned facts a reader must obey rather than consider, `gaps` for what is still open. Null
  means nothing is known yet, and the client falls back to its own note.
- `gaps(scope, personId)` alone, when the question is what to ask next.
- `getEntity(scope, personId, { asOf, includeBrief })` for the facts themselves, as of a moment
  when the question is what was known then. An as-of read shows each fact as it was believed:
  no end date and no successor that came later.
- `searchFacts(scope, query, { personId, types, asOf, limit })` for a keyword.
- `factsLearnedBy(scope, sourceRefs)` for what one source taught, current facts only: how a
  client shows "from this message, we kept…".

Every read degrades: when the engine is slow or down, answer from what the client already
holds. The timeouts above are the budget for that; a read past its timeout throws
`IntelligenceClientError` with the status, and the client catches it at the feature.

## 5. Corrections and proposals

`invalidateFact(scope, factId, { at })` is the person's own correction: the fact stops being
current and keeps its history. The engine's own corrections arrive as supersessions and need
nothing from the client.

`listProposals(scope, { personId, status })` is what the engine would not do on its own: a
name not on the roster (`unresolved_name`), a change to a routing field (`field_update`). The
client shows them, the person decides, `resolveProposal(scope, id, "accepted" | "dismissed")`
records the decision. Accepting a field update is the client's write to its own roster, then
`upsertPerson`; the engine never writes a routing field.

## 6. Deletion and export

Add a `remote` entry to the client's own deletion registry, beside its tables: deleting a user
calls `deleteSubject(scope)`; removing a person from the roster calls `deletePerson(scope,
personId)`, which takes their entity, their facts, and every episode hinted at them or cited by
their facts. `exportSubject(scope)` returns the person's own words, where they were said and
when; facts and summaries are derived and stay out, by design. `resetForReplay(scope)` forgets
everything derived and marks every episode pending again, for a new lens version or a better
prompt.

## 7. The usage line

`GET /v1/usage?day=YYYY-MM-DD` with the service key answers the client's model calls for a day:
requests, unpriced requests (a call that never came back is counted and left unpriced, never
shown as free), cost, by method. A client that shows cost shows this; nothing else in the engine
is a spend.

## 8. Running the service locally

From a checkout of the knewpeople repo:

```sh
npm run db:start                                   # the repo's local Postgres, on 54322
docker exec supabase_db_knewpeople psql -U postgres -c 'create database intelligence'
cp apps/intelligence/.env.example apps/intelligence/.env
npm run build -w @popjoker/knew
npm run db:migrate -w @knewpeople/intelligence-service
npm run cli -w @knewpeople/intelligence-service -- client add my-app --name "My app"
npm run cli -w @knewpeople/intelligence-service -- lens set my-app lens.json
npm run dev -w @knewpeople/intelligence-service     # http on 8080
```

Or the container, from the repo root, against any Postgres:

```sh
docker build -f apps/intelligence/Dockerfile -t knewpeople-intelligence .
docker run --rm -p 8080:8080 -e DATABASE_URL=postgresql://… -e OPENROUTER_API_KEY=… knewpeople-intelligence
docker run --rm -e DATABASE_URL=… knewpeople-intelligence node apps/intelligence/dist/migrate.js
docker run --rm -e DATABASE_URL=… -e OPENROUTER_API_KEY=… knewpeople-intelligence node apps/intelligence/dist/worker.js
```

Without `OPENROUTER_API_KEY` the service runs, registers clients and lenses, and records
episodes; extraction fails on its first call and the episodes stay pending.

## 9. Testing a client

`fakeIntelligence()` from `@popjoker/knew/testing` is an in-memory driver that passes
the contract suite. A client's tests bind it where `intelligenceClient` would be bound.

```ts
import { fakeIntelligence, fixtureLens } from "@popjoker/knew/testing";

const fake = fakeIntelligence(compileLens(parseLensDefinition(myLens)));   // or fixtureLens()
await fake.upsertPerson(scope, { id: "linda", name: "Linda" });
fake.seedFacts(scope, "linda", [{ type: "LIKES", fact: "Gardening" }]);    // a page without an episode
fake.script({ extraction: extraction([extracted("linda", "LINE", "Vegan")]) }); // what the next extractNow finds
```

`script` queues what the next pending episode is read into; `extractNow` applies the same
reconciliation plan the service applies, with the same attribution rules, so a client test can
walk from a note to the page. A scripted `reconcile` returns the decisions when the test is
about a correction.

## 10. Proving a driver

A client that wraps its own store in the contract (an in-process driver) proves it with the same
suite the service runs:

```ts
import { test } from "node:test";
import { contractSuite } from "@popjoker/knew/testing";

contractSuite({
  test,
  scripted: true,                       // false withholds the cases that need facts
  open: async () => ({
    intelligence: myDriver,             // bound to a fresh store with the fixture lens registered
    scope: { clientId: "c", subjectId: fresh() },
    otherScope: { clientId: "c", subjectId: fresh() },
    script: (turn) => myScriptedModel.queue(turn),
    close: async () => myDriver.deleteSubject(/* both */),
  }),
});
```

The cases are the contract: the roster and the asks, episodes once per ref, hints, scopes that
never cross, deletion, extraction into the page, supersession with as-of reads, holds, and
attribution. A driver that passes them behaves like the service for every client feature built
on the contract.

## 11. Versions

The package follows semver from 1.0.0: a lens-schema change that keeps every registered lens
valid is a minor; a change to `PeopleIntelligence`, the wire types or what the contract suite
demands is a major. Before 1.0.0 a minor may break, and `CHANGELOG.md` says when.

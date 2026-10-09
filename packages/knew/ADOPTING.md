# Adopting the engine

## 1. Concepts

- **Knower**: your user, whose notebook this is: the scope's `subjectId`.
- **Entity**: what the knower knows about, on their roster: a person, a place, a thing. Its `kind`
  is the vocabulary's.
- **Episode**: what the knower wrote, verbatim and dated. Facts are derived from episodes.
- **Fact**: a typed, dated statement, citing its episodes. Superseded, never edited.
- **Vocabulary**: the **dimensions** of understanding for one kind of entity, and the fact types
  that inform them.
- **Lens**: one goal over a vocabulary: its **needs** (what the goal needs understood), and how
  its page reads.

For an entity and a lens, knew reports three things:

| | Where |
|---|---|
| Current understanding | `brief().text`, and `readiness().dimensions` |
| Missing understanding | `gaps()`, and `readiness().needs` that are not `met` |
| The next directions | `readiness().next` |

knew names directions; it writes no questions.

## 2. Setup

```sh
npm install @popjoker/knew
```

ES modules, Node 22 or later. Make one client per process:

```ts
import { intelligenceClient, type Intelligence } from "@popjoker/knew";

export const intelligence: Intelligence = intelligenceClient({
  baseUrl: process.env.INTELLIGENCE_URL!,
  serviceKey: process.env.INTELLIGENCE_SERVICE_KEY!,
  timeouts: { read: 2_000, write: 3_000, search: 2_000, export: 30_000, extractNow: 45_000, stateless: 90_000 },
});
```

Every call takes a scope, `{ clientId, subjectId }`. Scopes never share data.

## 3. Define

Start from a preset (`person`, `place`, `product`) or write your own. `extendVocabulary` and
`extendLens` take a base and your overrides: a key given replaces or merges, `null` removes, a
key left out is kept. The vocabulary records `basedOn`: the base, its version, and what changed
or was added.

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
  needs: { ahead: { weight: 3 }, pursuits: { enough: 2, after: ["work"] } },
});

compileLens(prep, compileVocabulary(vocabulary)); // throws, naming every problem
```

A vocabulary and a lens written from nothing, complete:

```json
{
  "id": "places",
  "version": 1,
  "kind": "place",
  "factTypes": {
    "KIND": { "description": "What kind of place it is.", "dimension": "what", "enduring": true },
    "HOURS": { "description": "When it is open.", "dimension": "hours", "revisitAfterDays": 30 },
    "VIBE": { "description": "What it is like to be there. Several can be true at once.", "dimension": "vibe" }
  },
  "dimensions": {
    "what": { "label": "What kind of place it is" },
    "hours": { "label": "When it is open" },
    "vibe": { "label": "What it is like to be there" }
  },
  "fallbackType": "VIBE",
  "fields": [],
  "charter": "# What we keep\n\nWhat changes the next visit. Only what the note says."
}
```

```json
{
  "id": "visit",
  "version": 1,
  "vocabulary": "places",
  "header": "Before you go to {who}:",
  "overHeading": "No longer the case",
  "order": "listed",
  "needs": [{ "id": "what", "dimension": "what" }, { "id": "hours", "dimension": "hours" }, { "id": "vibe", "dimension": "vibe" }]
}
```

**Vocabulary.** `factTypes`, each informing one of the `dimensions`. On a type: `pinned` (always
on the page, returned as `mustHonor`), `enduring` (only its own type replaces it),
`revisitAfterDays` (when an unrepeated fact is due for a revisit), `attributes`. Also `fields`
(entity fields you own; extraction may only propose values), `promptFields`, and a `charter`
telling the model what to keep.

**Lens.** `objective`, `needs`, `pinned`, `sections`, `header`, `overHeading`. Left out: one
section and one need per dimension, and the vocabulary's pinned types. A need names a
`dimension` or `types` (then it needs a `label`), and may set `weight`, `enough`, `after` and
`when`. A lens that names no needs can be extended by need id if you pass the vocabulary as
`extendLens`'s third argument.

**Every field** is documented where it is declared: `dist/vocabulary.d.ts` and `dist/lens.d.ts`,
and as tables at knew.dev/lenses. Parsing and compiling refuse, naming the field:
- a type informing a dimension that doesn't exist, or a dimension with no type;
- a `fallbackType` that isn't one of your types;
- `revisitAfterDays` on an `enduring` type;
- `promptFields` that aren't among `fields`;
- a `weight` outside 0 (exclusive) to 1,000;
- a need naming both a `dimension` and `types`, or neither, or `types` with no `label`;
- a need waiting on itself or in a circle;
- a section list that misses a dimension or holds one twice.

Extraction can only write your types: its output schema lists them.

**Register** with `PUT /v1/vocabulary`, then `PUT /v1/lens` for each lens, or the service CLI's
`vocabulary set` and `lens set`. A registered version is immutable; change the `version`. The
first lens registered is the default. Changing a lens touches no stored data; changing what a
vocabulary's types mean may call for `resetForReplay`.

## 4. Write

1. In your transaction, write your own row (the note, the message).
2. After commit, `addEpisode` with `sourceRef` (your row's id), `content`, `referenceAt` and
   `entityHints`. Idempotent on `(source, sourceRef)`.
3. Then `requestExtract(scope)`, never before the commit.

An outbox table makes steps 2 and 3 survive a crash.

- **Hints** point into the roster; they never add to it. `upsertEntity` first: a fact pinned on an
  id not on the roster is dropped and counted as `offRoster`.
- **`hold: "until-hinted"`** keeps an episode out of extraction until `hintEpisodes({ sourceRefs,
  entityId })` names its entity.
- **`inReplyTo`**: when the episode answers a question your app asked, pass that question. The
  model reads the answer in context; `content` stays the knower's words.
- **Corrections and repeats** are the reconcile call's to decide, per entity, against its current
  facts: add, merge (a retelling, which moves `lastSaidAt`), supersede (the old fact ends, and is
  still read as of before), or drop. The planner guards it: a fact the model forgot to decide about
  is added, a decision citing an id it was never shown is added instead, and an `enduring` fact is
  superseded only by a fact of its own type.
- **Dates** in facts (`validAt`, `invalidAt`) are `YYYY`, `YYYY-MM` or `YYYY-MM-DD`, read as the
  start of that period at 00:00 UTC; anything else is no date. A fact ends on its `invalidAt`.
- **Inline extraction**: `extract: "inline"`, then `extractNow(scope, { maxEpisodes, deadlineMs,
  askedSourceRef })`. `outcome` is `extracted`, `busy` (another worker holds this knower),
  `budget` (deadline reached; work done is kept), `failed` or `none`. Don't loop: if
  `askedIngested` is false, answer from what you hold and call `requestExtract(scope)`. Once it is
  true, the next read includes the facts.

## 5. Read

Every read that renders takes `lens`; without it, the default lens.

- `brief(scope, entityId, { lens, asOf, maxChars })`: the page (`text`), `mustHonor`, and `gaps`.
  Null until something is known.
- `readiness(scope, entityId, { lens, asOf })`:
  - `dimensions`: per dimension, current facts, how many are due, when last said.
  - `needs`: per need, `state` (`met`, `waiting`, `due`, `thin`, `open`) and `strength` (0 to 1).
  - `next`: directions, most valuable first. Each has `kind` (`learn` where a need is open or
    thin, `revisit` where facts have gone stale), `need`, `label`, `dimension`, `types`, `value`,
    and `factIds`: the facts it builds on, readable through `getEntity`.
- `gaps(scope, entityId, { lens })`: the `learn` directions only.
- `getEntity(scope, entityId, { asOf })`: the entity and its facts as believed at `asOf`, with no
  facts when nothing is known yet; null only when it isn't on the roster. Believed is not true: a
  fact past its own end date is still listed. `factsTrueAt(view.facts, asOf)` keeps only what is
  true then.
- `searchFacts`, `factsLearnedBy(scope, sourceRefs)`, `episodes`.

Reads throw `IntelligenceClientError` past their timeout. Answer from what you hold.

**How directions are ordered.** With `order: "listed"`, in the lens's order: the first need not
met, or gone stale, comes first, whatever the weights. That is "the first of these that applies".
Otherwise (`order: "value"`, the default), a direction's value is `weight × (1 − strength)`. A fact due for a
revisit counts half, so with `enough: 1` a stale need of weight `w` ranks like an open need of
weight `w / 2`. Use `after` for coarse-before-fine, not weights. With equal weights, directions
follow the lens's order. A fact is due once `revisitAfterDays` days have passed since it was last
said (or recorded); on that day, it is due. Weights order directions only: the page is never
reweighted.

**Stateless.** Run `readinessFor(lens, entity, factsKnownAt(facts, at), at)` yourself. When you
apply a plan's merge, set `lastSaidAt` to the plan's `knownAt` if later.

## 6. Corrections, proposals, deletion

- `invalidateFact(scope, factId, { at })`: the knower's correction. The fact ends; its history stays.
- `listProposals` and `resolveProposal`: names not on the roster, and field values the engine
  would set. Accepting a field update means your own write, then `upsertEntity`.
- `deleteEntity(scope, entityId)` removes the entity, its facts and its episodes.
  `deleteSubject(scope)` removes everything in the scope. `exportSubject(scope)` returns the
  knower's episodes. `resetForReplay(scope)` drops derived facts so extraction can rerun.
- `GET /v1/usage?day=YYYY-MM-DD`: model calls and cost for a day.

## 7. Testing

`fakeIntelligence()` from `@popjoker/knew/testing` passes the contract suite. Bind it where
`intelligenceClient` would go, with your own lenses (one vocabulary; the first lens is the default):

```ts
import { compileLens, compileVocabulary } from "@popjoker/knew";
import { extraction, extracted, fakeIntelligence } from "@popjoker/knew/testing";

const fake = fakeIntelligence({ lenses: [compileLens(prep, compileVocabulary(vocabulary))] });
await fake.upsertEntity(scope, { id: "linda", name: "Linda" });
fake.seedFacts(scope, "linda", [{ type: "INTEREST", fact: "Gardening" }]);
fake.script({ extraction: extraction([extracted("linda", "AVOID", "Vegan")]) });
```

`script` queues what the next `extractNow` reads an episode into. The queue is shared across
scopes: each episode read takes the next turn, earliest said first, and an episode with no turn
left stays pending.

**Proving a driver.** An in-process driver passes the same suite the service runs:

```ts
import { test } from "node:test";
import { contractSuite } from "@popjoker/knew/testing";

contractSuite({
  test,
  scripted: true,
  open: async () => ({
    intelligence: myDriver, // a fresh store with the fixture vocabulary and both fixture lenses
    scope: { clientId: "c", subjectId: fresh() },
    otherScope: { clientId: "c", subjectId: fresh() },
    script: (turn) => myScriptedModel.queue(turn),
    close: async () => myDriver.deleteSubject(/* both */),
  }),
});
```

## 8. Running the service

The service is `heymichaelp/knew-service`:

```sh
git clone https://github.com/heymichaelp/knew-service
cd knew-service
npm install
cp .env.example .env
npm run db:start && npm run db:migrate
npm run cli -- client add my-app --name "My app"
npm run cli -- vocabulary set my-app vocabulary.json
npm run cli -- lens set my-app lens.json
npm run dev       # http on 8080
npm run worker    # the extraction sweep
```

Without `OPENROUTER_API_KEY`, everything but extraction works; episodes stay pending.

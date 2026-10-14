# Adopting the engine

## 1. Concepts

- **Knower**: your user, whose notebook this is: the scope's `subjectId`. They are also on their
  own roster, as `self` (`KNOWER_ID`).
- **Entity**: what the knower knows about, on their roster: a person, a place, a thing. Its `kind`
  is the vocabulary's.
- **Episode**: what the knower wrote, verbatim and dated. Facts are derived from episodes.
- **Fact**: a typed, dated statement, citing its episodes. Superseded, never edited.
- **Vocabulary**: the **dimensions** of understanding for one kind of entity, and the fact types
  that inform them. A dimension is about one of three subjects:
  - **the entity** (the default);
  - **the relationship** between the knower and the entity, kept on the entity, one to each;
  - **the knower**, kept on `self`, and the same beside every entity.
- **Lens**: one goal over a vocabulary: its **needs** (what the goal needs understood), and how
  its page reads.
- **Adapter**: one kind of **move** an app may make about an entity — a moment to mark, a search
  to run — as instructions and fields for the model. Once a note is read, the model proposes what
  that kind calls for, resting on the facts; the app decides what to do with it.

For an entity and a lens, knew reports three things, and a fourth under each adapter:

| | Where |
|---|---|
| Current understanding | `brief().text`, and `readiness().dimensions`, across all three subjects |
| Missing understanding | `gaps()`, and `readiness().needs` that are not `met` |
| The next directions | `readiness().next`: what the model proposed learning, inside the dimensions, and what to revisit |
| Moves | `moves()`: what each adapter's kind calls for now, resting on facts, newest first |

knew names what to learn next and what a move calls for; it writes no questions and performs no
action.

## 2. Run it

```sh
npm install @popjoker/knew
```

ES modules; Node 22 or later, React Native, or the browser. There are three ways to run the same
contract, `Intelligence`, and the rest of this guide applies to all three.

### In your process, on your own key

`localIntelligence` is the whole engine in your process: the roster, the episodes, extraction,
reconciliation, the page and readiness. You supply the model; nothing is hosted.

```ts
import { localIntelligence, memoryStore, type Intelligence } from "@popjoker/knew";
import { anthropicModel } from "@popjoker/knew/anthropic"; // npm install @anthropic-ai/sdk

export const intelligence = localIntelligence({
  lenses: [lens], // compiled, over one vocabulary (section 3); the first is the default
  adapters: [moments], // compiled, over the same vocabulary; optional
  model: anthropicModel({ apiKey: process.env.ANTHROPIC_API_KEY }),
  store: memoryStore(), // the default; see below
});
```

- **The model** is a function: `(request) => Promise<{ output, model?, usage? }>`. A request has
  `task` (`extract`, `reconcile`, `next` or `move`), `system`, `prompt`, a JSON `schema` the
  answer must match, and a `signal`. Any provider works; knew checks every answer against the
  schema and refuses one that doesn't match.
- **`anthropicModel`** (`./anthropic`, with `@anthropic-ai/sdk` installed) answers with Claude:
  `claude-opus-5-5` by default, or `model: { extract, reconcile, next, move }` for one per call,
  and `effort`. The system block is cached, so the second note onward costs less.
- **Cost**: each note is one extract call, one reconcile call per entry it touches (at most
  three), and, per entry it changed, the knower aside, one `next` call and one `move` call per
  adapter. `extractNow` returns `calls`, each with its model and usage; a cost the provider didn't
  report is `null`, never zero.
- **Directions**: once a note is folded in, the model is asked what to learn next about each
  entity it changed, and what it proposes is kept on the entity (section 5). Someone newly added
  gets first directions in the background; pass `directions: { onAdd: false }` for a bulk import.
  A `next` call that fails costs nothing but its proposals: the facts are already in.
- **Moves**: then, under each adapter in `adapters`, the model is asked what that kind of move
  calls for about the entity, and what it proposes is kept the same way (section 5). Never on
  add: a move rests on facts a note brought. A `move` call that fails costs nothing but its
  proposals either.
- **The store** keeps each knower's notebook as one JSON-safe record (`ScopeRecord`, dates as ISO
  strings). `memoryStore()` holds it in memory. Your own is three calls: `get(scope)`,
  `put(scope, record)` and `delete(scope)`, over a SQLite row, AsyncStorage, a file or your
  database. Each operation reads and writes the whole record, which suits notebooks of up to a few
  thousand facts. Use one driver per store.
- **Background reads**: `addEpisode`, `hintEpisodes` and `requestExtract` start a read in your
  process, one per knower at a time. `await intelligence.settled()` waits for them. Pass
  `background: false` to read only when you call `extractNow`.
- **Failures**: a read that fails counts an attempt, unless your own deadline cut it short. After
  three (`maxAttempts`), the episode is set aside (`gave-up:`) so later ones aren't held up.

### On the device

With `appleModel` (`./apple`), Apple's on-device model (iOS 26 and macOS 26, with Apple
Intelligence) answers every call. There's no key, and nothing leaves the phone. The engine is
plain TypeScript and runs in React Native as it is.

```ts
import { fallbackModel, localIntelligence } from "@popjoker/knew";
import { appleModel } from "@popjoker/knew/apple";
import { KnewModels } from "./native"; // your bridge to KnewFoundationModels.swift

const onDevice = appleModel({
  respond: (call) => KnewModels.respond(call.instructions, call.prompt, JSON.stringify(call.schema)),
});
export const intelligence = localIntelligence({ lenses: [lens], model: onDevice, store: myStore });
```

- **The bridge**: add `apple/KnewFoundationModels.swift` (shipped in this package) to your app,
  and expose `KnewFoundationModels.respond(instructions:prompt:schemaJSON:)` and `availability()`
  to JavaScript. With Expo, that's an Expo module whose `AsyncFunction("respond")` awaits
  `respond`; in bare React Native, a native module that does the same. A failure must reach
  JavaScript with its `code` (`context`, `unavailable`, `unsupported-language`, `guardrail`).
  The Swift file is a reference: build and check it on a device.
- **Room**: the on-device model reads about 4,096 tokens in all. A short note against a small
  roster fits; a long note, or reconciling against many facts, may not. A request past the budget
  is refused before the call (`ModelContextError`), and the episode waits. The budget is an
  estimate unless you pass `measure`: a bridge to `KnewFoundationModels.measure` (iOS 26.4), which
  counts the call with Apple's own tokenizer and reports the model's window. The estimate runs
  low against Apple's count, so without `measure` Apple may refuse a request the estimate let
  through; that refusal is a `ModelContextError` too.
- **Your key as the fallback**: `fallbackModel(onDevice, anthropicModel({ apiKey }))` sends a
  request that doesn't fit, or a device without the model (`ModelUnavailableError`), to your key
  instead. Leave it out to keep everything on the device. `calls` shows which model read each note.
- **Quality**: the on-device model is small. It hasn't been measured on knew's notes yet, so try it
  on yours before relying on it.

### Hosted

The knew service (section 8) stores the notebooks and runs extraction on its own key. Make one
client per process:

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

Start from a preset (`person`, `place`, `product`) or write your own. `extendVocabulary`,
`extendLens` and `extendAdapter` take a base and your overrides: a key given replaces or merges,
`null` removes, a key left out is kept. The vocabulary records `basedOn`: the base, its version,
and what changed or was added.

```ts
import { compileAdapter, compileLens, compileVocabulary, extendAdapter, extendLens, extendVocabulary } from "@popjoker/knew";
import { person } from "@popjoker/knew/presets";

export const vocabulary = extendVocabulary(person.vocabulary(), {
  id: "my-app",
  version: 1,
  factTypes: { HOME: { revisitAfterDays: null } }, // switch a preset default off
  charter: "# What we keep\n\n…",
});

export const prep = extendLens(person.lens(), {
  id: "prep",
  version: 1,
  vocabulary: "my-app",
  objective: "Walk into the next conversation ready.",
  needs: { ahead: { weight: 3 }, pursuits: { enough: 2, after: ["work"] } },
});

// A host's moments: the preset's kind of move, with its own instructions and a field more.
export const hospitality = extendAdapter(person.moments(), {
  id: "hospitality",
  version: 1,
  vocabulary: "my-app",
  instructions: "**A moment** is a small kindness at the table: a dish they mentioned, a seat by the window, a word about the thing they are training for.\n\nTheir words only…",
  fields: { gesture: { description: "What the host does.", kind: "enum", values: ["dish", "table", "word"] } },
});

const compiled = compileVocabulary(vocabulary);
compileLens(prep, compiled); // throws, naming every problem
compileAdapter(hospitality, compiled);
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
(entity fields you own; extraction may only propose values), `promptFields`, a `charter`
telling the model what to keep, and `directions`: how many directions the model may hold open
per dimension (2) and after how many days one nobody acted on lapses (180), or `false` for none.

**Subjects.** Give a dimension `about: "relationship"` or `about: "knower"`. A gift lens can then
need what they love (the entity), how you know each other (the relationship) and what you can
spend (the knower), and readiness ranks all three:

```json
"dimensions": {
  "pursuits": { "label": "What they love" },
  "between": { "label": "How you know each other", "about": "relationship" },
  "you": { "label": "About you", "about": "knower" }
}
```

The person preset has all three. A need's `types` must all be about one subject; the fallback type
is about the entity. Knower dimensions are left out of a lens's default sections: the page prints
them only where a lens's `sections` place them.

**Lens.** `objective`, `needs`, `pinned`, `sections`, `header`, `overHeading`. Left out: one
section and one need per dimension, and the vocabulary's pinned types. A need names a
`dimension` or `types` (then it needs a `label`), and may set `weight`, `enough`, `after` and
`when`. A lens that names no needs can be extended by need id if you pass the vocabulary as
`extendLens`'s third argument.

**Adapter.** `id` (stored on every move it proposes, so never renamed), `vocabulary`, a `noun`
for one move of its kind ("moment", "search"), `instructions` for the model in the charter's
voice (what to propose, and what never to), `fields` a move carries beside its label (each
`text`, a `date` or an `enum` of `values`, filled by the model from the facts or left null; at
most six), `perEntity` (open moves per entity, 3), `lapse` (`afterDays` from when a move was
proposed, 90; or, naming a `date` field in `field`, the day after the day the move names, when it
has one) and `dimensions` (what a move may rest on; left out, every dimension about the entity or
the relationship). Nothing is proposed about the knower, and nothing rests on a pinned fact. The
person preset ships two: `moments` (a small thing to do for them at the right time, with `when`)
and `watches` (something in the world around them to keep an eye on, as a search `query` and a
`why`, for the app to run or not).

**Every field** is documented where it is declared: `dist/vocabulary.d.ts`, `dist/lens.d.ts`
and `dist/adapter.d.ts`, and as tables at knew.dev/lenses. Parsing and compiling refuse, naming
the field:
- a type informing a dimension that doesn't exist, or a dimension with no type;
- a `fallbackType` that isn't one of your types;
- `revisitAfterDays` on an `enduring` type;
- `promptFields` that aren't among `fields`;
- `directions` with `perDimension` or `lapseAfterDays` below 1;
- a `weight` outside 0 (exclusive) to 1,000;
- a need naming both a `dimension` and `types`, or neither, or `types` with no `label`;
- a need waiting on itself or in a circle;
- a section list that misses a dimension or holds one twice;
- an adapter's `enum` field without `values` (or `values` on another kind), a `lapse.field` that
  is not one of its `date` fields, more than six fields, or a dimension that doesn't exist or is
  about the knower.

Extraction can only write your types: its output schema lists them.

**In your process**, pass the compiled lenses and adapters to `localIntelligence`. **Hosted**,
register with `PUT /v1/vocabulary`, then `PUT /v1/lens` for each lens and `PUT /v1/adapter` for
each adapter, or the service CLI's `vocabulary set` and `lens set`. A registered version is
immutable; change the `version`. The first lens registered is the default. Changing a lens or an
adapter touches no stored data; changing what a vocabulary's types mean may call for
`resetForReplay`.

## 4. Write

1. In your transaction, write your own row (the note, the message).
2. After commit, `addEpisode` with `sourceRef` (your row's id), `content`, `referenceAt` and
   `entityHints`. Idempotent on `(source, sourceRef)`.
3. Then `requestExtract(scope)`, never before the commit.

An outbox table makes steps 2 and 3 survive a crash. In your process, `addEpisode` itself starts a
background read (unless you passed `background: false`), so step 3 is only needed after a hint or
to retry.

- **Hints** point into the roster; they never add to it. `upsertEntity` first: a fact pinned on an
  id not on the roster is dropped and counted as `offRoster`.
- **The knower** is always on the roster, as `self`. Name them with
  `upsertEntity(scope, { id: "self", name })` so extraction can read "I" and "me" as them. A fact
  about the knower goes on `self`; a fact about the relationship goes on the entity. A fact filed
  under the wrong one is dropped and counted as `misattributed`.
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
- `readiness(scope, entityId, { lens, asOf })`, which reads what is known about the knower beside
  the entity, without being asked:
  - `dimensions`: per dimension, its `about`, current facts, how many are due, when last said.
  - `needs`: per need, `state` (`met`, `waiting`, `due`, `thin`, `open`) and `strength` (0 to 1).
  - `next`: directions, most valuable first, across all three subjects. Each has `kind` (`learn`
    or `revisit`), `need`, `label`, `about`, `dimension`, `types`, `value`, `factIds` (the facts it
    builds on, in any subject, readable through `getEntity`; the knower's through
    `getEntity(scope, "self")`), and `id` with `proposedAt`: set for a direction the model
    proposed, null for a need with none yet, whose label is the need's. A need about the knower
    met once is met for every entity.
- `gaps(scope, entityId, { lens })`: the `learn` directions of the needs still open or thin.
- `moves(scope, { entityId, adapter, status, asOf })`: the moves proposed under your adapters,
  newest first and never ranked. Left to itself, the open ones live at `asOf`; with a `status`,
  every move of that status as of then (`open` including the lapsed). Each has `adapter`,
  `label`, `fields`, `factIds`, `episodeId`, `proposedAt`, `status` and `resolvedAt`.
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

**What to learn next.** A direction the model proposed is one specific thing to learn about the
entity, inside one dimension of the vocabulary: "whether she has a partner", "which gym he trains
at", "whether she follows the Broncos" once you know she grew up in Denver. The `next` call makes
them once a note is folded in, instructed with every dimension's definition and the charter, and
shown what was just learned, the rest of what is known, and the directions already open; the
engine keeps what fits (a topic, not a question; inside a dimension offered; citing facts that are
current; no repeat of one open or dismissed; within the room) and counts the rest as refused
(`directions.rejected` on the episode's outcome).

- A direction belongs to the need of its dimension, or to the first need whose types reach into
  it. In a need still open or thin it is worth what the need is worth; in a need already met, what
  a stale fact is (`dueCredit`), so the basics come first and the threads follow. A need the lens
  has waiting hides its directions until they are unblocked; nothing is proposed about the knower.
- A later fact answers it (a plain "no" included) and it leaves `next`; as of a day before that,
  it was still open. The model may withdraw one that no longer fits. `invalidateFact` withdraws
  one whose every ground is gone; a supersession moves it to the replacement.
- `dismissDirection(scope, directionId, { at })`: the knower waves it away, and the model is
  refused a repeat of it.
- One nobody acts on lapses from `next` after `directions.lapseAfterDays` (180), without being
  written to.
- Derived like a fact: `resetForReplay` drops them, and the next read proposes afresh.

**Moves.** A move is what one adapter's kind calls for about the entity, in one line, with the
adapter's fields: "wish her luck at the village show" with `when: 2026-03-14` under `moments`;
"Kraków earthquake" with a `why` under `watches`, once you know her family is from there. The
`move` call makes them once a note is folded in, after `next`, under each adapter in turn:
instructed with the adapter's instructions, the charter, the fact types and the adapter's
dimensions, and shown the pinned facts to keep clear of, what was just learned, the rest of what
is known, the adapter's fields, and the moves of that kind already open. The engine keeps what
fits (resting on facts that are current, not pinned, and inside the adapter's dimensions; a line,
not a question; no repeat of one open or dismissed, judged on the label and the date field;
within `perEntity`) and counts the rest as refused (`moves.rejected` on the episode's outcome).

- The model may close an open move: `done` when the new facts show it happened, `answered` when
  they make it unnecessary, or `stale`, which withdraws it. `invalidateFact` withdraws one whose
  every ground is gone; a supersession moves it to the replacement.
- `resolveMove(scope, moveId, "done" | "dismissed", { at })`: the app did it, or the knower
  waved it away. Either leaves the list as of `at`; a dismissed move is refused the model as a
  repeat, while one done or answered may come round again.
- One nobody acts on lapses from the list the day after the day its `date` field names, or, with
  none, `lapse.afterDays` after it was proposed, without being written to; by `status: "open"` it
  is still listed, and still open for the model to close.
- knew performs nothing: it sends no message, books nothing, runs no search. A watch is
  parameters, and whether and when to search is the app's decision.
- Derived like a fact: `resetForReplay` drops them.

**Stateless.** If your app keeps its own store, read each note with
`statelessIntelligence({ vocabulary, model, adapters }).extract({ roster, entities, episode })`
in your process (or `intelligenceClient(...).extract` hosted). Each returns a `ReconciliationPlan`
per entry for you to apply. Pass `self` in the roster and its facts in `entities` to reconcile
what the knower says about themselves. When you apply a plan's merge, set `lastSaidAt` to the
plan's `knownAt` if later. Then, per entity the note changed, `.next({ entity, facts, learned,
directions })` returns a `DirectionPlan`; apply it with `applyDirectionPlan(directions, plan, {
entityId, at, episodeId, newId })`. And, per adapter, `.move({ adapter, entity, facts, learned,
moves })` returns a `MovePlan`; apply it with `applyMovePlan(moves, plan, { adapter, entityId,
at, episodeId, newId })`, and list with `liveMovesAt(moves, adapter, at)`. Run
`readinessFor(lens, entity, factsKnownAt(facts, at), at, factsKnownAt(knowerFacts, at),
directions)` yourself.

## 6. Corrections, proposals, deletion

- `invalidateFact(scope, factId, { at })`: the knower's correction. The fact ends; its history stays.
- `listProposals` and `resolveProposal`: names not on the roster, and field values the engine
  would set. Accepting a field update means your own write, then `upsertEntity`.
- `dismissDirection(scope, directionId, { at })`: a direction the knower waves away. It leaves
  `next`, and the model is refused a repeat of it.
- `resolveMove(scope, moveId, "done" | "dismissed", { at })`: a move the app did, or the knower
  waved away. It leaves `moves()`, and a dismissed one is refused the model as a repeat.
- `deleteEntity(scope, entityId)` removes the entity, its facts and its episodes.
  `deleteSubject(scope)` removes everything in the scope. `exportSubject(scope)` returns the
  knower's episodes. `resetForReplay(scope)` drops derived facts so extraction can rerun.
- `GET /v1/usage?day=YYYY-MM-DD`: model calls and cost for a day.

## 7. Testing

`fakeIntelligence()` from `@popjoker/knew/testing` passes the contract suite. Bind it where
`intelligenceClient` would go, with your own lenses and adapters (one vocabulary; the first lens
is the default):

```ts
import { compileAdapter, compileLens, compileVocabulary } from "@popjoker/knew";
import { extraction, extracted, fakeIntelligence } from "@popjoker/knew/testing";

const compiled = compileVocabulary(vocabulary);
const fake = fakeIntelligence({ lenses: [compileLens(prep, compiled)], adapters: [compileAdapter(hospitality, compiled)] });
await fake.upsertEntity(scope, { id: "linda", name: "Linda" });
fake.seedFacts(scope, "linda", [{ type: "INTEREST", fact: "Gardening" }]);
fake.script({ extraction: extraction([extracted("linda", "AVOID", "Vegan")]) });
```

`script` queues what the next `extractNow` reads an episode into. The queue is shared across
scopes: each episode read takes the next turn, earliest said first, and an episode with no turn
left stays pending. A turn's `next` answers the `next` call for each entity the episode changed,
given its name, the facts just learned, the rest of what is known and the directions open; a
turn's `move` answers the `move` call under each adapter, given the adapter's id and the same,
with the moves of that kind open. Left out, nothing is proposed, so a test that says nothing about
directions or moves reads as before.

**Proving a driver.** An in-process driver passes the same suite the service runs:

```ts
import { test } from "node:test";
import { contractSuite } from "@popjoker/knew/testing";

contractSuite({
  test,
  scripted: true,
  open: async () => ({
    intelligence: myDriver, // a fresh store with the fixture vocabulary, the three fixture lenses and the fixture adapter
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

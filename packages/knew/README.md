# @popjoker/knew

knew models what someone understands about a person, place or thing, about their relationship
with it, and about themselves, as **dimensions** of understanding built from what they write down.
For a goal, it reports:

- **Current understanding**: dated facts, by dimension.
- **Missing understanding**: what the goal needs that is not yet known.
- **The next directions**: specific things to learn, which the model proposes inside the
  dimensions from what is known, and understanding to revisit.
- **Moves**: under an adapter you register — a moment to mark, a search to run — what that kind
  of move calls for now, proposed from the facts for your app to act on.

It names what to learn next and what a move calls for; it writes no questions and performs no
action. What to do with a direction or a move is your app's call.

## Concepts

- **Episode**: something the user wrote, stored verbatim and dated.
- **Fact**: a typed, dated statement extracted from episodes. Superseded, never edited.
- **Vocabulary**: the fact types and dimensions for one kind of entity.
- **Lens**: a goal over a vocabulary: what it needs understood, and how its page reads.
- **Adapter**: one kind of move an app may make about an entity, as instructions and fields for the
  model; a **move** is one such proposal, resting on facts.

## Use

```sh
npm install @popjoker/knew @anthropic-ai/sdk
```

```ts
import { compileAdapter, compileLens, compileVocabulary, localIntelligence } from "@popjoker/knew";
import { anthropicModel } from "@popjoker/knew/anthropic";
import { person } from "@popjoker/knew/presets";

// The whole engine, in your process, on your own key. Nothing is hosted.
const vocabulary = compileVocabulary(person.vocabulary());
const knew = localIntelligence({
  lenses: [compileLens(person.lens(), vocabulary)],
  adapters: [compileAdapter(person.moments(), vocabulary)], // optional: a kind of move to propose
  model: anthropicModel({ apiKey: process.env.ANTHROPIC_API_KEY }),
});

const scope = { clientId: "my-app", subjectId: user.id };
await knew.upsertEntity(scope, { id: "mia", name: "Mia" });
await knew.addEpisode(scope, {
  source: "note",
  content: "Mia's training for the Leeds marathon in April. I've known her since uni.",
  entityHints: ["mia"],
  extract: "inline",
});
await knew.extractNow(scope, { maxEpisodes: 5 }); // four model calls, on your key

const brief = await knew.brief(scope, "mia"); // the page; null until something is known
const readiness = await knew.readiness(scope, "mia"); // current, missing, and what to learn next
const moves = await knew.moves(scope, { entityId: "mia" }); // what the moments adapter proposed, newest first
```

Three ways to run it, one contract (`Intelligence`):

- **In your process**: `localIntelligence` with your own model key, keeping each user's notebook
  in a store you choose (in memory by default). `anthropicModel` is in `./anthropic`; any
  function that answers a prompt with JSON for a schema works (`Model`).
- **On the device**: the same, with `appleModel` from `./apple` (Apple's on-device model, through a
  Swift bridge the package ships in `apple/`). No key, and nothing leaves the phone.
  `fallbackModel` sends what does not fit to your key instead.
- **Hosted**: `intelligenceClient` against the knew service.

Start a vocabulary, a lens and an adapter from a preset:

```ts
import { extendAdapter, extendLens, extendVocabulary } from "@popjoker/knew";
import { person } from "@popjoker/knew/presets";

const vocabulary = extendVocabulary(person.vocabulary(), { id: "my-app", version: 1, charter: "# What we keep…" });
const lens = extendLens(person.lens(), { id: "know-them", version: 1, vocabulary: "my-app" });
const moments = extendAdapter(person.moments(), { id: "moments", version: 1, vocabulary: "my-app" });
```

## Contents

- `Intelligence`, the contract, with drivers: `localIntelligence` (in your process),
  `intelligenceClient` (HTTP) and `fakeIntelligence` in `./testing` (scripted, for tests).
  `moves` and `resolveMove` are on it, beside the reads.
- Models: the `Model` function type; `anthropicModel` in `./anthropic`; `appleModel` in `./apple`;
  `fallbackModel`.
- Stateless mode: `statelessIntelligence(...).extract` (in your process) or
  `intelligenceClient(...).extract` (hosted) returns a `ReconciliationPlan` per entity to apply to
  your own store; `.next` returns a `DirectionPlan` of what to learn next about one entity;
  `.move` a `MovePlan` of what one adapter's kind calls for.
- Pure functions: `renderBrief`, `readinessFor`, `gapsFor`, `mustHonorFrom`,
  `planReconciliation`, `planDirections`, `applyDirectionPlan`, `planMoves`, `applyMovePlan`,
  `liveMovesAt`, `factsKnownAt`, `factsTrueAt`.
- Definitions: `compileVocabulary`, `compileLens`, `compileAdapter`, `extendVocabulary`,
  `extendLens`, `extendAdapter`, `ENGINE_DEFAULTS`.
- Presets in `./presets`: `person` (with the `moments` and `watches` adapters), `place`, `product`.
- `contractSuite` in `./testing`, to prove a driver.

No database, no network of its own: the model is yours. Node 22 or later, React Native and the
browser; ES modules; one dependency (zod 4), and `@anthropic-ai/sdk` only if you import
`./anthropic`. MIT.

## Docs

- [Adopting](https://knew.dev/adopting), also `ADOPTING.md` in this package.
- [Vocabularies, lenses and adapters](https://knew.dev/lenses): every field. Offline, the same
  fields are documented in `dist/vocabulary.d.ts`, `dist/lens.d.ts` and `dist/adapter.d.ts`.
- [Presets](https://knew.dev/presets), [API](https://knew.dev/api),
  [Contract](https://knew.dev/contract), [Changelog](https://knew.dev/changelog).

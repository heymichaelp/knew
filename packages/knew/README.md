# @popjoker/knew

knew models what someone understands about a person, place or thing as **dimensions** of
understanding, built from what they write down. For a goal, it reports:

- **Current understanding**: dated facts, by dimension.
- **Missing understanding**: what the goal needs that is not yet known.
- **The next direction**: the most valuable need to learn more about, or understanding to revisit.

It writes no questions. What to do with a direction is your app's call.

## Concepts

- **Episode**: something the user wrote, stored verbatim and dated.
- **Fact**: a typed, dated statement extracted from episodes. Superseded, never edited.
- **Vocabulary**: the fact types and dimensions for one kind of entity.
- **Lens**: a goal over a vocabulary: what it needs understood, and how its page reads.

## Use

```sh
npm install @popjoker/knew
```

```ts
import { intelligenceClient } from "@popjoker/knew";

const intelligence = intelligenceClient({
  baseUrl: process.env.INTELLIGENCE_URL!,
  serviceKey: process.env.INTELLIGENCE_SERVICE_KEY!,
});

const scope = { clientId: "my-app", subjectId: user.id };

await intelligence.upsertEntity(scope, {
  id: "linda",
  name: "Linda",
  fields: { relationship: "mother" },
});

await intelligence.addEpisode(scope, {
  source: "note",
  sourceRef: note.id,
  content: note.text,
  entityHints: ["linda"],
});

await intelligence.requestExtract(scope); // after your own transaction commits

const brief = await intelligence.brief(scope, "linda"); // the page; null until something is known
const readiness = await intelligence.readiness(scope, "linda"); // current, missing, next
```

Start a vocabulary and a lens from a preset:

```ts
import { extendLens, extendVocabulary } from "@popjoker/knew";
import { person } from "@popjoker/knew/presets";

const vocabulary = extendVocabulary(person.vocabulary(), { id: "my-app", version: 1, charter: "# What we keep…" });
const lens = extendLens(person.lens(), { id: "know-them", version: 1, vocabulary: "my-app" });
// PUT /v1/vocabulary with `vocabulary`, then PUT /v1/lens with `lens`.
```

## Contents

- `Intelligence`, the contract, with two drivers: `intelligenceClient` (HTTP) and
  `fakeIntelligence` in `./testing`.
- Stateless mode: `intelligenceClient(...).extract` returns a `ReconciliationPlan` to apply to
  your own store.
- Pure functions: `renderBrief`, `readinessFor`, `gapsFor`, `mustHonorFrom`,
  `planReconciliation`, `factsKnownAt`.
- Definitions: `compileVocabulary`, `compileLens`, `extendVocabulary`, `extendLens`,
  `ENGINE_DEFAULTS`.
- Presets in `./presets`: `person`, `place`, `product`.
- `contractSuite` in `./testing`, to prove a driver.

No database, no model, no React. Node 22 or later, ES modules, one dependency (zod 4). MIT.

## Docs

- [Adopting](https://knew.dev/adopting), also `ADOPTING.md` in this package.
- [Vocabularies and lenses](https://knew.dev/lenses): every field. Offline, the same fields are
  documented in `dist/vocabulary.d.ts` and `dist/lens.d.ts`.
- [Presets](https://knew.dev/presets), [API](https://knew.dev/api),
  [Contract](https://knew.dev/contract), [Changelog](https://knew.dev/changelog).

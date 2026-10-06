# @popjoker/knew

The attention engine's pure core — for building something where a person writes down what
they noticed and gets back a reason to lean in.

One engine, distinct clients. A client registers a **vocabulary** — what can be known about one
kind of thing: the types of fact, and the dimensions of the subject they inform — and **lenses**
over it, one per objective: how the page reads, what must be honored, what to ask next. It keeps a
**roster** per knower and records **episodes**: what the knower said, verbatim and dated. The
engine reads those into typed, dated, sourced **facts**, reconciles them against what was known
(superseding, never editing), keeps a living **summary**, renders a **brief** through a lens, and
reports **readiness**: what is known per dimension, how strongly each ask of the lens is met, and
the next thing to learn. Facts know when they were true, when they were learned and when they were
last said, so "what did we know in March?" has an answer in March's terms. What the engine may not
act on becomes a **proposal** rather than a silent write.

This package has no database, no model and no React. It is:

- **The contract**, `Intelligence`: the one door a client reaches the engine through. It carries a
  scope (`{ clientId, subjectId }`, the knower) on every call and never a database handle.
- **Drivers** of it: `intelligenceClient`, the HTTP client for the hosted service, and
  `fakeIntelligence` in `./testing` for a client's own tests. The service's Postgres driver is a
  third, on the other side of the HTTP one.
- **Stateless mode** for a client that keeps its own store: `intelligenceClient(...).extract`
  sends a roster, the facts in hand and one episode, and gets back a `ReconciliationPlan` to
  apply itself. Nothing is stored and no knower is named.
- **Vocabularies and lenses as data**: `VocabularyDefinition` and `LensDefinition`, validated by
  their schemas and compiled by `compileVocabulary` and `compileLens`. Defaults, then overrides:
  `extendVocabulary` and `extendLens` start a client's own from a base and say only what differs;
  `ENGINE_DEFAULTS` is what the engine assumes when a definition says nothing; `fromLegacyLens`
  moves a 0.x lens across.
- **Presets**, opt-in, in `./presets`: a generic `person` vocabulary and starter lens to extend.
  The core ships no content of its own.
- **The pure functions** every driver renders with: `renderBrief`, `mustHonorFrom`,
  `readinessFor`, `gapsFor`, `planReconciliation`, `factsKnownAt`, the prompt-input builders and
  the output schemas, and the neutral task prompts as data.
- **The contract suite** in `./testing`: `contractSuite` runs the same cases against any driver,
  so "implements the contract" means one thing.

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

const brief = await intelligence.brief(scope, "linda"); // null until something is known
const readiness = await intelligence.readiness(scope, "linda"); // what is known, and what to learn next
```

Start a vocabulary and a lens from the preset, and register each once per version:

```ts
import { extendLens, extendVocabulary } from "@popjoker/knew";
import { person } from "@popjoker/knew/presets";

const vocabulary = extendVocabulary(person.vocabulary(), { id: "my-app", version: 1, charter: "# What we keep…" });
const lens = extendLens(person.lens(), { id: "know-them", version: 1, vocabulary: "my-app" });
// PUT /v1/vocabulary with `vocabulary`, then PUT /v1/lens with `lens`.
```

## Documentation

[**knew.dev**](https://knew.dev) renders all of it from this package, so the docs cannot describe
a version that was never shipped.

- [Adopting the engine](https://knew.dev/adopting) — binding once per process, the vocabulary and
  its lenses, the outbox pattern, idempotency, holds and hints, readiness and the reply loop,
  timeouts, deletion, usage, running the service, testing against the fake, and proving a driver.
  Also `ADOPTING.md` in this tarball.
- [Vocabularies and lenses](https://knew.dev/lenses) — every field of both, generated from the
  schemas, with the defaults and the person preset.
- [The API](https://knew.dev/api) — the routes, the envelope, the two headers, the timeouts.
- [The contract](https://knew.dev/contract) — the cases a driver must pass, listed by the suite.
- [Privacy](https://knew.dev/privacy) — what the engine will not do, and why that is structural.
- [Changelog](https://knew.dev/changelog) — and the version rule. Also `CHANGELOG.md`.

Node 22 or later, ES modules. The only dependency is zod 4. MIT.

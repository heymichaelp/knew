# @popjoker/knew

The attention engine's pure core — for building something where a person writes down what
they noticed and gets back a reason to lean in.

One engine, distinct clients: a client registers a **lens** (what is worth keeping, how the page
reads, what to ask next), keeps a **roster** per subject, and records **episodes** — what the
subject said, verbatim and dated. The engine reads those into typed, dated, sourced **facts**,
reconciles them against what was known (superseding, never editing), keeps a living **summary**,
renders a **brief** a reader starts from, and reports the **gaps**: the lens's questions the
ledger does not yet answer. Facts know when they were true and when they were learned, so "what
did we know in March?" has an answer in March's terms. What the engine may not act on becomes a
**proposal** rather than a silent write.

This package has no database, no model and no React. It is:

- **The contract**, `PeopleIntelligence`: the one door a client reaches the engine through. It
  carries a scope (`{ clientId, subjectId }`) on every call and never a database handle.
- **Drivers** of it: `intelligenceClient`, the HTTP client for the hosted service, and
  `fakeIntelligence` in `./testing` for a client's own tests. The service's Postgres driver is a
  third, on the other side of the HTTP one.
- **Stateless mode** for a client that keeps its own store: `intelligenceClient(...).extract`
  sends a roster, the facts in hand and one episode, and gets back a `ReconciliationPlan` to
  apply itself. Nothing is stored and no subject is named.
- **Lenses as data**: `LensDefinition`, validated by `parseLensDefinition`, compiled by
  `compileLens`. The engine ships no lens of its own.
- **The pure functions** every driver renders with: `renderBrief`, `mustHonorFrom`, `gapsFor`,
  `planReconciliation`, `factsKnownAt`, the prompt-input builders and the output schemas, and the
  two neutral task prompts as data.
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

await intelligence.upsertPerson(scope, {
  id: "linda",
  name: "Linda",
  fields: { relationship: "mother" },
});

await intelligence.addEpisode(scope, {
  source: "note",
  sourceRef: note.id,
  content: note.text,
  personHints: ["linda"],
});

await intelligence.requestExtract(scope); // after your own transaction commits

const brief = await intelligence.brief(scope, "linda"); // null until something is known
const gaps = await intelligence.gaps(scope, "linda"); // what is worth asking next
```

## Documentation

[**knew.dev**](https://knew.dev) renders all of it from this package, so the docs cannot describe
a version that was never shipped.

- [Adopting the engine](https://knew.dev/adopting) — binding once per process, the outbox
  pattern, idempotency, holds and hints, timeouts, deletion, usage, running the service, testing
  against the fake, and proving a driver. Also `ADOPTING.md` in this tarball.
- [Lenses](https://knew.dev/lenses) — every field of a lens definition, generated from the schema.
- [The API](https://knew.dev/api) — the routes, the envelope, the two headers, the timeouts.
- [The contract](https://knew.dev/contract) — the cases a driver must pass, listed by the suite.
- [Privacy](https://knew.dev/privacy) — what the engine will not do, and why that is structural.
- [Changelog](https://knew.dev/changelog) — and the version rule. Also `CHANGELOG.md`.

Node 22 or later, ES modules. The only dependency is zod 4. MIT.

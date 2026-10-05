# @popjoker/knew

The people-intelligence engine's pure core. One engine, distinct clients: a client registers a
**lens** (what to remember about a person, how the page reads, what to ask next), keeps a
**roster** per subject, and records **episodes**, what the subject said, verbatim and dated. The
engine reads them into typed, dated, sourced **facts** per person, reconciles them against what
was known (superseding, never editing), keeps a living **summary**, renders a **brief** a reader
starts from, and reports the **gaps**: the lens's questions the ledger does not yet answer. What
it may not act on becomes a **proposal**.

This package has no database, no model and no React. It is:

- **The contract**, `PeopleIntelligence`: the one door a client reaches the engine through. It
  carries a scope (`{ clientId, subjectId }`) on every call and never a database handle.
- **Drivers** of it: `intelligenceClient`, the HTTP client for the hosted service
  (`apps/intelligence` in the knewpeople repo), and `fakeIntelligence` in `./testing` for a
  client's own tests. The service's Postgres driver is a third, on the other side of the HTTP one.
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

const intelligence = intelligenceClient({ baseUrl: process.env.INTELLIGENCE_URL!, serviceKey: process.env.INTELLIGENCE_SERVICE_KEY! });
const scope = { clientId: "my-app", subjectId: user.id };

await intelligence.upsertPerson(scope, { id: "linda", name: "Linda", fields: { relationship: "mother" } });
await intelligence.addEpisode(scope, { source: "note", sourceRef: note.id, content: note.text, personHints: ["linda"] });
await intelligence.requestExtract(scope);               // after your own transaction commits

const brief = await intelligence.brief(scope, "linda"); // null until something is known
const gaps = await intelligence.gaps(scope, "linda");   // what is worth asking next
```

`ADOPTING.md` is the guide: binding once per process, the outbox pattern, idempotency, holds and
hints, timeouts, deletion, usage, running the service locally, testing against the fake, and
proving a driver with the contract suite. `CHANGELOG.md` has the version rule.

Node 22 or later, ES modules. The only dependency is zod 4.

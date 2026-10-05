# Changelog

The package follows semver from 1.0.0: a change to the lens schema that keeps every registered
lens valid is a minor; a change to `PeopleIntelligence`, to the wire types or to what a driver
must do under the contract suite is a major. Before 1.0.0 a minor may break; the entries say so.

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

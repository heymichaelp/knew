# Changelog

The package follows semver from 1.0.0: a change to the lens schema that keeps every registered
lens valid is a minor; a change to `PeopleIntelligence`, to the wire types or to what a driver
must do under the contract suite is a major. Before 1.0.0 a minor may break; the entries say so.

## 0.1.1 — 2026-10-05

The first live lens found two things.

- A lens with no routing fields compiled `fieldUpdates[].field` to `never`, which JSON Schema spells `not`, and every structured-output endpoint refused the whole extract call. The field is a plain string for such a lens now, and `cleanProposals` drops any update naming a field the lens does not route; the sweep, stateless mode and the fake all pass the lens's routing fields to it. `not` joins `REFUSED_SCHEMA_KEYWORDS`, and the service refuses to register a lens whose compiled schema carries a refused keyword, instead of failing every episode later.
- `package.json` is exported, so tools that read a dependency's version can.

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

import assert from "node:assert/strict";
import type { ReconcileDecisions } from "./reconcile.ts";
import type { Extraction } from "./schemas.ts";
import type { Fact, IntelligenceScope, NewFact, PeopleIntelligence } from "./types.ts";

/**
 * The contract, as tests. Every driver of `PeopleIntelligence` — the service's Postgres
 * driver, the HTTP client in front of it, a client's own in-process driver, the fake — runs the
 * same cases from its own test file, so "it implements the contract" means one thing.
 *
 * A driver's test file supplies `open`: a fresh, empty pair of scopes under one client whose
 * lens is `fixtureLensDefinition()`, and a way to tell the engine what the next extraction
 * finds when the driver has one (a scripted model behind the service; the fake's own script).
 * Without a script, the cases that need facts are withheld rather than run: a driver that can
 * extract nothing can still prove its roster, its episodes, its scopes and its deletions.
 *
 *     import { test } from "node:test";
 *     import { contractSuite } from "@knewpeople/intelligence/testing";
 *     contractSuite({ open, test, scripted: true });
 */

/** What one extraction finds, and how it is reconciled: the model, scripted. */
export interface ScriptedTurn {
  extraction: Extraction;
  /**
   * Decisions for a person the extraction names, given what the model is shown: their name,
   * their current facts, and the incoming ones in order. Left out: everything is added and the
   * summary is "About <name>.".
   */
  reconcile?: (person: { name: string; current: Fact[] }, incoming: NewFact[]) => ReconcileDecisions;
}

export interface ContractContext {
  intelligence: PeopleIntelligence;
  /** Two scopes under one client, both empty when opened; the second proves nothing crosses. */
  scope: IntelligenceScope;
  otherScope: IntelligenceScope;
  /** Queue what the next extraction finds. Absent when the driver cannot be told. */
  script?: (turn: ScriptedTurn) => void;
  /** Leave nothing behind: the suite calls it after every case, pass or fail. */
  close(): Promise<void>;
}

export interface ContractCase {
  name: string;
  /** Needs `script`: withheld from a driver that has none. */
  scripted: boolean;
  run(context: ContractContext): Promise<void>;
}

/** An extraction as the model would answer it: facts about people by id, and what it could not place. */
export function extraction(
  facts: Extraction["facts"],
  extras: Partial<Pick<Extraction, "aliases" | "unresolvedNames" | "fieldUpdates">> = {},
): Extraction {
  return { facts, aliases: [], unresolvedNames: [], fieldUpdates: [], ...extras };
}

/** One extracted fact, attributed to a roster id. */
export function extracted(
  personId: string,
  type: string,
  fact: string,
  options: { validAt?: string | null; invalidAt?: string | null; attributes?: Record<string, unknown> | null } = {},
): Extraction["facts"][number] {
  return {
    personId,
    type,
    fact,
    attributes: options.attributes ?? null,
    validAt: options.validAt ?? null,
    invalidAt: options.invalidAt ?? null,
  } as Extraction["facts"][number];
}

const at = (iso: string) => new Date(iso);
const ids = <T extends { id: string }>(items: T[] | null) => (items ?? []).map((item) => item.id);

export function contractCases(): ContractCase[] {
  return [
    {
      name: "the roster: someone known by name has every ask open, fields merge and null clears, and someone unknown is nobody",
      scripted: false,
      async run({ intelligence: i, scope }) {
        await i.upsertPerson(scope, { id: "linda", name: "Linda", fields: { relationship: "mother" } });
        assert.deepEqual(ids(await i.gaps(scope, "linda")), ["what-they-love", "how-the-days-go"]);
        await i.upsertPerson(scope, { id: "al", name: "Al" });
        assert.deepEqual(ids(await i.gaps(scope, "al")), ["what-they-love"], "an ask with a when clause waits for the field");
        assert.equal(await i.gaps(scope, "nobody"), null);
        assert.equal(await i.getEntity(scope, "linda"), null, "nothing is known yet");
        assert.equal(await i.brief(scope, "linda"), null);
        await i.upsertPerson(scope, { id: "linda", name: "Linda", fields: { city: "Austin" } });
        assert.deepEqual(ids(await i.gaps(scope, "linda")), ["what-they-love", "how-the-days-go"], "a field not sent is kept");
        await i.upsertPerson(scope, { id: "linda", name: "Linda", fields: { relationship: null } });
        assert.deepEqual(ids(await i.gaps(scope, "linda")), ["what-they-love"], "null clears a field");
      },
    },
    {
      name: "an episode is written once per source ref, listed newest first, and exported as the words, dated",
      scripted: false,
      async run({ intelligence: i, scope }) {
        const said = at("2026-03-01T10:00:00Z");
        const first = await i.addEpisode(scope, { source: "note", sourceRef: "n-1", content: "Mom took up gardening", referenceAt: said, extract: "inline" });
        assert.equal(first.kind, "recorded");
        const again = await i.addEpisode(scope, { source: "note", sourceRef: "n-1", content: "Mom took up gardening", extract: "inline" });
        assert.deepEqual(again, { kind: "existing", episodeId: first.episodeId });
        const loose = await i.addEpisode(scope, { source: "note", content: "No ref", extract: "inline" });
        const looser = await i.addEpisode(scope, { source: "note", content: "No ref", extract: "inline" });
        assert.equal(loose.kind, "recorded");
        assert.equal(looser.kind, "recorded");
        assert.notEqual(loose.episodeId, looser.episodeId, "a ref-less episode is recorded every time");

        const listed = await i.episodes(scope, { sourceRefs: ["n-1"] });
        assert.equal(listed.length, 1);
        assert.equal(listed[0]!.id, first.episodeId);
        assert.equal(listed[0]!.content, "Mom took up gardening");
        assert.equal(listed[0]!.source, "note");
        assert.equal(listed[0]!.referenceAt.getTime(), said.getTime());
        assert.equal(listed[0]!.ingestedAt, null);
        const all = await i.episodes(scope);
        assert.equal(all.length, 3);
        assert.equal(all[2]!.id, first.episodeId, "newest first: the dated one is last");
        assert.deepEqual(ids(await i.episodes(scope, { before: at("2026-03-02T00:00:00Z") })), [first.episodeId]);
        assert.equal((await i.episodes(scope, { limit: 2 })).length, 2);

        const exported = await i.exportSubject(scope);
        assert.equal(exported.episodes.length, 3);
        const gardening = exported.episodes.find((e) => e.said === "Mom took up gardening")!;
        assert.equal(gardening.source, "note");
        assert.equal(gardening.saidAt.getTime(), said.getTime());
      },
    },
    {
      name: "a hint names the person, once, and the feed shows the episode under them",
      scripted: false,
      async run({ intelligence: i, scope }) {
        await i.upsertPerson(scope, { id: "linda", name: "Linda" });
        await i.addEpisode(scope, { source: "message", sourceRef: "m-1", content: "Took up gardening", extract: "inline" });
        assert.deepEqual(await i.episodes(scope, { personId: "linda" }), []);
        assert.deepEqual(await i.hintEpisodes(scope, { sourceRefs: ["m-1"], personId: "linda" }), { hinted: 1 });
        assert.deepEqual(await i.hintEpisodes(scope, { sourceRefs: ["m-1"], personId: "linda" }), { hinted: 0 }, "a hint already given counts nothing");
        assert.deepEqual(await i.hintEpisodes(scope, { sourceRefs: ["m-9"], personId: "linda" }), { hinted: 0 }, "a ref never recorded counts nothing");
        const under = await i.episodes(scope, { personId: "linda" });
        assert.equal(under.length, 1);
        assert.deepEqual(under[0]!.personHints, ["linda"]);
      },
    },
    {
      name: "nothing crosses scopes, and deleting a subject leaves the other alone",
      scripted: false,
      async run({ intelligence: i, scope, otherScope }) {
        await i.upsertPerson(scope, { id: "linda", name: "Linda" });
        await i.addEpisode(scope, { source: "note", sourceRef: "n-1", content: "Mine", personHints: ["linda"], extract: "inline" });
        await i.upsertPerson(otherScope, { id: "linda", name: "Another Linda" });
        const theirs = await i.addEpisode(otherScope, { source: "note", sourceRef: "n-1", content: "Theirs", extract: "inline" });
        assert.equal(theirs.kind, "recorded", "the same ref under another subject is another episode");
        assert.deepEqual((await i.episodes(scope)).map((e) => e.content), ["Mine"]);
        assert.deepEqual((await i.episodes(otherScope)).map((e) => e.content), ["Theirs"]);
        assert.deepEqual((await i.exportSubject(otherScope)).episodes.map((e) => e.said), ["Theirs"]);
        assert.equal(await i.gaps(otherScope, "al"), null);

        await i.deleteSubject(scope);
        assert.equal(await i.gaps(scope, "linda"), null);
        assert.deepEqual((await i.exportSubject(scope)).episodes, []);
        assert.deepEqual(await i.episodes(scope), []);
        assert.deepEqual((await i.exportSubject(otherScope)).episodes.map((e) => e.said), ["Theirs"]);
        assert.ok(await i.gaps(otherScope, "linda"));
      },
    },
    {
      name: "nothing pending is nothing: the inline step says so, and the background ask resolves",
      scripted: false,
      async run({ intelligence: i, scope }) {
        await i.requestExtract(scope);
        const nothing = await i.extractNow(scope, { maxEpisodes: 3, deadlineMs: 5_000 });
        assert.equal(nothing.outcome, "none");
        assert.equal(nothing.remaining, 0);
        assert.deepEqual(nothing.episodes, []);
        assert.equal(nothing.askedIngested, null);
        assert.deepEqual(nothing.calls, []);
      },
    },
    {
      name: "removing a person takes their words with them",
      scripted: false,
      async run({ intelligence: i, scope }) {
        await i.upsertPerson(scope, { id: "linda", name: "Linda" });
        await i.upsertPerson(scope, { id: "al", name: "Al" });
        await i.addEpisode(scope, { source: "note", sourceRef: "n-1", content: "About Linda", personHints: ["linda"], extract: "inline" });
        await i.addEpisode(scope, { source: "note", sourceRef: "n-2", content: "About Al", personHints: ["al"], extract: "inline" });
        assert.deepEqual(await i.deletePerson(scope, "linda"), { episodesRemoved: 1 });
        assert.equal(await i.gaps(scope, "linda"), null);
        assert.deepEqual((await i.exportSubject(scope)).episodes.map((e) => e.said), ["About Al"]);
        assert.deepEqual(await i.deletePerson(scope, "linda"), { episodesRemoved: 0 }, "gone is gone");
        assert.ok(await i.gaps(scope, "al"));
      },
    },
    {
      name: "what was said becomes facts: the page, what must be honored, the gaps, search, what a source taught, a proposal, a correction, replay",
      scripted: true,
      async run({ intelligence: i, scope, script }) {
        const said = at("2026-03-01T10:00:00Z");
        await i.upsertPerson(scope, { id: "linda", name: "Linda", fields: { relationship: "mother", city: "Austin" } });
        const first = await i.addEpisode(scope, {
          source: "message",
          sourceRef: "m-1",
          content: "Mom took up gardening",
          personHints: ["linda"],
          referenceAt: said,
          extract: "inline",
        });
        script!({
          extraction: extraction([extracted("linda", "LIKES", "Took up gardening"), extracted("linda", "LINE", "Vegan")], { unresolvedNames: ["Aunt Carol"] }),
        });
        const now = await i.extractNow(scope, { maxEpisodes: 3, deadlineMs: 30_000, askedSourceRef: "m-1" });
        assert.equal(now.outcome, "extracted");
        assert.equal(now.askedIngested, true);
        assert.equal(now.remaining, 0);
        assert.equal(now.episodes.length, 1);
        const done = now.episodes[0]!;
        assert.equal(done.episodeId, first.episodeId);
        assert.equal(done.status, "ingested");
        if (done.status === "ingested") {
          assert.deepEqual(done.facts, { added: 2, merged: 0, superseded: 0 });
          assert.equal(done.people, 1);
          assert.deepEqual(done.unresolvedNames, ["Aunt Carol"]);
        }

        const brief = (await i.brief(scope, "linda"))!;
        assert.ok(brief.text.startsWith("What we know about Linda (mother):"), brief.text);
        assert.deepEqual(brief.mustHonor, [{ type: "LINE", fact: "Vegan" }]);
        assert.deepEqual(ids(brief.gaps), ["how-the-days-go"]);

        const view = (await i.getEntity(scope, "linda", { includeBrief: true }))!;
        assert.equal(view.personId, "linda");
        assert.equal(view.summary, "About Linda.");
        assert.equal(view.facts.length, 2);
        assert.equal(view.brief!.text, brief.text);
        for (const fact of view.facts) {
          assert.ok(fact.createdAt instanceof Date);
          assert.equal(fact.createdAt.getTime(), said.getTime(), "known-at is when it was said, never when it was read");
          assert.deepEqual(fact.episodeIds, [first.episodeId]);
          assert.equal(fact.expiredAt, null);
        }

        const found = await i.searchFacts(scope, "gardening");
        assert.deepEqual(found.map((f) => f.fact), ["Took up gardening"]);
        assert.deepEqual(await i.searchFacts(scope, "gardening", { personId: "nobody" }), []);
        assert.deepEqual((await i.searchFacts(scope, "gardening", { types: ["LINE"] })).length, 0);
        const learned = await i.factsLearnedBy(scope, ["m-1", "m-9"]);
        assert.deepEqual(Object.keys(learned), ["m-1"]);
        assert.deepEqual([...learned["m-1"]!].sort(), ["Took up gardening", "Vegan"]);

        const pending = await i.listProposals(scope, { status: "pending" });
        assert.equal(pending.length, 1);
        assert.equal(pending[0]!.kind, "unresolved_name");
        assert.equal(pending[0]!.name, "Aunt Carol");
        assert.equal(pending[0]!.episodeId, first.episodeId);
        await i.resolveProposal(scope, pending[0]!.id, "dismissed");
        assert.equal((await i.listProposals(scope, { status: "pending" })).length, 0);
        assert.equal((await i.listProposals(scope))[0]!.status, "dismissed");

        await i.invalidateFact(scope, found[0]!.id);
        assert.deepEqual(await i.searchFacts(scope, "gardening"), []);
        assert.deepEqual(ids(await i.gaps(scope, "linda")), ["what-they-love", "how-the-days-go"], "a retracted fact answers nothing");
        assert.deepEqual((await i.getEntity(scope, "linda"))!.facts.map((f) => f.fact), ["Vegan"]);
        assert.deepEqual(await i.factsLearnedBy(scope, ["m-1"]), { "m-1": ["Vegan"] });

        const listed = await i.episodes(scope, { sourceRefs: ["m-1"] });
        assert.ok(listed[0]!.ingestedAt instanceof Date);

        assert.deepEqual(await i.resetForReplay(scope), { episodes: 1 });
        assert.equal(await i.brief(scope, "linda"), null, "derived is gone");
        assert.equal((await i.episodes(scope, { sourceRefs: ["m-1"] }))[0]!.ingestedAt, null, "every episode is pending again");
        assert.deepEqual((await i.exportSubject(scope)).episodes.map((e) => e.said), ["Mom took up gardening"], "the words survive");
        assert.ok(await i.gaps(scope, "linda"), "so does the roster");
      },
    },
    {
      name: "a correction supersedes, dated by when it was said, and what was known then stays answerable",
      scripted: true,
      async run({ intelligence: i, scope, script }) {
        const t1 = at("2026-01-10T00:00:00Z");
        const t2 = at("2026-02-10T00:00:00Z");
        const between = at("2026-01-20T00:00:00Z");
        await i.upsertPerson(scope, { id: "linda", name: "Linda" });
        await i.addEpisode(scope, { source: "note", sourceRef: "n-1", content: "Mom lives in Austin", personHints: ["linda"], referenceAt: t1, extract: "inline" });
        script!({ extraction: extraction([extracted("linda", "CIRCUMSTANCE", "Lives in Austin")]) });
        assert.equal((await i.extractNow(scope, { maxEpisodes: 1 })).outcome, "extracted");
        const [austin] = await i.searchFacts(scope, "Austin");
        assert.ok(austin);

        await i.addEpisode(scope, { source: "note", sourceRef: "n-2", content: "Mom moved to Denver", personHints: ["linda"], referenceAt: t2, extract: "inline" });
        script!({
          extraction: extraction([extracted("linda", "CIRCUMSTANCE", "Lives in Denver")]),
          reconcile: (person) => ({
            decisions: [{ newIndex: 0, action: "supersede", factId: person.current[0]!.id, invalidAt: null }],
            summary: "Linda, in Denver now.",
          }),
        });
        const second = await i.extractNow(scope, { maxEpisodes: 1 });
        assert.equal(second.outcome, "extracted");
        if (second.episodes[0]!.status === "ingested") assert.deepEqual(second.episodes[0]!.facts, { added: 0, merged: 0, superseded: 1 });

        const nowView = (await i.getEntity(scope, "linda"))!;
        assert.deepEqual(nowView.facts.map((f) => f.fact), ["Lives in Denver"]);
        assert.equal(nowView.summary, "Linda, in Denver now.");
        const denver = nowView.facts[0]!;
        assert.equal(denver.createdAt.getTime(), t2.getTime());
        assert.deepEqual((await i.searchFacts(scope, "Lives")).map((f) => f.fact), ["Lives in Denver"]);

        // Read as of a day between the two, the old fact is what was believed then: no end,
        // no successor, because nobody knew of either yet.
        const thenView = (await i.getEntity(scope, "linda", { asOf: between }))!;
        assert.deepEqual(thenView.facts.map((f) => f.fact), ["Lives in Austin"]);
        const old = thenView.facts[0]!;
        assert.equal(old.id, austin.id);
        assert.equal(old.expiredAt, null);
        assert.equal(old.invalidAt, null);
        assert.equal(old.supersededById, null);
        assert.equal(old.createdAt.getTime(), t1.getTime());
        assert.deepEqual((await i.searchFacts(scope, "Lives", { asOf: between })).map((f) => f.fact), ["Lives in Austin"]);
        assert.deepEqual((await i.getEntity(scope, "linda", { asOf: at("2026-01-01T00:00:00Z") }))!.facts, [], "before anything was said, nothing was known");
        const briefThen = (await i.brief(scope, "linda", { asOf: between }))!;
        assert.match(briefThen.text, /Lives in Austin/);
        assert.doesNotMatch(briefThen.text, /Denver/);
      },
    },
    {
      name: "an episode held until hinted waits, and goes once its person is named",
      scripted: true,
      async run({ intelligence: i, scope, script }) {
        await i.upsertPerson(scope, { id: "linda", name: "Linda" });
        await i.addEpisode(scope, { source: "message", sourceRef: "m-1", content: "She took up gardening", hold: "until-hinted", extract: "inline" });
        const held = await i.extractNow(scope, { maxEpisodes: 3 });
        assert.equal(held.outcome, "none");
        assert.equal(held.remaining, 0, "a held episode is not pending");
        assert.equal((await i.episodes(scope))[0]!.ingestedAt, null);

        await i.hintEpisodes(scope, { sourceRefs: ["m-1"], personId: "linda" });
        script!({ extraction: extraction([extracted("linda", "LIKES", "Gardening")]) });
        const freed = await i.extractNow(scope, { maxEpisodes: 3, askedSourceRef: "m-1" });
        assert.equal(freed.outcome, "extracted");
        assert.equal(freed.askedIngested, true);
        assert.deepEqual(await i.factsLearnedBy(scope, ["m-1"]), { "m-1": ["Gardening"] });
      },
    },
    {
      name: "a fact pinned on an id not on the roster is dropped, and a routing field is proposed rather than written",
      scripted: true,
      async run({ intelligence: i, scope, script }) {
        await i.upsertPerson(scope, { id: "linda", name: "Linda", fields: { city: "Austin" } });
        await i.addEpisode(scope, { source: "note", sourceRef: "n-1", content: "Mom and Carol moved to Denver", personHints: ["linda"], extract: "inline" });
        script!({
          extraction: extraction([extracted("linda", "EVENT", "Moved to Denver"), extracted("carol", "EVENT", "Moved to Denver")], {
            fieldUpdates: [{ personId: "linda", field: "city", value: "Denver" }],
          }),
        });
        const now = await i.extractNow(scope, { maxEpisodes: 1 });
        assert.equal(now.outcome, "extracted");
        const done = now.episodes[0]!;
        if (done.status === "ingested") {
          assert.equal(done.offRoster, 1);
          assert.deepEqual(done.facts, { added: 1, merged: 0, superseded: 0 });
        }
        assert.deepEqual((await i.getEntity(scope, "linda"))!.facts.map((f) => f.fact), ["Moved to Denver"]);
        const proposals = await i.listProposals(scope, { personId: "linda", status: "pending" });
        assert.equal(proposals.length, 1);
        assert.equal(proposals[0]!.kind, "field_update");
        assert.equal(proposals[0]!.field, "city");
        assert.equal(proposals[0]!.value, "Denver");
        assert.ok((await i.brief(scope, "linda"))!.text.includes("Moved to Denver"));
        await i.resolveProposal(scope, proposals[0]!.id, "accepted");
        assert.equal((await i.listProposals(scope, { status: "accepted" })).length, 1);
      },
    },
  ];
}

/**
 * Register the cases with a test runner. `test` is `node:test`'s `test` or `it`, or anything
 * with the same shape. `scripted` says whether `open()` supplies a script; when it does not,
 * the cases that need one are withheld and counted, never silently passed.
 */
export function contractSuite(options: {
  open: () => Promise<ContractContext>;
  test: (name: string, run: () => Promise<void>) => void;
  scripted: boolean;
}): { registered: number; withheld: number } {
  let registered = 0;
  let withheld = 0;
  for (const contractCase of contractCases()) {
    if (contractCase.scripted && !options.scripted) {
      withheld += 1;
      continue;
    }
    registered += 1;
    options.test(`contract: ${contractCase.name}`, async () => {
      const context = await options.open();
      try {
        if (contractCase.scripted && !context.script) throw new Error("the context has no script, but the suite was told it would");
        await contractCase.run(context);
      } finally {
        await context.close();
      }
    });
  }
  return { registered, withheld };
}

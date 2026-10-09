import assert from "node:assert/strict";
import type { ReconcileDecisions } from "./reconcile.ts";
import type { Extraction } from "./schemas.ts";
import type { Fact, Gap, Intelligence, IntelligenceScope, NewFact, Readiness } from "./types.ts";
import { KNOWER_ID } from "./vocabulary.ts";

/**
 * The contract, as tests. Every driver of `Intelligence` — the service's Postgres driver, the
 * HTTP client in front of it, a client's own in-process driver, the fake — runs the same cases
 * from its own test file, so "it implements the contract" means one thing.
 *
 * A driver's test file supplies `open`: a fresh, empty pair of scopes under one client whose
 * vocabulary is `fixtureVocabularyDefinition()` and whose lenses are `fixtureLensDefinition()`
 * (the default), `fixtureVisitLensDefinition()` and `fixtureGiftLensDefinition()`, and a way to tell the engine what the next
 * extraction finds when the driver has one (a scripted model behind the service; the fake's own
 * script). Without a script, the cases that need facts are withheld rather than run: a driver
 * that can extract nothing can still prove its roster, its episodes, its scopes and its
 * deletions.
 *
 *     import { test } from "node:test";
 *     import { contractSuite } from "@popjoker/knew/testing";
 *     contractSuite({ open, test, scripted: true });
 */

/** What one extraction finds, and how it is reconciled: the model, scripted. */
export interface ScriptedTurn {
  extraction: Extraction;
  /**
   * Decisions for an entity the extraction names, given what the model is shown: its name, its
   * current facts, and the incoming ones in order. Left out: everything is added and the
   * summary is "About <name>.".
   */
  reconcile?: (entity: { name: string; current: Fact[] }, incoming: NewFact[]) => ReconcileDecisions;
}

export interface ContractContext {
  intelligence: Intelligence;
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

/** An extraction as the model would answer it: facts about entities by id, and what it could not place. */
export function extraction(
  facts: Extraction["facts"],
  extras: Partial<Pick<Extraction, "aliases" | "unresolvedNames" | "fieldUpdates">> = {},
): Extraction {
  return { facts, aliases: [], unresolvedNames: [], fieldUpdates: [], ...extras };
}

/** One extracted fact, attributed to a roster id. */
export function extracted(
  entityId: string,
  type: string,
  fact: string,
  options: { validAt?: string | null; invalidAt?: string | null; attributes?: Record<string, unknown> | null } = {},
): Extraction["facts"][number] {
  return {
    entityId,
    type,
    fact,
    attributes: options.attributes ?? null,
    validAt: options.validAt ?? null,
    invalidAt: options.invalidAt ?? null,
  } as Extraction["facts"][number];
}

const at = (iso: string) => new Date(iso);
const ids = <T extends { id: string }>(items: T[] | null) => (items ?? []).map((item) => item.id);
const needs = (gaps: Gap[] | null) => (gaps ?? []).map((gap) => gap.need);
const standing = (readiness: Readiness, id: string) => readiness.needs.find((need) => need.id === id)!;

export function contractCases(): ContractCase[] {
  return [
    {
      name: "the roster: an entity known by name has every need open, fields merge and null clears, one unknown is nothing, and one of another kind is refused",
      scripted: false,
      async run({ intelligence: i, scope }) {
        await i.upsertEntity(scope, { id: "linda", name: "Linda", fields: { relationship: "mother" } });
        assert.deepEqual(needs(await i.gaps(scope, "linda")), ["what-they-love", "how-the-days-go"]);
        await i.upsertEntity(scope, { id: "al", name: "Al" });
        assert.deepEqual(needs(await i.gaps(scope, "al")), ["what-they-love"], "a need with a when clause waits for the field");
        assert.equal(await i.gaps(scope, "nobody"), null);
        const known = await i.getEntity(scope, "linda");
        assert.deepEqual([known?.id, known?.name, known?.facts], ["linda", "Linda", []], "on the roster with nothing known yet: the entity, and no facts");
        assert.equal(await i.getEntity(scope, "nobody"), null, "not on the roster: nothing");
        assert.equal(await i.brief(scope, "linda"), null);
        await i.upsertEntity(scope, { id: "linda", name: "Linda", fields: { city: "Austin" } });
        assert.deepEqual(needs(await i.gaps(scope, "linda")), ["what-they-love", "how-the-days-go"], "a field not sent is kept");
        await i.upsertEntity(scope, { id: "linda", name: "Linda", fields: { relationship: null } });
        assert.deepEqual(needs(await i.gaps(scope, "linda")), ["what-they-love"], "null clears a field");
        await assert.rejects(i.upsertEntity(scope, { id: "lisbon", name: "Lisbon", kind: "place" }), "the vocabulary describes a person, not a place");
        assert.equal(await i.gaps(scope, "lisbon"), null, "and the refused entity is not on the roster");
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
      name: "a hint names the entity, once, and the feed shows the episode under it",
      scripted: false,
      async run({ intelligence: i, scope }) {
        await i.upsertEntity(scope, { id: "linda", name: "Linda" });
        await i.addEpisode(scope, { source: "message", sourceRef: "m-1", content: "Took up gardening", extract: "inline" });
        assert.deepEqual(await i.episodes(scope, { entityId: "linda" }), []);
        assert.deepEqual(await i.hintEpisodes(scope, { sourceRefs: ["m-1"], entityId: "linda" }), { hinted: 1 });
        assert.deepEqual(await i.hintEpisodes(scope, { sourceRefs: ["m-1"], entityId: "linda" }), { hinted: 0 }, "a hint already given counts nothing");
        assert.deepEqual(await i.hintEpisodes(scope, { sourceRefs: ["m-9"], entityId: "linda" }), { hinted: 0 }, "a ref never recorded counts nothing");
        const under = await i.episodes(scope, { entityId: "linda" });
        assert.equal(under.length, 1);
        assert.deepEqual(under[0]!.entityHints, ["linda"]);
      },
    },
    {
      name: "nothing crosses scopes, and deleting a knower leaves the other alone",
      scripted: false,
      async run({ intelligence: i, scope, otherScope }) {
        await i.upsertEntity(scope, { id: "linda", name: "Linda" });
        await i.addEpisode(scope, { source: "note", sourceRef: "n-1", content: "Mine", entityHints: ["linda"], extract: "inline" });
        await i.upsertEntity(otherScope, { id: "linda", name: "Another Linda" });
        const theirs = await i.addEpisode(otherScope, { source: "note", sourceRef: "n-1", content: "Theirs", extract: "inline" });
        assert.equal(theirs.kind, "recorded", "the same ref under another knower is another episode");
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
      name: "removing an entity takes the words about it with it",
      scripted: false,
      async run({ intelligence: i, scope }) {
        await i.upsertEntity(scope, { id: "linda", name: "Linda" });
        await i.upsertEntity(scope, { id: "al", name: "Al" });
        await i.addEpisode(scope, { source: "note", sourceRef: "n-1", content: "About Linda", entityHints: ["linda"], extract: "inline" });
        await i.addEpisode(scope, { source: "note", sourceRef: "n-2", content: "About Al", entityHints: ["al"], extract: "inline" });
        assert.deepEqual(await i.deleteEntity(scope, "linda"), { episodesRemoved: 1 });
        assert.equal(await i.gaps(scope, "linda"), null);
        assert.deepEqual((await i.exportSubject(scope)).episodes.map((e) => e.said), ["About Al"]);
        assert.deepEqual(await i.deleteEntity(scope, "linda"), { episodesRemoved: 0 }, "gone is gone");
        assert.ok(await i.gaps(scope, "al"));
      },
    },
    {
      name: "an answer given in reply keeps its question beside it, never inside what was said",
      scripted: false,
      async run({ intelligence: i, scope }) {
        await i.upsertEntity(scope, { id: "linda", name: "Linda" });
        await i.addEpisode(scope, {
          source: "reply",
          sourceRef: "r-1",
          content: "Two, both at university",
          inReplyTo: "Do they have kids?",
          entityHints: ["linda"],
          referenceAt: at("2026-03-01T10:00:00Z"),
          extract: "inline",
        });
        await i.addEpisode(scope, { source: "note", sourceRef: "n-1", content: "Took up gardening", entityHints: ["linda"], referenceAt: at("2026-03-02T10:00:00Z"), extract: "inline" });
        const [note, reply] = await i.episodes(scope);
        assert.equal(reply!.content, "Two, both at university");
        assert.equal(reply!.inReplyTo, "Do they have kids?");
        assert.equal(note!.inReplyTo, null);
        const exported = await i.exportSubject(scope);
        assert.equal(exported.episodes.find((e) => e.said === "Two, both at university")!.inReplyTo, "Do they have kids?", "the question is kept, apart from the words");
        assert.equal(exported.episodes.find((e) => e.said === "Took up gardening")!.inReplyTo, null);
      },
    },
    {
      name: "readiness: an entity known by name has every applicable need open, a need waits for the one it comes after, and one unknown is nothing",
      scripted: false,
      async run({ intelligence: i, scope }) {
        await i.upsertEntity(scope, { id: "linda", name: "Linda", fields: { relationship: "mother" } });
        await i.upsertEntity(scope, { id: "al", name: "Al" });

        const plain = (await i.readiness(scope, "linda"))!;
        assert.equal(plain.lens, "fixture", "a read without a lens reads through the default");
        assert.equal(plain.objective, "Treat them well next time.");
        assert.equal(plain.overall, 0);
        assert.deepEqual(plain.needs.map((n) => [n.id, n.state]), [["what-they-love", "open"], ["how-the-days-go", "open"]]);
        assert.deepEqual(plain.next.map((d) => [d.kind, d.need, d.value]), [["learn", "what-they-love", 1], ["learn", "how-the-days-go", 1]]);
        assert.deepEqual(plain.dimensions.map((d) => [d.id, d.facts, d.due, d.lastSaidAt]), [
          ["never-cross", 0, 0, null],
          ["has", 0, 0, null],
          ["likes", 0, 0, null],
          ["life", 0, 0, null],
          ["people", 0, 0, null],
          ["between", 0, 0, null],
          ["means", 0, 0, null],
          ["other", 0, 0, null],
        ]);

        const visit = (await i.readiness(scope, "linda", { lens: "fixture-visit" }))!;
        assert.equal(visit.lens, "fixture-visit");
        assert.deepEqual(visit.needs.map((n) => [n.id, n.state, n.waitingOn]), [
          ["how-the-days-go", "open", []],
          ["what-they-love", "waiting", ["how-the-days-go"]],
          ["people", "open", []],
        ]);
        assert.deepEqual(visit.next.map((d) => [d.need, d.value]), [["how-the-days-go", 2], ["people", 1]], "the heavier need first; one waiting is not a direction");
        assert.deepEqual([visit.next[1]!.label, visit.next[1]!.dimension], ["People", "people"], "a need of a dimension borrows its label");

        const al = (await i.readiness(scope, "al", { lens: "fixture-visit" }))!;
        assert.deepEqual(al.needs.map((n) => [n.id, n.state]), [["what-they-love", "open"], ["people", "open"]], "a need that does not apply holds nothing back");
        assert.equal(await i.readiness(scope, "nobody"), null);
        await assert.rejects(i.readiness(scope, "linda", { lens: "no-such-lens" }), "a lens the client never registered is refused");
        await assert.rejects(i.gaps(scope, "linda", { lens: "no-such-lens" }), "for the gaps too");
        await assert.rejects(i.getEntity(scope, "linda", { includeBrief: true, lens: "no-such-lens" }), "and for the page");
      },
    },
    {
      name: "what was said becomes facts: the page, what must be honored, the gaps, search, what a source taught, a proposal, a correction, replay",
      scripted: true,
      async run({ intelligence: i, scope, script }) {
        const said = at("2026-03-01T10:00:00Z");
        await i.upsertEntity(scope, { id: "linda", name: "Linda", fields: { relationship: "mother", city: "Austin" } });
        const first = await i.addEpisode(scope, {
          source: "message",
          sourceRef: "m-1",
          content: "Mom took up gardening",
          entityHints: ["linda"],
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
          assert.equal(done.entities, 1);
          assert.deepEqual(done.unresolvedNames, ["Aunt Carol"]);
        }

        const brief = (await i.brief(scope, "linda"))!;
        assert.ok(brief.text.startsWith("What we know about Linda (mother):"), brief.text);
        assert.deepEqual(brief.mustHonor, [{ type: "LINE", fact: "Vegan" }]);
        assert.deepEqual(needs(brief.gaps), ["how-the-days-go"]);

        const view = (await i.getEntity(scope, "linda", { includeBrief: true }))!;
        assert.equal(view.id, "linda", "an entity is known by the client's own id");
        assert.equal(view.kind, "person", "and is of the vocabulary's kind");
        assert.equal(view.summary, "About Linda.");
        assert.equal(view.facts.length, 2);
        assert.equal(view.brief!.text, brief.text);
        for (const fact of view.facts) {
          assert.equal(fact.entityId, "linda");
          assert.ok(fact.createdAt instanceof Date);
          assert.equal(fact.createdAt.getTime(), said.getTime(), "known-at is when it was said, never when it was read");
          assert.equal(fact.lastSaidAt?.getTime(), said.getTime(), "said once, it was last said when it was first said");
          assert.deepEqual(fact.episodeIds, [first.episodeId]);
          assert.equal(fact.expiredAt, null);
        }

        const found = await i.searchFacts(scope, "gardening");
        assert.deepEqual(found.map((f) => f.fact), ["Took up gardening"]);
        assert.deepEqual(await i.searchFacts(scope, "gardening", { entityId: "nobody" }), []);
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
        assert.deepEqual(needs(await i.gaps(scope, "linda")), ["what-they-love", "how-the-days-go"], "a retracted fact counts for nothing");
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
      name: "a correction supersedes and a retelling merges, each dated by when it was said, and what was known then stays answerable",
      scripted: true,
      async run({ intelligence: i, scope, script }) {
        const t1 = at("2026-01-10T00:00:00Z");
        const t2 = at("2026-02-10T00:00:00Z");
        const between = at("2026-01-20T00:00:00Z");
        await i.upsertEntity(scope, { id: "linda", name: "Linda" });
        await i.addEpisode(scope, { source: "note", sourceRef: "n-1", content: "Mom lives in Austin", entityHints: ["linda"], referenceAt: t1, extract: "inline" });
        script!({ extraction: extraction([extracted("linda", "CIRCUMSTANCE", "Lives in Austin")]) });
        assert.equal((await i.extractNow(scope, { maxEpisodes: 1 })).outcome, "extracted");
        const [austin] = await i.searchFacts(scope, "Austin");
        assert.ok(austin);

        await i.addEpisode(scope, { source: "note", sourceRef: "n-2", content: "Mom moved to Denver", entityHints: ["linda"], referenceAt: t2, extract: "inline" });
        script!({
          extraction: extraction([extracted("linda", "CIRCUMSTANCE", "Lives in Denver")]),
          reconcile: (entity) => ({
            decisions: [{ newIndex: 0, action: "supersede", factId: entity.current[0]!.id, invalidAt: null }],
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

        // Said again, it is the same fact, last said later: a merge moves when it was last said
        // and nothing else, and a read from before the retelling never sees it.
        const t3 = at("2026-03-15T00:00:00Z");
        await i.addEpisode(scope, { source: "note", sourceRef: "n-3", content: "Mom is settling into Denver", entityHints: ["linda"], referenceAt: t3, extract: "inline" });
        script!({
          extraction: extraction([extracted("linda", "CIRCUMSTANCE", "Lives in Denver")]),
          reconcile: (entity) => ({
            decisions: [{ newIndex: 0, action: "merge", factId: entity.current[0]!.id, invalidAt: null }],
            summary: "Linda, settling into Denver.",
          }),
        });
        const third = await i.extractNow(scope, { maxEpisodes: 1 });
        assert.equal(third.outcome, "extracted");
        if (third.episodes[0]!.status === "ingested") assert.deepEqual(third.episodes[0]!.facts, { added: 0, merged: 1, superseded: 0 });
        const [retold] = (await i.getEntity(scope, "linda"))!.facts;
        assert.equal(retold!.id, denver.id);
        assert.equal(retold!.createdAt.getTime(), t2.getTime(), "first said stays when it was first said");
        assert.equal(retold!.lastSaidAt?.getTime(), t3.getTime(), "a retelling moves when it was last said");
        assert.equal(retold!.episodeIds.length, 2);
        const [beforeRetelling] = (await i.getEntity(scope, "linda", { asOf: at("2026-03-01T00:00:00Z") }))!.facts;
        assert.equal(beforeRetelling!.lastSaidAt, null, "as of a day before the retelling, it had not happened");
      },
    },
    {
      name: "readiness over time: a fact meets its need, is due for a revisit once its window passes unsaid, and is fresh again when said again",
      scripted: true,
      async run({ intelligence: i, scope, script }) {
        const t1 = at("2026-01-10T00:00:00Z");
        await i.upsertEntity(scope, { id: "linda", name: "Linda", fields: { relationship: "mother" } });
        await i.addEpisode(scope, { source: "note", sourceRef: "n-1", content: "Mom works days at the hospital now", entityHints: ["linda"], referenceAt: t1, extract: "inline" });
        script!({ extraction: extraction([extracted("linda", "CIRCUMSTANCE", "Works days at the hospital")]) });
        assert.equal((await i.extractNow(scope, { maxEpisodes: 1 })).outcome, "extracted");
        const [days] = await i.searchFacts(scope, "hospital");
        assert.ok(days);

        const fresh = (await i.readiness(scope, "linda", { asOf: at("2026-01-20T00:00:00Z") }))!;
        assert.deepEqual([standing(fresh, "how-the-days-go").state, standing(fresh, "how-the-days-go").strength], ["met", 1]);
        assert.deepEqual(fresh.next.map((d) => [d.kind, d.need]), [["learn", "what-they-love"]]);
        assert.equal(fresh.overall, 0.5);
        const life = fresh.dimensions.find((d) => d.id === "life")!;
        assert.deepEqual([life.facts, life.due, life.lastSaidAt?.getTime(), life.factIds], [1, 0, t1.getTime(), [days.id]]);

        // A hundred days on and unsaid: on the page as it always was, and due for a revisit.
        const quietly = at("2026-04-20T00:00:00Z");
        const quiet = (await i.readiness(scope, "linda", { asOf: quietly }))!;
        assert.deepEqual([standing(quiet, "how-the-days-go").state, standing(quiet, "how-the-days-go").strength], ["due", 0.5]);
        assert.deepEqual(quiet.next.map((d) => [d.kind, d.need, d.value, d.factIds]), [
          ["learn", "what-they-love", 1, []],
          ["revisit", "how-the-days-go", 0.5, [days.id]],
        ]);
        assert.equal(quiet.overall, 0.25);
        assert.equal(quiet.dimensions.find((d) => d.id === "life")!.due, 1);
        assert.deepEqual(needs(await i.gaps(scope, "linda", { asOf: quietly })), ["what-they-love"], "a fact due for a revisit still counts toward its need");
        assert.match((await i.brief(scope, "linda", { asOf: quietly }))!.text, /Works days at the hospital/);

        // Said again, it is fresh again; read from before the retelling, it is still due.
        const t2 = at("2026-04-25T00:00:00Z");
        await i.addEpisode(scope, { source: "note", sourceRef: "n-2", content: "Mom is still on days at the hospital", entityHints: ["linda"], referenceAt: t2, extract: "inline" });
        script!({
          extraction: extraction([extracted("linda", "CIRCUMSTANCE", "Works days at the hospital")]),
          reconcile: (entity) => ({
            decisions: [{ newIndex: 0, action: "merge", factId: entity.current[0]!.id, invalidAt: null }],
            summary: "Linda, on days.",
          }),
        });
        assert.equal((await i.extractNow(scope, { maxEpisodes: 1 })).outcome, "extracted");
        const again = (await i.readiness(scope, "linda", { asOf: at("2026-04-30T00:00:00Z") }))!;
        assert.equal(standing(again, "how-the-days-go").state, "met");
        assert.equal(again.dimensions.find((d) => d.id === "life")!.lastSaidAt?.getTime(), t2.getTime());
        const before = (await i.readiness(scope, "linda", { asOf: quietly }))!;
        assert.equal(standing(before, "how-the-days-go").state, "due", "as of a day before the retelling, it had not happened");
      },
    },
    {
      name: "two lenses read one ledger: the same facts make a different page and a different next direction under each",
      scripted: true,
      async run({ intelligence: i, scope, script }) {
        await i.upsertEntity(scope, { id: "linda", name: "Linda", fields: { relationship: "mother" } });
        await i.addEpisode(scope, {
          source: "note",
          sourceRef: "n-1",
          content: "Mom is vegan, has a pottery wheel and loves gardening",
          entityHints: ["linda"],
          referenceAt: at("2026-03-01T10:00:00Z"),
          extract: "inline",
        });
        script!({
          extraction: extraction([extracted("linda", "LINE", "Vegan"), extracted("linda", "HAS", "Owns a pottery wheel"), extracted("linda", "LIKES", "Gardening")]),
        });
        assert.equal((await i.extractNow(scope, { maxEpisodes: 1 })).outcome, "extracted");

        const plain = (await i.brief(scope, "linda"))!;
        const visit = (await i.brief(scope, "linda", { lens: "fixture-visit" }))!;
        assert.ok(plain.text.startsWith("What we know about Linda (mother):"), plain.text);
        assert.ok(visit.text.startsWith("Before you visit Linda (mother):"), visit.text);
        assert.ok(plain.text.includes("Already has:\n- Owns a pottery wheel"), plain.text);
        assert.ok(visit.text.includes("Mind:\n- Vegan"), visit.text);
        assert.deepEqual(plain.mustHonor.map((m) => m.type).sort(), ["HAS", "LINE"]);
        assert.deepEqual(visit.mustHonor.map((m) => m.type), ["LINE"], "a lens names what it must honor");
        assert.deepEqual(needs(plain.gaps), ["how-the-days-go"]);
        assert.deepEqual(needs(visit.gaps), ["how-the-days-go", "people"]);
        assert.deepEqual(needs(await i.gaps(scope, "linda", { lens: "fixture-visit" })), ["how-the-days-go", "people"]);
        const loves = standing((await i.readiness(scope, "linda", { lens: "fixture-visit" }))!, "what-they-love");
        assert.deepEqual([loves.state, loves.facts, loves.strength], ["waiting", 1, 0.5], "one fact of the two it needs, and it waits its turn");
        assert.equal((await i.getEntity(scope, "linda", { includeBrief: true, lens: "fixture-visit" }))!.brief!.text, visit.text);
        await assert.rejects(i.brief(scope, "linda", { lens: "no-such-lens" }));
      },
    },
    {
      name: "an episode held until hinted waits, and goes once its entity is named",
      scripted: true,
      async run({ intelligence: i, scope, script }) {
        await i.upsertEntity(scope, { id: "linda", name: "Linda" });
        await i.addEpisode(scope, { source: "message", sourceRef: "m-1", content: "She took up gardening", hold: "until-hinted", extract: "inline" });
        const held = await i.extractNow(scope, { maxEpisodes: 3 });
        assert.equal(held.outcome, "none");
        assert.equal(held.remaining, 0, "a held episode is not pending");
        assert.equal((await i.episodes(scope))[0]!.ingestedAt, null);

        await i.hintEpisodes(scope, { sourceRefs: ["m-1"], entityId: "linda" });
        script!({ extraction: extraction([extracted("linda", "LIKES", "Gardening")]) });
        const freed = await i.extractNow(scope, { maxEpisodes: 3, askedSourceRef: "m-1" });
        assert.equal(freed.outcome, "extracted");
        assert.equal(freed.askedIngested, true);
        assert.deepEqual(await i.factsLearnedBy(scope, ["m-1"]), { "m-1": ["Gardening"] });
      },
    },
    {
      name: "a fact pinned on an id not on the roster is dropped, and a field is proposed rather than written",
      scripted: true,
      async run({ intelligence: i, scope, script }) {
        await i.upsertEntity(scope, { id: "linda", name: "Linda", fields: { city: "Austin" } });
        await i.addEpisode(scope, { source: "note", sourceRef: "n-1", content: "Mom and Carol moved to Denver", entityHints: ["linda"], extract: "inline" });
        script!({
          extraction: extraction([extracted("linda", "EVENT", "Moved to Denver"), extracted("carol", "EVENT", "Moved to Denver")], {
            fieldUpdates: [{ entityId: "linda", field: "city", value: "Denver" }],
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
        const proposals = await i.listProposals(scope, { entityId: "linda", status: "pending" });
        assert.equal(proposals.length, 1);
        assert.equal(proposals[0]!.kind, "field_update");
        assert.equal(proposals[0]!.field, "city");
        assert.equal(proposals[0]!.value, "Denver");
        assert.ok((await i.brief(scope, "linda"))!.text.includes("Moved to Denver"));
        await i.resolveProposal(scope, proposals[0]!.id, "accepted");
        assert.equal((await i.listProposals(scope, { status: "accepted" })).length, 1);
      },
    },
    {
      name: "the knower is on every roster: read with no facts until something is said, named by the client, never read through a lens",
      scripted: false,
      async run({ intelligence: i, scope }) {
        const knower = await i.getEntity(scope, KNOWER_ID);
        assert.deepEqual([knower?.id, knower?.kind, knower?.facts], [KNOWER_ID, "knower", []], "on every roster from the start");
        assert.equal(await i.readiness(scope, KNOWER_ID), null, "read beside every entity, never through a lens of their own");
        assert.equal(await i.gaps(scope, KNOWER_ID), null);
        await i.upsertEntity(scope, { id: KNOWER_ID, name: "Ana" });
        assert.equal((await i.getEntity(scope, KNOWER_ID))?.name, "Ana", "the client may name them");
        await assert.rejects(i.upsertEntity(scope, { id: KNOWER_ID, name: "Ana", kind: "person" }), "the knower is not of the vocabulary's kind");
      },
    },
    {
      name: "one note, three subjects: about the writer goes on the knower, about the relationship and about the person go on the person, and a misattributed fact is dropped",
      scripted: true,
      async run({ intelligence: i, scope, script }) {
        await i.upsertEntity(scope, { id: "linda", name: "Linda" });
        await i.addEpisode(scope, { source: "note", sourceRef: "n-1", content: "I can spend about £40 on Mom. She raised me. She loves gardening.", entityHints: ["linda"], extract: "inline" });
        script!({
          extraction: extraction([
            extracted(KNOWER_ID, "MEANS", "Can spend about £40"),
            extracted("linda", "HISTORY", "Raised the knower"),
            extracted("linda", "LIKES", "Gardening"),
            extracted("linda", "MEANS", "A budget, filed under the person"),
            extracted(KNOWER_ID, "LIKES", "A taste, filed under the knower"),
          ]),
        });
        const now = await i.extractNow(scope, { maxEpisodes: 1 });
        const done = now.episodes[0]!;
        assert.equal(done.status, "ingested");
        if (done.status === "ingested") assert.equal(done.misattributed, 2, "a fact about the knower on the person, and one about the person on the knower");
        assert.deepEqual((await i.getEntity(scope, KNOWER_ID))!.facts.map((f) => f.fact), ["Can spend about £40"]);
        assert.deepEqual((await i.getEntity(scope, "linda"))!.facts.map((f) => f.fact).sort(), ["Gardening", "Raised the knower"]);
      },
    },
    {
      name: "what is known about the knower counts beside every entity: a need about the knower met once is met for all, and directions rank all three subjects",
      scripted: true,
      async run({ intelligence: i, scope, script }) {
        await i.upsertEntity(scope, { id: "linda", name: "Linda" });
        await i.upsertEntity(scope, { id: "al", name: "Al" });
        await i.addEpisode(scope, { source: "note", sourceRef: "n-1", content: "I can spend about £40 on presents this year.", extract: "inline" });
        script!({ extraction: extraction([extracted(KNOWER_ID, "MEANS", "Can spend about £40")]) });
        assert.equal((await i.extractNow(scope, { maxEpisodes: 1 })).outcome, "extracted");
        for (const id of ["linda", "al"]) {
          const gift = (await i.readiness(scope, id, { lens: "fixture-gift" }))!;
          assert.deepEqual(
            gift.needs.map((n) => [n.id, n.about, n.state]),
            [
              ["what-they-love", "entity", "open"],
              ["how-you-know-them", "relationship", "open"],
              ["what-you-can-spend", "knower", "met"],
            ],
            `${id}: the knower's budget is known for everyone`,
          );
          assert.deepEqual(gift.next.map((d) => [d.kind, d.need, d.about]), [["learn", "what-they-love", "entity"], ["learn", "how-you-know-them", "relationship"]]);
          assert.deepEqual(gift.dimensions.filter((d) => d.facts > 0).map((d) => [d.id, d.about, d.facts]), [["means", "knower", 1]]);
        }
      },
    },
    {
      name: "a page prints what is known about the knower only where its lens gives the knower a section",
      scripted: true,
      async run({ intelligence: i, scope, script }) {
        await i.upsertEntity(scope, { id: "linda", name: "Linda" });
        await i.addEpisode(scope, { source: "note", sourceRef: "n-1", content: "Mom loves gardening; I can spend about £40.", entityHints: ["linda"], extract: "inline" });
        script!({ extraction: extraction([extracted("linda", "LIKES", "Gardening"), extracted(KNOWER_ID, "MEANS", "Can spend about £40")]) });
        assert.equal((await i.extractNow(scope, { maxEpisodes: 1 })).outcome, "extracted");
        const gift = (await i.brief(scope, "linda", { lens: "fixture-gift" }))!;
        assert.ok(gift.text.includes("You:\n- Can spend about £40"), gift.text);
        assert.ok(!(await i.brief(scope, "linda"))!.text.includes("£40"), "the default lens gives the knower no section");
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

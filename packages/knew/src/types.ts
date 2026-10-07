/**
 * The intelligence contract — ONE DOOR.
 *
 * A client reaches the engine only through `Intelligence`. The interface
 * carries a scope and never a database handle, because the DRIVER owns its
 * storage: the service's Postgres driver, the HTTP client in this package, a
 * phone's own arm. Nothing storage-shaped crosses this line, so every driver
 * can implement every method honestly, and a client's tests can run against
 * the in-memory fake in `./testing`.
 *
 * The words: the KNOWER is the client's own user, whose notebook this is —
 * the scope's `subjectId`, in the data-protection sense. What they know about
 * is an ENTITY of the vocabulary's KIND — a person, a place, a thing — on
 * their roster, by the client's own id.
 *
 * Two halves. Looking back: episodes → entities with summaries → bi-temporal
 * typed facts with episode provenance, read as a page through a lens. Looking
 * forward: how ready the knower is for the lens's objective and what to learn
 * next (readiness, and the gaps it orders), and what extraction proposes but
 * may not do (proposals). The data model mirrors a temporal knowledge graph's
 * on purpose, so an eventual move is a replay of episodes rather than a
 * migration of facts.
 */

/** Every call is scoped to one client's one knower (the client's own user). */
export interface IntelligenceScope {
  clientId: string;
  /** The knower: the data subject, in the data-protection sense. */
  subjectId: string;
}

/** Where an episode came from: `message`, `note`, `form`, `capture`,
 *  `import`, … Open text; the vocabulary names it for the prompt. */
export type EpisodeSource = string;

export interface EpisodeInput {
  source: EpisodeSource;
  /** The producing row's id in the client's own store; opaque here. A second
   *  write for the same `(source, sourceRef)` is `existing`, never a
   *  duplicate; a producer that legitimately repeats a ref appends a
   *  discriminator. */
  sourceRef?: string | null;
  /** What the knower said, in their own words. */
  content: string;
  /** What a phone read off the photographs the producing turn carried —
   *  machine text, kept out of `content` because that is exported as what
   *  the knower SAID. */
  observed?: string | null;
  /** The question the knower was answering, as it was put to them, when this
   *  is a reply to one — the way an ask closes. The client's wording, so it is
   *  kept beside `content`, never in it: the model reads it as context and the
   *  export keeps it apart from what was said. */
  inReplyTo?: string | null;
  /** Entity ids the producer already knows this concerns. */
  entityHints?: string[];
  /** When it was said. Defaults to now; imports back-date it. */
  referenceAt?: Date;
  /** Hold extraction until a hint arrives: the thread that will name the
   *  entity has not yet. */
  hold?: "until-hinted";
  /** `inline` means the caller will run `extractNow` itself and the driver
   *  must not trigger the background sweep. Default `background`. */
  extract?: "background" | "inline";
}

export type AddEpisodeResult = { kind: "recorded"; episodeId: string } | { kind: "existing"; episodeId: string };

export interface Episode {
  id: string;
  source: EpisodeSource;
  sourceRef: string | null;
  content: string;
  inReplyTo: string | null;
  entityHints: string[];
  referenceAt: Date;
  /** Null while extraction is still pending. */
  ingestedAt: Date | null;
}

export interface Fact {
  id: string;
  /** The entity it is about, by the client's id. */
  entityId: string;
  /** Another entity it relates, by the client's id, when it does. */
  objectId: string | null;
  type: string;
  fact: string;
  attributes: Record<string, unknown>;
  /** True in the world from / until. Null = not stated / still true. */
  validAt: Date | null;
  invalidAt: Date | null;
  /** Known to us from — when it was first said. */
  createdAt: Date;
  /** When it was last said: the newest episode that said it. A retelling
   *  moves it; nothing else does. Null on a ledger that predates it, read as
   *  `createdAt`. */
  lastSaidAt: Date | null;
  /** Known to us until. Null = current. */
  expiredAt: Date | null;
  supersededById: string | null;
  /** Every episode that said it, in the order they said it. */
  episodeIds: string[];
}

export interface Entity {
  /** The client's id for it, as the roster gave it. */
  id: string;
  /** What it is: the vocabulary's kind. */
  kind: string;
  name: string;
  aliases: string[];
  /** The living profile: the page a reader starts from. */
  summary: string;
  summaryUpdatedAt: Date | null;
}

export interface EntityView extends Entity {
  /** Current facts, or the facts known at `asOf` when the read asked. */
  facts: Fact[];
  /** The rendered page, when the read asked for it. */
  brief?: Brief | null;
}

/** A pinned fact the reader must honor rather than merely consider. */
export interface MustHonor {
  type: string;
  fact: string;
}

/** Missing understanding: a need that is open, or thin against what its lens
 *  needs. Gaps come in order of value. */
export interface Gap {
  need: string;
  label: string;
  /** Its dimension, or null when it names its types. */
  dimension: string | null;
  /** The types whose facts count toward it. */
  types: string[];
}

export interface Brief {
  text: string;
  mustHonor: MustHonor[];
  /** What the lens's objective still needs understood, in order of value. */
  gaps: Gap[];
}

/** Current understanding of one dimension of an entity: evidence, with no
 *  objective in it. */
export interface DimensionEvidence {
  id: string;
  /** As a reader calls it. */
  label: string;
  /** Current facts in it. */
  facts: number;
  /** Of those, how many are due for a revisit. */
  due: number;
  /** The newest time any of them was said; null when there are none. */
  lastSaidAt: Date | null;
  /** Its facts, newest said first. */
  factIds: string[];
}

/** Where a need stands: met by fresh facts; waiting on a need that must be
 *  met first; due, with enough facts but not enough of them fresh; thin, with
 *  some but too few; or open, with none. */
export type NeedState = "met" | "waiting" | "due" | "thin" | "open";

/** How one need of the lens stands for this entity. */
export interface NeedStanding {
  id: string;
  label: string;
  dimension: string | null;
  types: string[];
  weight: number;
  enough: number;
  /** Current facts that count toward it. */
  facts: number;
  /** Of those, how many are due for a revisit. */
  due: number;
  /** 0 to 1, three places: 1 when enough fresh facts answer it. */
  strength: number;
  state: NeedState;
  /** The needs it waits on, while it is waiting. */
  waitingOn: string[];
  /** Its facts, newest said first. */
  factIds: string[];
}

/** A direction for understanding to grow in: `learn` where a need is open or
 *  thin, built on the facts already known; `revisit` where understanding has
 *  gone unsaid past its window, carrying the facts due. */
export interface Direction {
  kind: "learn" | "revisit";
  /** The need it serves. */
  need: string;
  label: string;
  dimension: string | null;
  types: string[];
  /** weight · (1 − strength), three places: directions run from the highest. */
  value: number;
  factIds: string[];
}

/** Current understanding of one entity, what one lens's objective still
 *  needs, and the next directions. */
export interface Readiness {
  lens: string;
  objective: string | null;
  /** The moment it describes. */
  at: Date;
  /** The weighted mean strength of the applicable needs; null when none apply. */
  overall: number | null;
  /** Current understanding, per dimension, in the vocabulary's order. */
  dimensions: DimensionEvidence[];
  /** Every need that applies to this entity, in the lens's order. */
  needs: NeedStanding[];
  /** The next directions, most valuable first. */
  next: Direction[];
}

export interface EntityInput {
  /** The client's own id for it; preserved as given. */
  id: string;
  name: string;
  /** What it is. Must be the vocabulary's kind; default that kind. */
  kind?: string;
  /** The vocabulary's fields, as the knower wrote them. Null clears one. */
  fields?: Record<string, string | null>;
  /** False archives: no longer on the roster, memory kept. Default true. */
  active?: boolean;
}

export interface SearchFactsOptions {
  /** Narrow to one entity's facts. */
  entityId?: string;
  types?: string[];
  /** "What did we know at T". Default: now. */
  asOf?: Date;
  limit?: number;
}

export interface ReadOptions {
  /** Which lens to read through. Default: the client's default lens. */
  lens?: string;
  /** Read what was known at T. Default: now. */
  asOf?: Date;
}

export interface BriefOptions extends ReadOptions {
  /** As of T, the summary is omitted — it is always today's — so an as-of
   *  brief is facts only. */
  maxChars?: number;
}

export interface ExtractNowOptions {
  maxEpisodes: number;
  /** Wall clock, from now. Nothing more is claimed past it. */
  deadlineMs?: number;
  callTimeoutMs?: number;
  /** The caller's own turn, when the sweep is its stage: stamped on every
   *  spend row as attribution, and the sweep mints no turn of its own. */
  turnId?: string;
  /** Report whether the episode with this source ref was ingested. */
  askedSourceRef?: string;
}

export interface ModelUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  costUsd: number | null;
  costSource: "billed" | "estimated" | null;
}

export interface ModelCall {
  method: "extract" | "reconcile";
  model: string | null;
  /** Null when the call threw. */
  usage: ModelUsage | null;
}

export type EpisodeOutcome =
  | {
      episodeId: string;
      status: "ingested";
      facts: { added: number; merged: number; superseded: number };
      entities: number;
      unresolvedNames: string[];
      /** Facts naming an id not on the roster — a model error, dropped. */
      offRoster: number;
      /** Facts about entities past the per-episode cap, dropped. */
      droppedForCap: number;
      calls: number;
      costUsd: number | null;
    }
  | { episodeId: string; status: "gave-up"; attempts: number }
  | { episodeId: string; status: "failed"; error: string; calls: number; costUsd: number | null };

export interface ExtractNowOutcome {
  /** Why the sweep stopped: it did its work, another worker holds this
   *  knower, the caller's deadline, a failure, or nothing was pending. */
  outcome: "extracted" | "busy" | "budget" | "failed" | "none";
  episodes: EpisodeOutcome[];
  /** Episodes still pending for this knower. */
  remaining: number;
  /** Whether `askedSourceRef`'s episode is now ingested; null when not asked. */
  askedIngested: boolean | null;
  calls: ModelCall[];
}

export type ProposalKind = "unresolved_name" | "field_update";

export interface Proposal {
  id: string;
  episodeId: string;
  kind: ProposalKind;
  /** `unresolved_name`: the name as the knower used it. */
  name: string | null;
  /** `field_update`: which entity, which field, and the proposed value. */
  entityId: string | null;
  field: string | null;
  value: string | null;
  status: "pending" | "accepted" | "dismissed";
  createdAt: Date;
  resolvedAt: Date | null;
}

export interface SubjectExport {
  /** The knower's own words, where they were said, and when — with the
   *  question they were answering, when it was a reply, kept apart. Facts and
   *  summaries are derived — our reading of their words — and stay out. */
  episodes: Array<{ source: string; said: string; saidAt: Date; inReplyTo: string | null }>;
}

/**
 * The one door. `brief`, `gaps` and `readiness` are INSIDE the interface on
 * purpose: a client never works out a page or a direction from raw facts
 * itself, so each is the same whichever driver produced it. Every read that
 * renders takes a lens; writing never names one.
 */
export interface Intelligence {
  /** The roster: what facts may attach to. Upsert by the client's id. */
  upsertEntity(scope: IntelligenceScope, entity: EntityInput): Promise<void>;
  /** Gone means gone: the entity, its facts, and every episode hinted at it
   *  or cited by its facts. */
  deleteEntity(scope: IntelligenceScope, entityId: string): Promise<{ episodesRemoved: number }>;

  addEpisode(scope: IntelligenceScope, input: EpisodeInput): Promise<AddEpisodeResult>;
  /** The thread learned what it is about: stamp its episodes and release any
   *  that were held. */
  hintEpisodes(scope: IntelligenceScope, input: { sourceRefs: string[]; entityId: string }): Promise<{ hinted: number }>;
  /** Ask for the background sweep. Called AFTER the caller's own transaction
   *  commits, never inside `addEpisode`. */
  requestExtract(scope: IntelligenceScope): Promise<void>;
  /** The inline step: extract what is pending, bounded by wall clock. */
  extractNow(scope: IntelligenceScope, options: ExtractNowOptions): Promise<ExtractNowOutcome>;

  getEntity(
    scope: IntelligenceScope,
    entityId: string,
    options?: { asOf?: Date; includeBrief?: boolean; lens?: string; maxChars?: number },
  ): Promise<EntityView | null>;
  /** Null when nothing is known about it yet — the caller falls back to its
   *  own note. */
  brief(scope: IntelligenceScope, entityId: string, options?: BriefOptions): Promise<Brief | null>;
  /** The missing understanding, in order of value: needs open or thin, and
   *  not waiting on a need that must be met first. Null when the entity is not
   *  on the roster. */
  gaps(scope: IntelligenceScope, entityId: string, options?: ReadOptions): Promise<Gap[] | null>;
  /** Current understanding, what the lens's objective still needs, and the
   *  next directions. Null when the entity is not on the roster. */
  readiness(scope: IntelligenceScope, entityId: string, options?: ReadOptions): Promise<Readiness | null>;
  searchFacts(scope: IntelligenceScope, query: string, options?: SearchFactsOptions): Promise<Fact[]>;
  /** What the engine kept from the given source refs — current facts only. */
  factsLearnedBy(scope: IntelligenceScope, sourceRefs: string[]): Promise<Record<string, string[]>>;
  invalidateFact(scope: IntelligenceScope, factId: string, options?: { at?: Date }): Promise<void>;
  episodes(
    scope: IntelligenceScope,
    options?: { entityId?: string; sourceRefs?: string[]; before?: Date; limit?: number },
  ): Promise<Episode[]>;

  listProposals(scope: IntelligenceScope, options?: { entityId?: string; status?: Proposal["status"] }): Promise<Proposal[]>;
  resolveProposal(scope: IntelligenceScope, proposalId: string, resolution: "accepted" | "dismissed"): Promise<void>;

  exportSubject(scope: IntelligenceScope): Promise<SubjectExport>;
  /** Ordered explicit deletes of everything under the scope. */
  deleteSubject(scope: IntelligenceScope): Promise<void>;
  /** Forget everything DERIVED and mark every episode pending again. */
  resetForReplay(scope: IntelligenceScope): Promise<{ episodes: number }>;
}

// ---------------------------------------------------------------------------
// Stateless mode — the same engine, nothing stored
// ---------------------------------------------------------------------------

/** One roster entry as the extraction prompt sees it. */
export interface RosterEntry {
  id: string;
  name: string;
  /** The vocabulary's fields, as the knower wrote them. */
  fields: Record<string, string | null>;
  aliases: string[];
}

export interface StatelessEntity {
  summary: string;
  facts: Fact[];
}

export interface StatelessExtractRequest {
  roster: RosterEntry[];
  /** Each roster entry's current ledger, by id. Absent means nothing known. */
  entities: Record<string, StatelessEntity>;
  episode: {
    source: EpisodeSource;
    content: string;
    observed?: string | null;
    inReplyTo?: string | null;
    entityHints?: string[];
    referenceAt: Date;
  };
  callTimeoutMs?: number;
}

export interface NewFact {
  type: string;
  fact: string;
  attributes?: Record<string, unknown>;
  validAt?: Date | null;
  invalidAt?: Date | null;
}

/** One entity's plan: what to do with each new fact, and the new summary.
 *  The service applies it in a transaction; a client applies it to its own
 *  store. Either way the same pure function decided it. */
export interface ReconciliationPlan {
  entityId: string;
  adds: NewFact[];
  /** Each a retelling: the fact gains the episode, and is last said now. */
  merges: Array<{ factId: string }>;
  supersessions: Array<{ factId: string; replacement: NewFact; invalidAt: Date | null }>;
  retractions: Array<{ factId: string; invalidAt: Date | null }>;
  /** New facts the model judged not worth keeping. */
  dropped: number;
  /** Ids the model cited that are not current facts of this entity. */
  unknownFactIds: string[];
  /** The rewritten living profile. Null leaves it as it was. */
  summary: string | null;
  summaryVersion: string;
  /** Stamps created_at and last_said_at on new facts, last_said_at on merged
   *  ones (never moving it back), and expired_at on retired ones. */
  knownAt: Date;
  aliases: string[];
}

export interface StatelessExtraction {
  plans: ReconciliationPlan[];
  unresolvedNames: string[];
  fieldUpdates: Array<{ entityId: string; field: string; value: string }>;
  offRoster: number;
  droppedForCap: number;
  calls: ModelCall[];
  promptVersions: { extract: string; reconcile: string | null };
}

export interface StatelessIntelligence {
  extract(request: StatelessExtractRequest): Promise<StatelessExtraction>;
}

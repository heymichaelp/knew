/**
 * The people-intelligence contract — ONE DOOR.
 *
 * A client reaches the engine only through `PeopleIntelligence`. The
 * interface carries a scope and never a database handle, because the DRIVER
 * owns its storage: the service's Postgres driver, the HTTP client in this
 * package, a phone's own arm. Nothing storage-shaped crosses this line, so
 * every driver can implement every method honestly, and a client's tests can
 * run against the in-memory fake in `./testing`.
 *
 * Two halves. Looking back: episodes → entities with summaries → bi-temporal
 * typed facts with episode provenance, read as a page. Looking forward: what
 * the ledger does not yet answer (gaps), and what extraction proposes but may
 * not do (proposals). The data model mirrors a temporal knowledge graph's on
 * purpose, so an eventual move is a replay of episodes rather than a
 * migration of facts.
 */

/** Every call is scoped to one client's one subject (the client's own user). */
export interface IntelligenceScope {
  clientId: string;
  subjectId: string;
}

/** Where an episode came from: `message`, `note`, `form`, `capture`,
 *  `import`, … Open text; the lens names it for the prompt. */
export type EpisodeSource = string;

export interface EpisodeInput {
  source: EpisodeSource;
  /** The producing row's id in the client's own store; opaque here. A second
   *  write for the same `(source, sourceRef)` is `existing`, never a
   *  duplicate; a producer that legitimately repeats a ref appends a
   *  discriminator. */
  sourceRef?: string | null;
  content: string;
  /** What a phone read off the photographs the producing turn carried —
   *  machine text, kept out of `content` because that is exported as what
   *  the person SAID. */
  observed?: string | null;
  /** Person ids the producer already knows this concerns. */
  personHints?: string[];
  /** When it was said. Defaults to now; imports back-date it. */
  referenceAt?: Date;
  /** Hold extraction until a hint arrives: the thread that will name the
   *  person has not yet. */
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
  personHints: string[];
  referenceAt: Date;
  /** Null while extraction is still pending. */
  ingestedAt: Date | null;
}

export interface Fact {
  id: string;
  /** The entity it is about. */
  subjectId: string;
  objectId: string | null;
  type: string;
  fact: string;
  attributes: Record<string, unknown>;
  /** True in the world from / until. Null = not stated / still true. */
  validAt: Date | null;
  invalidAt: Date | null;
  /** Known to us from — when it was said. */
  createdAt: Date;
  /** Known to us until. Null = current. */
  expiredAt: Date | null;
  supersededById: string | null;
  /** Every episode that said it, in the order they said it. */
  episodeIds: string[];
}

export interface Entity {
  id: string;
  /** The person this entity IS, when it is one. */
  personId: string | null;
  kind: string;
  name: string;
  aliases: string[];
  /** The living profile. For a person, the page a reader starts from. */
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

/** A question the lens asks about a person that the ledger does not yet
 *  answer. */
export interface Gap {
  id: string;
  question: string;
  answeredBy: string[];
}

export interface Brief {
  text: string;
  mustHonor: MustHonor[];
  /** What the page is missing, by the lens's own questions. */
  gaps: Gap[];
}

export interface PersonInput {
  /** The client's own id for them; preserved as given. */
  id: string;
  name: string;
  /** The lens's routing fields, as the person wrote them. Null clears one. */
  fields?: Record<string, string | null>;
  /** False archives: no longer on the roster, memory kept. Default true. */
  active?: boolean;
}

export interface Person {
  id: string;
  name: string;
  fields: Record<string, string | null>;
  active: boolean;
}

export interface SearchFactsOptions {
  /** Narrow to one person's facts. */
  personId?: string;
  types?: string[];
  /** "What did we know at T". Default: now. */
  asOf?: Date;
  limit?: number;
}

export interface BriefOptions {
  /** Render what was known at T. The summary is omitted — it is always
   *  today's — so an as-of brief is facts only. */
  asOf?: Date;
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
      people: number;
      unresolvedNames: string[];
      /** Facts naming an id not on the roster — a model error, dropped. */
      offRoster: number;
      /** Facts about people past the per-episode cap, dropped. */
      droppedForCap: number;
      calls: number;
      costUsd: number | null;
    }
  | { episodeId: string; status: "gave-up"; attempts: number }
  | { episodeId: string; status: "failed"; error: string; calls: number; costUsd: number | null };

export interface ExtractNowOutcome {
  /** Why the sweep stopped: it did its work, another worker holds this
   *  subject, the caller's deadline, a failure, or nothing was pending. */
  outcome: "extracted" | "busy" | "budget" | "failed" | "none";
  episodes: EpisodeOutcome[];
  /** Episodes still pending for this subject. */
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
  /** `unresolved_name`: the name as the person used it. */
  name: string | null;
  /** `field_update`: whom, which routing field, and the proposed value. */
  personId: string | null;
  field: string | null;
  value: string | null;
  status: "pending" | "accepted" | "dismissed";
  createdAt: Date;
  resolvedAt: Date | null;
}

export interface SubjectExport {
  /** The person's own words, where they were said, and when. Facts and
   *  summaries are derived — our reading of their words — and stay out. */
  episodes: Array<{ source: string; said: string; saidAt: Date }>;
}

/**
 * The one door. `brief` is INSIDE the interface on purpose: a client never
 * assembles a page from raw facts itself, so the page is the same whichever
 * driver produced it. `gaps` is the forward half's first surface.
 */
export interface PeopleIntelligence {
  /** The roster: who facts may attach to. Upsert by the client's id. */
  upsertPerson(scope: IntelligenceScope, person: PersonInput): Promise<void>;
  /** Gone means gone: the entity, its facts, and every episode hinted at
   *  them or cited by their facts. */
  deletePerson(scope: IntelligenceScope, personId: string): Promise<{ episodesRemoved: number }>;

  addEpisode(scope: IntelligenceScope, input: EpisodeInput): Promise<AddEpisodeResult>;
  /** The thread learned who it is about: stamp its episodes and release any
   *  that were held. */
  hintEpisodes(scope: IntelligenceScope, input: { sourceRefs: string[]; personId: string }): Promise<{ hinted: number }>;
  /** Ask for the background sweep. Called AFTER the caller's own transaction
   *  commits, never inside `addEpisode`. */
  requestExtract(scope: IntelligenceScope): Promise<void>;
  /** The inline step: extract what is pending, bounded by wall clock. */
  extractNow(scope: IntelligenceScope, options: ExtractNowOptions): Promise<ExtractNowOutcome>;

  getEntity(
    scope: IntelligenceScope,
    personId: string,
    options?: { asOf?: Date; includeBrief?: boolean; maxChars?: number },
  ): Promise<EntityView | null>;
  /** Null when nothing is known about them yet — the caller falls back to
   *  its own note. */
  brief(scope: IntelligenceScope, personId: string, options?: BriefOptions): Promise<Brief | null>;
  /** What the lens asks about them that the ledger does not yet answer.
   *  Null when they are not on the roster; every ask, for someone known
   *  only by name. */
  gaps(scope: IntelligenceScope, personId: string): Promise<Gap[] | null>;
  searchFacts(scope: IntelligenceScope, query: string, options?: SearchFactsOptions): Promise<Fact[]>;
  /** What the engine kept from the given source refs — current facts only. */
  factsLearnedBy(scope: IntelligenceScope, sourceRefs: string[]): Promise<Record<string, string[]>>;
  invalidateFact(scope: IntelligenceScope, factId: string, options?: { at?: Date }): Promise<void>;
  episodes(
    scope: IntelligenceScope,
    options?: { personId?: string; sourceRefs?: string[]; before?: Date; limit?: number },
  ): Promise<Episode[]>;

  listProposals(scope: IntelligenceScope, options?: { personId?: string; status?: Proposal["status"] }): Promise<Proposal[]>;
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

/** One person as the extraction prompt sees them. */
export interface RosterEntry {
  id: string;
  name: string;
  /** The lens's routing fields, as the person wrote them. */
  fields: Record<string, string | null>;
  aliases: string[];
}

export interface StatelessPerson {
  summary: string;
  facts: Fact[];
}

export interface StatelessExtractRequest {
  roster: RosterEntry[];
  /** Each roster person's current ledger, by id. Absent means nothing known. */
  people: Record<string, StatelessPerson>;
  episode: {
    source: EpisodeSource;
    content: string;
    observed?: string | null;
    personHints?: string[];
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

/** One person's plan: what to do with each new fact, and the new summary.
 *  The service applies it in a transaction; a client applies it to its own
 *  store. Either way the same pure function decided it. */
export interface ReconciliationPlan {
  personId: string;
  adds: NewFact[];
  merges: Array<{ factId: string }>;
  supersessions: Array<{ factId: string; replacement: NewFact; invalidAt: Date | null }>;
  retractions: Array<{ factId: string; invalidAt: Date | null }>;
  /** New facts the model judged not worth keeping. */
  dropped: number;
  /** Ids the model cited that are not current facts of this person. */
  unknownFactIds: string[];
  /** The rewritten living profile. Null leaves it as it was. */
  summary: string | null;
  summaryVersion: string;
  /** Stamps created_at on new facts and expired_at on retired ones. */
  knownAt: Date;
  aliases: string[];
}

export interface StatelessExtraction {
  plans: ReconciliationPlan[];
  unresolvedNames: string[];
  fieldUpdates: Array<{ personId: string; field: string; value: string }>;
  offRoster: number;
  droppedForCap: number;
  calls: ModelCall[];
  promptVersions: { extract: string; reconcile: string | null };
}

export interface StatelessIntelligence {
  extract(request: StatelessExtractRequest): Promise<StatelessExtraction>;
}

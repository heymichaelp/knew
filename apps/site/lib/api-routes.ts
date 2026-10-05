/**
 * The routes behind each client method.
 *
 * The method names are not a list anyone maintains by hand — test/drift.test.ts
 * checks this table against the client's runtime keys, so a method added to the
 * engine fails the site's build until it is written down here.
 */
export type TimeoutBudget = "read" | "write" | "search" | "export" | "extractNow" | "stateless";

export interface Route {
  readonly method: string;
  readonly path: string;
  /** The client method that calls it, or null for a route with no client binding. */
  readonly client: string | null;
  readonly budget: TimeoutBudget | null;
  readonly summary: string;
}

export interface RouteGroup {
  readonly title: string;
  readonly blurb: string;
  readonly routes: Route[];
}

export const ROUTE_GROUPS: RouteGroup[] = [
  {
    title: "The roster",
    blurb: "Who the subject knows. A person the client names, and the facts the engine has gathered under them.",
    routes: [
      { method: "PUT", path: "/v1/people/:id", client: "upsertPerson", budget: "write", summary: "Name a person, or merge fields into one already named. A null clears a field." },
      { method: "GET", path: "/v1/people/:id", client: "getEntity", budget: "read", summary: "The entity and its current facts, or null if the subject does not know them." },
      { method: "GET", path: "/v1/people/:id/brief", client: "brief", budget: "read", summary: "The page: the facts rendered through the lens, under its headings." },
      { method: "GET", path: "/v1/people/:id/gaps", client: "gaps", budget: "read", summary: "The asks still open for this person — what the lens wants to know next." },
      { method: "DELETE", path: "/v1/people/:id", client: "deletePerson", budget: "write", summary: "Remove a person, and their words with them." },
    ],
  },
  {
    title: "Episodes",
    blurb: "What was said. Episodes are the truth; facts are derived from them and can always be rebuilt.",
    routes: [
      { method: "POST", path: "/v1/episodes", client: "addEpisode", budget: "write", summary: "Write an episode, once per source ref. Idempotent on that ref." },
      { method: "GET", path: "/v1/episodes", client: "episodes", budget: "read", summary: "The subject's episodes, newest first." },
      { method: "POST", path: "/v1/episodes/hints", client: "hintEpisodes", budget: "write", summary: "Name the people an episode was about, so one held for a hint can go." },
    ],
  },
  {
    title: "Extraction",
    blurb: "Turning episodes into dated facts. Request the sweep and let the worker run it, or wait for it inline.",
    routes: [
      { method: "POST", path: "/v1/extract", client: "requestExtract", budget: "write", summary: "Queue the sweep. Returns as soon as the work is enqueued." },
      { method: "POST", path: "/v1/extract/now", client: "extractNow", budget: "extractNow", summary: "Run the sweep and answer with its outcome. For a client that must show the result." },
    ],
  },
  {
    title: "Facts",
    blurb: "Facts supersede, they are never edited. A correction is dated by when it was said, so what was known then stays answerable.",
    routes: [
      { method: "GET", path: "/v1/facts/search", client: "searchFacts", budget: "search", summary: "Search the subject's facts." },
      { method: "GET", path: "/v1/facts/learned", client: "factsLearnedBy", budget: "read", summary: "What a given source taught, by source ref." },
      { method: "POST", path: "/v1/facts/:id/invalidate", client: "invalidateFact", budget: "write", summary: "Retract a fact as of a date. The row stays; its validity ends." },
    ],
  },
  {
    title: "Proposals",
    blurb: "The engine never writes a routing field or an off-roster fact silently. It proposes, and the client decides.",
    routes: [
      { method: "GET", path: "/v1/proposals", client: "listProposals", budget: "read", summary: "What the engine wants permission to write." },
      { method: "POST", path: "/v1/proposals/:id/resolve", client: "resolveProposal", budget: "write", summary: "Accept or reject a proposal." },
    ],
  },
  {
    title: "The subject",
    blurb: "A subject's whole record, and the two operations a data-protection request needs.",
    routes: [
      { method: "GET", path: "/v1/subject/export", client: "exportSubject", budget: "export", summary: "Everything held for this subject, as the words, dated." },
      { method: "DELETE", path: "/v1/subject", client: "deleteSubject", budget: "export", summary: "Erase the subject. Nothing of them is left, in any scope." },
      { method: "POST", path: "/v1/subject/reset", client: "resetForReplay", budget: "write", summary: "Drop every derived fact and keep the episodes, so extraction can be replayed." },
    ],
  },
  {
    title: "Stateless mode",
    blurb: "One call, nothing stored. The client keeps the record; the engine only reads the episode and answers.",
    routes: [
      { method: "POST", path: "/v1/stateless/extract", client: "extract", budget: "stateless", summary: "Send the episode and what you already hold; get typed facts and a reconciliation plan back." },
    ],
  },
  {
    title: "Usage",
    blurb: "What the engine cost. Nothing else in it is a spend.",
    routes: [
      { method: "GET", path: "/v1/usage", client: null, budget: null, summary: "The model calls made for this client, and what they cost." },
    ],
  },
];

export const ALL_ROUTES: Route[] = ROUTE_GROUPS.flatMap((group) => group.routes);

/** The client methods this table accounts for. */
export const DOCUMENTED_METHODS: string[] = ALL_ROUTES.map((r) => r.client).filter((c): c is string => c !== null);

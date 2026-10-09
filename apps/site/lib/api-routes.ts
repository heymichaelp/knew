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
    title: "Definitions",
    blurb:
      "Registered once per version with the service key. A registered version is immutable. No client method: set them at boot or with the service's CLI.",
    routes: [
      { method: "PUT", path: "/v1/vocabulary", client: null, budget: null, summary: "Register a vocabulary version. Refused if it does not parse or compile." },
      { method: "PUT", path: "/v1/lens", client: null, budget: null, summary: "Register a lens version. Every reference into the vocabulary must resolve." },
    ],
  },
  {
    title: "The roster",
    blurb:
      "Entities of the vocabulary's kind, named by the client. Reads take ?lens=; without it, the client's default lens.",
    routes: [
      { method: "PUT", path: "/v1/entities/:id", client: "upsertEntity", budget: "write", summary: "Create an entity or merge its fields. Null clears a field." },
      { method: "GET", path: "/v1/entities/:id", client: "getEntity", budget: "read", summary: "The entity and its facts as believed; no facts yet, or null if not on the roster." },
      { method: "GET", path: "/v1/entities/:id/brief", client: "brief", budget: "read", summary: "The page: current understanding, rendered through a lens." },
      { method: "GET", path: "/v1/entities/:id/gaps", client: "gaps", budget: "read", summary: "Missing understanding: the lens's unmet needs, most valuable first." },
      { method: "GET", path: "/v1/entities/:id/readiness", client: "readiness", budget: "read", summary: "Current understanding per dimension, each need's standing, and the next directions." },
      { method: "DELETE", path: "/v1/entities/:id", client: "deleteEntity", budget: "write", summary: "Delete an entity and the episodes about it." },
    ],
  },
  {
    title: "Episodes",
    blurb: "What was said. Facts are derived from episodes and can be rebuilt from them.",
    routes: [
      { method: "POST", path: "/v1/episodes", client: "addEpisode", budget: "write", summary: "Record an episode. Idempotent on its source ref." },
      { method: "GET", path: "/v1/episodes", client: "episodes", budget: "search", summary: "The knower's episodes, newest first." },
      { method: "POST", path: "/v1/episodes/hints", client: "hintEpisodes", budget: "write", summary: "Attach episodes to an entity, releasing any held for a hint." },
    ],
  },
  {
    title: "Extraction",
    blurb: "Episodes into dated facts: queue the sweep, or run it inline.",
    routes: [
      { method: "POST", path: "/v1/extract", client: "requestExtract", budget: "write", summary: "Queue the sweep." },
      { method: "POST", path: "/v1/extract/now", client: "extractNow", budget: "extractNow", summary: "Run the sweep now and return its outcome." },
    ],
  },
  {
    title: "Facts",
    blurb:
      "Facts are superseded, never edited, so what was known at any date stays readable.",
    routes: [
      { method: "GET", path: "/v1/facts/search", client: "searchFacts", budget: "search", summary: "Search the knower's facts." },
      { method: "GET", path: "/v1/facts/learned", client: "factsLearnedBy", budget: "read", summary: "What a given source taught, by source ref." },
      { method: "POST", path: "/v1/facts/:id/invalidate", client: "invalidateFact", budget: "write", summary: "End a fact's validity as of a date." },
    ],
  },
  {
    title: "Proposals",
    blurb: "Field values and new names the engine proposes rather than writes.",
    routes: [
      { method: "GET", path: "/v1/proposals", client: "listProposals", budget: "read", summary: "Pending proposals." },
      { method: "POST", path: "/v1/proposals/:id/resolve", client: "resolveProposal", budget: "write", summary: "Accept or reject a proposal." },
    ],
  },
  {
    title: "The knower",
    blurb: "One knower's whole record.",
    routes: [
      { method: "GET", path: "/v1/subject/export", client: "exportSubject", budget: "export", summary: "Every episode held for this knower, dated." },
      { method: "DELETE", path: "/v1/subject", client: "deleteSubject", budget: "export", summary: "Erase the knower in this scope." },
      { method: "POST", path: "/v1/subject/reset", client: "resetForReplay", budget: "write", summary: "Drop derived facts, keep episodes, so extraction can be replayed." },
    ],
  },
  {
    title: "Stateless mode",
    blurb: "One call, nothing stored.",
    routes: [
      { method: "POST", path: "/v1/stateless/extract", client: "extract", budget: "stateless", summary: "Send an episode and the facts you hold; get a reconciliation plan." },
    ],
  },
  {
    title: "Usage",
    blurb: "What the engine cost.",
    routes: [
      { method: "GET", path: "/v1/usage", client: null, budget: null, summary: "Model calls made for this client, and their cost." },
    ],
  },
];

export const ALL_ROUTES: Route[] = ROUTE_GROUPS.flatMap((group) => group.routes);

/** The client methods this table accounts for. */
export const DOCUMENTED_METHODS: string[] = ALL_ROUTES.map((r) => r.client).filter((c): c is string => c !== null);

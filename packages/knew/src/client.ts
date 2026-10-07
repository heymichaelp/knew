import type {
  AddEpisodeResult,
  Brief,
  EntityView,
  Episode,
  ExtractNowOutcome,
  Fact,
  Gap,
  Intelligence,
  IntelligenceScope,
  Proposal,
  Readiness,
  ReconciliationPlan,
  StatelessExtraction,
  StatelessExtractRequest,
  StatelessIntelligence,
  SubjectExport,
} from "./types.ts";

/**
 * The HTTP driver: the contract, one route per method, against the
 * intelligence service. A client binds it once with its service key; every
 * hosted call names the knower in a header, so the key alone never reaches
 * anybody's notebook.
 *
 * Timeouts are per method and deliberately short for reads a caller makes
 * inside its own transaction; a failure is thrown as
 * `IntelligenceClientError` and the caller decides what "unavailable" means
 * for its feature — usually "answer from what was known".
 */

export class IntelligenceClientError extends Error {
  readonly status: number;
  readonly code: string | null;
  constructor(status: number, message: string, code: string | null = null) {
    super(message);
    this.name = "IntelligenceClientError";
    this.status = status;
    this.code = code;
  }
}

export interface IntelligenceClientOptions {
  baseUrl: string;
  serviceKey: string;
  fetch?: typeof fetch;
  /** Per-call bounds, in ms. Defaults suit a caller holding a lock. */
  timeouts?: Partial<{
    read: number;
    write: number;
    search: number;
    export: number;
    extractNow: number;
    stateless: number;
  }>;
}

export const SUBJECT_HEADER = "x-intelligence-subject";

/** The timeout budget each call falls under, in milliseconds. Override any of them via `timeouts`. */
export const DEFAULT_TIMEOUTS = { read: 1_500, write: 5_000, search: 3_000, export: 10_000, extractNow: 60_000, stateless: 120_000 };

type Json = Record<string, unknown>;

const date = (value: unknown): Date | null => (typeof value === "string" ? new Date(value) : null);
const dateRequired = (value: unknown): Date => new Date(String(value));

function reviveFact(raw: Json): Fact {
  return {
    id: String(raw.id),
    entityId: String(raw.entityId),
    objectId: (raw.objectId as string | null) ?? null,
    type: String(raw.type),
    fact: String(raw.fact),
    attributes: (raw.attributes as Record<string, unknown>) ?? {},
    validAt: date(raw.validAt),
    invalidAt: date(raw.invalidAt),
    createdAt: dateRequired(raw.createdAt),
    lastSaidAt: date(raw.lastSaidAt),
    expiredAt: date(raw.expiredAt),
    supersededById: (raw.supersededById as string | null) ?? null,
    episodeIds: (raw.episodeIds as string[]) ?? [],
  };
}

function reviveEpisode(raw: Json): Episode {
  return {
    id: String(raw.id),
    source: String(raw.source),
    sourceRef: (raw.sourceRef as string | null) ?? null,
    content: String(raw.content),
    inReplyTo: (raw.inReplyTo as string | null) ?? null,
    entityHints: (raw.entityHints as string[]) ?? [],
    referenceAt: dateRequired(raw.referenceAt),
    ingestedAt: date(raw.ingestedAt),
  };
}

function reviveProposal(raw: Json): Proposal {
  return {
    id: String(raw.id),
    episodeId: String(raw.episodeId),
    kind: raw.kind as Proposal["kind"],
    name: (raw.name as string | null) ?? null,
    entityId: (raw.entityId as string | null) ?? null,
    field: (raw.field as string | null) ?? null,
    value: (raw.value as string | null) ?? null,
    status: raw.status as Proposal["status"],
    createdAt: dateRequired(raw.createdAt),
    resolvedAt: date(raw.resolvedAt),
  };
}

function reviveBrief(raw: Json | null | undefined): Brief | null {
  if (!raw) return null;
  return {
    text: String(raw.text),
    mustHonor: (raw.mustHonor as Brief["mustHonor"]) ?? [],
    gaps: (raw.gaps as Gap[]) ?? [],
  };
}

function reviveEntity(raw: Json): EntityView {
  const brief = raw.brief as Json | null | undefined;
  return {
    id: String(raw.id),
    kind: String(raw.kind),
    name: String(raw.name),
    aliases: (raw.aliases as string[]) ?? [],
    summary: String(raw.summary ?? ""),
    summaryUpdatedAt: date(raw.summaryUpdatedAt),
    facts: ((raw.facts as Json[]) ?? []).map(reviveFact),
    ...(brief === undefined ? {} : { brief: reviveBrief(brief) }),
  };
}

/** A readiness as the service wrote it to JSON, with its dates back. */
export function reviveReadiness(raw: Json): Readiness {
  return {
    lens: String(raw.lens),
    objective: (raw.objective as string | null) ?? null,
    at: dateRequired(raw.at),
    overall: (raw.overall as number | null) ?? null,
    dimensions: ((raw.dimensions as Json[]) ?? []).map((d) => ({
      id: String(d.id),
      label: String(d.label),
      facts: Number(d.facts),
      due: Number(d.due),
      lastSaidAt: date(d.lastSaidAt),
      factIds: (d.factIds as string[]) ?? [],
    })),
    needs: (raw.needs as Readiness["needs"]) ?? [],
    next: (raw.next as Readiness["next"]) ?? [],
  };
}

/** A plan as the service wrote it to JSON, with its dates back. Exported for a
 *  client whose own API relays the service's answer verbatim. */
export function revivePlan(raw: Json): ReconciliationPlan {
  const newFact = (f: Json) => ({
    type: String(f.type),
    fact: String(f.fact),
    attributes: (f.attributes as Record<string, unknown>) ?? {},
    validAt: date(f.validAt),
    invalidAt: date(f.invalidAt),
  });
  return {
    entityId: String(raw.entityId),
    adds: ((raw.adds as Json[]) ?? []).map(newFact),
    merges: (raw.merges as Array<{ factId: string }>) ?? [],
    supersessions: ((raw.supersessions as Json[]) ?? []).map((s) => ({
      factId: String(s.factId),
      replacement: newFact(s.replacement as Json),
      invalidAt: date(s.invalidAt),
    })),
    retractions: ((raw.retractions as Json[]) ?? []).map((r) => ({ factId: String(r.factId), invalidAt: date(r.invalidAt) })),
    dropped: Number(raw.dropped ?? 0),
    unknownFactIds: (raw.unknownFactIds as string[]) ?? [],
    summary: (raw.summary as string | null) ?? null,
    summaryVersion: String(raw.summaryVersion),
    knownAt: dateRequired(raw.knownAt),
    aliases: (raw.aliases as string[]) ?? [],
  };
}

export function intelligenceClient(options: IntelligenceClientOptions): Intelligence & StatelessIntelligence {
  const doFetch = options.fetch ?? fetch;
  const timeouts = { ...DEFAULT_TIMEOUTS, ...(options.timeouts ?? {}) };
  const base = options.baseUrl.replace(/\/+$/, "");

  async function call<T>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    init: { scope?: IntelligenceScope; body?: unknown; timeoutMs: number; query?: Record<string, string | undefined> },
  ): Promise<T> {
    const url = new URL(`${base}/v1${path}`);
    for (const [key, value] of Object.entries(init.query ?? {})) if (value !== undefined) url.searchParams.set(key, value);
    const headers: Record<string, string> = { authorization: `Bearer ${options.serviceKey}`, accept: "application/json" };
    if (init.scope) headers[SUBJECT_HEADER] = init.scope.subjectId;
    if (init.body !== undefined) headers["content-type"] = "application/json";
    let response: Response;
    try {
      response = await doFetch(url, {
        method,
        headers,
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
        signal: AbortSignal.timeout(init.timeoutMs),
      });
    } catch (error) {
      throw new IntelligenceClientError(0, error instanceof Error ? error.name : "fetch failed", "unreachable");
    }
    const text = await response.text();
    let parsed: { data?: unknown; error?: { message?: string; code?: string } } = {};
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = {};
    }
    if (!response.ok) {
      throw new IntelligenceClientError(
        response.status,
        parsed.error?.message ?? `the intelligence service answered ${response.status}`,
        parsed.error?.code ?? null,
      );
    }
    return parsed.data as T;
  }

  const q = (scope: IntelligenceScope, extra: Record<string, string | undefined> = {}) => ({ scope, query: extra });
  const entity = (id: string) => `/entities/${encodeURIComponent(id)}`;

  return {
    async upsertEntity(scope, input) {
      await call("PUT", entity(input.id), {
        scope,
        body: { name: input.name, kind: input.kind, fields: input.fields, active: input.active },
        timeoutMs: timeouts.write,
      });
    },
    async deleteEntity(scope, entityId) {
      return call("DELETE", entity(entityId), { scope, timeoutMs: timeouts.write });
    },
    async addEpisode(scope, input) {
      return call<AddEpisodeResult>("POST", "/episodes", {
        scope,
        body: { ...input, referenceAt: input.referenceAt?.toISOString() },
        timeoutMs: timeouts.write,
      });
    },
    async hintEpisodes(scope, input) {
      return call("POST", "/episodes/hints", { scope, body: input, timeoutMs: timeouts.write });
    },
    async requestExtract(scope) {
      await call("POST", "/extract", { scope, body: {}, timeoutMs: timeouts.write });
    },
    async extractNow(scope, extractOptions) {
      return call<ExtractNowOutcome>("POST", "/extract/now", {
        scope,
        body: extractOptions,
        timeoutMs: timeouts.extractNow + (extractOptions.deadlineMs ?? 0),
      });
    },
    async getEntity(scope, entityId, readOptions = {}) {
      const raw = await call<Json | null>("GET", entity(entityId), {
        ...q(scope, {
          asOf: readOptions.asOf?.toISOString(),
          include: readOptions.includeBrief ? "brief" : undefined,
          lens: readOptions.lens,
          maxChars: readOptions.maxChars?.toString(),
        }),
        timeoutMs: timeouts.read,
      });
      return raw ? reviveEntity(raw) : null;
    },
    async brief(scope, entityId, briefOptions = {}) {
      const raw = await call<Json | null>("GET", `${entity(entityId)}/brief`, {
        ...q(scope, { lens: briefOptions.lens, asOf: briefOptions.asOf?.toISOString(), maxChars: briefOptions.maxChars?.toString() }),
        timeoutMs: timeouts.read,
      });
      return reviveBrief(raw);
    },
    async gaps(scope, entityId, readOptions = {}) {
      return call<Gap[] | null>("GET", `${entity(entityId)}/gaps`, {
        ...q(scope, { lens: readOptions.lens, asOf: readOptions.asOf?.toISOString() }),
        timeoutMs: timeouts.read,
      });
    },
    async readiness(scope, entityId, readOptions = {}) {
      const raw = await call<Json | null>("GET", `${entity(entityId)}/readiness`, {
        ...q(scope, { lens: readOptions.lens, asOf: readOptions.asOf?.toISOString() }),
        timeoutMs: timeouts.read,
      });
      return raw ? reviveReadiness(raw) : null;
    },
    async searchFacts(scope, query, searchOptions = {}) {
      const raw = await call<Json[]>("GET", "/facts/search", {
        ...q(scope, {
          q: query,
          entityId: searchOptions.entityId,
          types: searchOptions.types?.join(","),
          asOf: searchOptions.asOf?.toISOString(),
          limit: searchOptions.limit?.toString(),
        }),
        timeoutMs: timeouts.search,
      });
      return raw.map(reviveFact);
    },
    async factsLearnedBy(scope, sourceRefs) {
      if (sourceRefs.length === 0) return {};
      return call("GET", "/facts/learned", { ...q(scope, { sourceRefs: sourceRefs.join(",") }), timeoutMs: timeouts.read });
    },
    async invalidateFact(scope, factId, invalidateOptions = {}) {
      await call("POST", `/facts/${encodeURIComponent(factId)}/invalidate`, {
        scope,
        body: { at: invalidateOptions.at?.toISOString() },
        timeoutMs: timeouts.write,
      });
    },
    async episodes(scope, listOptions = {}) {
      const raw = await call<Json[]>("GET", "/episodes", {
        ...q(scope, {
          entityId: listOptions.entityId,
          sourceRefs: listOptions.sourceRefs?.join(","),
          before: listOptions.before?.toISOString(),
          limit: listOptions.limit?.toString(),
        }),
        timeoutMs: timeouts.search,
      });
      return raw.map(reviveEpisode);
    },
    async listProposals(scope, listOptions = {}) {
      const raw = await call<Json[]>("GET", "/proposals", {
        ...q(scope, { entityId: listOptions.entityId, status: listOptions.status }),
        timeoutMs: timeouts.read,
      });
      return raw.map(reviveProposal);
    },
    async resolveProposal(scope, proposalId, resolution) {
      await call("POST", `/proposals/${encodeURIComponent(proposalId)}/resolve`, { scope, body: { resolution }, timeoutMs: timeouts.write });
    },
    async exportSubject(scope) {
      const raw = await call<{ episodes: Json[] }>("GET", "/subject/export", { scope, timeoutMs: timeouts.export });
      return {
        episodes: raw.episodes.map((e) => ({
          source: String(e.source),
          said: String(e.said),
          saidAt: dateRequired(e.saidAt),
          inReplyTo: (e.inReplyTo as string | null) ?? null,
        })),
      } satisfies SubjectExport;
    },
    async deleteSubject(scope) {
      await call("DELETE", "/subject", { scope, timeoutMs: timeouts.export });
    },
    async resetForReplay(scope) {
      return call("POST", "/subject/reset", { scope, body: {}, timeoutMs: timeouts.write });
    },
    async extract(request: StatelessExtractRequest) {
      const raw = await call<Json>("POST", "/stateless/extract", {
        body: { ...request, episode: { ...request.episode, referenceAt: request.episode.referenceAt.toISOString() } },
        timeoutMs: timeouts.stateless,
      });
      return {
        plans: ((raw.plans as Json[]) ?? []).map(revivePlan),
        unresolvedNames: (raw.unresolvedNames as string[]) ?? [],
        fieldUpdates: (raw.fieldUpdates as StatelessExtraction["fieldUpdates"]) ?? [],
        offRoster: Number(raw.offRoster ?? 0),
        droppedForCap: Number(raw.droppedForCap ?? 0),
        calls: (raw.calls as StatelessExtraction["calls"]) ?? [],
        promptVersions: raw.promptVersions as StatelessExtraction["promptVersions"],
      };
    },
  };
}

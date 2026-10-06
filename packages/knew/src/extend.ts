import { parseLensDefinition, type AskSpec, type LensDefinition, type SectionSpec } from "./lens.ts";
import { parseVocabularyDefinition, type DimensionSpec, type FactTypeSpec, type VocabularyDefinition } from "./vocabulary.ts";

/**
 * Defaults, then overrides. A client starts from a preset (or any definition
 * of its own) and says only what differs; the result is a complete
 * definition, validated, that the service stores like any other. Extension
 * happens where the definition is written, so the service never needs to know
 * a preset existed.
 *
 * The rules are the same at every level: a key given replaces or merges, a key
 * given as `null` removes, and a key left out keeps the base's value.
 */

/** A partial spec, where `null` on an optional key removes it. */
type Patch<T> = { [K in keyof T]?: T[K] | null };

export interface VocabularyOverrides {
  /** The new vocabulary's own name and version: an extension is a vocabulary
   *  of the client's, not the preset's. */
  id: string;
  version: number;
  /** By type key: a patch merged into the base type, a complete spec for a
   *  new one, or `null` to drop it. */
  factTypes?: Record<string, Patch<FactTypeSpec> | null>;
  /** By dimension id, the same way. */
  dimensions?: Record<string, Patch<DimensionSpec> | null>;
  fallbackType?: string;
  fields?: string[];
  promptFields?: string[] | null;
  charter?: string;
  sourceLabels?: Record<string, string> | null;
  prompts?: { extract?: string; reconcile?: string } | null;
  extractAttributeKeys?: string[] | null;
}

function merge<T extends object>(base: T | undefined, patch: Patch<T>): T {
  const merged: Record<string, unknown> = { ...(base ?? {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete merged[key];
    else if (value !== undefined) merged[key] = value;
  }
  return merged as T;
}

/** A spec as a comparison sees it: keys sorted, and a false flag the same as
 *  no flag, since the engine reads them alike. */
function normalised(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) => {
    if (inner === null || typeof inner !== "object" || Array.isArray(inner)) return inner;
    return Object.fromEntries(
      Object.entries(inner as Record<string, unknown>)
        .filter(([, field]) => field !== false && field !== undefined)
        .sort(([a], [b]) => a.localeCompare(b)),
    );
  });
}

/**
 * Merge by key, keeping the lineage honest: a key the base had and this patch
 * changes or drops is `changed`, unless an earlier extension `added` it — then
 * it was never the preset's, and a change to it is the client's own business.
 */
function mergeRecord<T extends object>(
  base: Record<string, T>,
  patches: Record<string, Patch<T> | null> | undefined,
  lineage: { changed: Set<string>; added: Set<string> },
): Record<string, T> {
  const merged: Record<string, T> = { ...base };
  for (const [key, patch] of Object.entries(patches ?? {})) {
    const own = lineage.added.has(key);
    if (patch === null) {
      if (key in merged) {
        if (own) lineage.added.delete(key);
        else lineage.changed.add(key);
      }
      delete merged[key];
      continue;
    }
    const next = merge(merged[key], patch);
    if (!(key in base)) lineage.added.add(key);
    else if (!own && normalised(next) !== normalised(base[key])) lineage.changed.add(key);
    merged[key] = next;
  }
  return merged;
}

function replace<T>(target: Record<string, unknown>, key: string, value: T | null | undefined): void {
  if (value === null) delete target[key];
  else if (value !== undefined) target[key] = value;
}

/**
 * A vocabulary of the client's own, from a base. The result is stamped
 * `basedOn`: the first base it came from — a preset, or a client's own
 * vocabulary — carried through an extension of an extension; every type or
 * dimension of that base it `changed` or dropped; and every one it `added`.
 * So a fact typed in a type left alone still means what the base meant by it.
 * Throws, naming every problem, when the result is not a vocabulary — a
 * dimension dropped that a type still informs, say.
 */
export function extendVocabulary(base: VocabularyDefinition, overrides: VocabularyOverrides): VocabularyDefinition {
  const lineage = { changed: new Set<string>(base.basedOn?.changed ?? []), added: new Set<string>(base.basedOn?.added ?? []) };
  const result: Record<string, unknown> = { ...base };
  result.id = overrides.id;
  result.version = overrides.version;
  result.factTypes = mergeRecord(base.factTypes, overrides.factTypes, lineage);
  result.dimensions = mergeRecord(base.dimensions, overrides.dimensions, lineage);
  replace(result, "fallbackType", overrides.fallbackType);
  replace(result, "fields", overrides.fields);
  replace(result, "promptFields", overrides.promptFields);
  replace(result, "charter", overrides.charter);
  replace(result, "sourceLabels", overrides.sourceLabels);
  replace(result, "prompts", overrides.prompts);
  replace(result, "extractAttributeKeys", overrides.extractAttributeKeys);
  result.basedOn = {
    preset: base.basedOn?.preset ?? base.id,
    version: base.basedOn?.version ?? base.version,
    changed: [...lineage.changed].sort(),
    added: [...lineage.added].sort(),
  };
  return parseVocabularyDefinition(result);
}

export interface LensOverrides {
  /** The new lens's own name and version. */
  id: string;
  version: number;
  objective?: string | null;
  /** The vocabulary it reads — a lens extended from a preset's names the
   *  client's own vocabulary here. */
  vocabulary?: string;
  header?: string;
  overHeading?: string;
  /** Replaces the sections; `null` goes back to one per dimension. */
  sections?: SectionSpec[] | null;
  /** Replaces the pinned types; `null` goes back to the vocabulary's. */
  pinned?: string[] | null;
  attributeTags?: string[] | null;
  /** By ask id: a patch merged into the base ask, a complete ask appended
   *  after the base's, or `null` to drop it. */
  asks?: Record<string, Patch<Omit<AskSpec, "id">> | null>;
}

/** The asks a lens that names none asks: one per dimension with a question. */
function defaultAsks(vocabulary: VocabularyDefinition): AskSpec[] {
  return Object.entries(vocabulary.dimensions)
    .filter(([, dimension]) => dimension.question !== undefined)
    .map(([id]) => ({ id, dimension: id }));
}

/**
 * A lens of the client's own, from a base: a preset's starter lens, or
 * another of the client's. Throws when the result is not a lens; references
 * into the vocabulary are checked when it is compiled against one.
 *
 * A base that names no asks asks its vocabulary's dimension questions. To
 * patch those by id, pass the vocabulary it reads, and they are written out
 * first; without it, `asks` overrides are refused rather than guessed at.
 */
export function extendLens(base: LensDefinition, overrides: LensOverrides, vocabulary?: VocabularyDefinition): LensDefinition {
  const result: Record<string, unknown> = { ...base };
  result.id = overrides.id;
  result.version = overrides.version;
  replace(result, "objective", overrides.objective);
  replace(result, "vocabulary", overrides.vocabulary);
  replace(result, "header", overrides.header);
  replace(result, "overHeading", overrides.overHeading);
  replace(result, "sections", overrides.sections);
  replace(result, "pinned", overrides.pinned);
  replace(result, "attributeTags", overrides.attributeTags);
  if (overrides.asks) {
    let asks: AskSpec[];
    if (base.asks) asks = base.asks.map((ask) => ({ ...ask }));
    else {
      const reads = (overrides.vocabulary ?? base.vocabulary) as string;
      if (!vocabulary) {
        throw new Error(
          `lens ${base.id} asks its vocabulary's dimension questions rather than naming asks, so they can only be patched by id ` +
            `with that vocabulary in hand: pass ${reads} as the third argument`,
        );
      }
      if (vocabulary.id !== reads) throw new Error(`the extended lens reads vocabulary ${reads}, and was given ${vocabulary.id}`);
      asks = defaultAsks(vocabulary);
    }
    for (const [id, patch] of Object.entries(overrides.asks)) {
      const at = asks.findIndex((ask) => ask.id === id);
      if (patch === null) {
        if (at >= 0) asks.splice(at, 1);
        continue;
      }
      if (at >= 0) asks[at] = merge(asks[at], patch as Patch<AskSpec>);
      else asks.push(merge<AskSpec>({ id } as AskSpec, patch as Patch<AskSpec>));
    }
    result.asks = asks;
  }
  return parseLensDefinition(result);
}

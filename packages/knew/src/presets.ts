/**
 * Presets: starter vocabularies and lenses, one kind each, for a client to
 * extend rather than write from nothing — `@popjoker/knew/presets`, and only
 * when a client imports it. The core engine names no domain; a preset is the
 * one place in this package with content, so each is generic: no product's
 * wording, no product's taxonomy.
 *
 *     import { person } from "@popjoker/knew/presets";
 *     const vocabulary = extendVocabulary(person.vocabulary(), { id: "mine", version: 1, … });
 */
export * as person from "./presets/person.ts";
export * as place from "./presets/place.ts";
export * as product from "./presets/product.ts";

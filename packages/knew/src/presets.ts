/**
 * Presets: starter vocabularies and lenses, one kind each, for a client to
 * extend rather than write from nothing — `@popjoker/knew/presets`, and only
 * when a client imports it. The core engine names no domain; a preset is the
 * one place in this package with content, so each is generic (no product's
 * wording, no product's taxonomy), versioned, and reviewed like API: an
 * addition is a minor release, and a change to what an existing type means
 * bumps the preset's version and is a major.
 *
 *     import { person } from "@popjoker/knew/presets";
 *     const vocabulary = extendVocabulary(person.vocabulary(), { id: "mine", version: 1, … });
 */
export * as person from "./presets/person.ts";
export * as place from "./presets/place.ts";
export * as product from "./presets/product.ts";

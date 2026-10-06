/**
 * The shapes a definition's names take. Internal: the schemas that use them
 * are the public face, and an error names the pattern that refused a value.
 */

/** A vocabulary, a lens or a kind: `relationships`, `know-them`, `person`. */
export const ID_RE = /^[a-z][a-z0-9-]{1,31}$/;

/** A dimension or an ask: `what-they-love`. A dimension's id doubles as the
 *  id of the ask a lens derives from it, so the two share a pattern. */
export const KEY_RE = /^[a-z][a-z0-9-]{1,63}$/;

/** A fact type: `SKILL`, `LIFE_EVENT`. */
export const TYPE_KEY_RE = /^[A-Z][A-Z0-9_]{1,31}$/;

/** A field an entity carries, or an attribute a type carries: `relationship`. */
export const FIELD_RE = /^[a-z][a-z0-9_]{0,31}$/;

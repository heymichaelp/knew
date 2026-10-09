/**
 * Small helpers that run the same in Node, a browser and React Native (Hermes),
 * which lacks `AbortSignal.timeout` and `AbortSignal.any`. The engine's
 * in-process parts use these and nothing Node-only (`test/portable.test.ts`).
 */

/** A signal that aborts after `ms`, or when `parent` does: whichever comes first. */
export function deadlineSignal(ms: number | null, parent?: AbortSignal): { signal: AbortSignal; release: () => void } {
  const controller = new AbortController();
  const abort = () => controller.abort(parent?.reason ?? new Error(`timed out after ${ms} ms`));
  const timer = ms === null ? null : setTimeout(() => controller.abort(new Error(`timed out after ${ms} ms`)), Math.max(1, ms));
  if (parent?.aborted) abort();
  else parent?.addEventListener("abort", abort, { once: true });
  return {
    signal: controller.signal,
    release() {
      if (timer !== null) clearTimeout(timer);
      parent?.removeEventListener("abort", abort);
    },
  };
}

/** A random v4 UUID: the platform's when it has one, otherwise from `Math.random`. */
export function randomId(): string {
  const platform = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (typeof platform?.randomUUID === "function") return platform.randomUUID();
  const hex = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${"89ab"[Math.floor(Math.random() * 4)]}${hex(3)}-${hex(12)}`;
}

import type { Model } from "./model.ts";

/**
 * The request is more than the model can take in: too long for its context
 * window. Thrown by an adapter before the call when it can tell, or when the
 * model says so. `fallbackModel` hands such a request to the next model.
 */
export class ModelContextError extends Error {
  constructor(
    message: string,
    public readonly tokens: number | null = null,
    public readonly limit: number | null = null,
  ) {
    super(message);
    this.name = "ModelContextError";
  }
}

/**
 * The model cannot answer here at all: not on this device, switched off, not
 * downloaded yet. `fallbackModel` hands the request on.
 */
export class ModelUnavailableError extends Error {
  constructor(
    message: string,
    public readonly reason: string | null = null,
  ) {
    super(message);
    this.name = "ModelUnavailableError";
  }
}

/** By default a request falls through when the first model cannot take it in or is not there; any other failure is the first model's to report. */
export const fallsThrough = (error: unknown): boolean => error instanceof ModelContextError || error instanceof ModelUnavailableError;

/**
 * The first model when it can, the second when it cannot: on the device
 * first, the app's own key when a note does not fit. Opt-in: an app that
 * wants nothing to leave the device passes the on-device model alone. The
 * answer names which model gave it, so `calls` records where each note went.
 */
export function fallbackModel(primary: Model, fallback: Model, options: { when?: (error: unknown) => boolean } = {}): Model {
  const when = options.when ?? fallsThrough;
  return async (request) => {
    try {
      return await primary(request);
    } catch (error) {
      if (!when(error)) throw error;
      return fallback(request);
    }
  };
}

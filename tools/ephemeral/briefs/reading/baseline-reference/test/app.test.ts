import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createApp } from "../src/app.ts";

const DAY_MS = 86_400_000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS);

/** A stand-in model that answers each request with the next queued reading, and keeps the prompts it was shown. */
function stand() {
  const queue: unknown[] = [];
  const prompts: string[] = [];
  const model = async (request: { prompt: string }) => {
    prompts.push(request.prompt);
    return queue.shift() ?? { statements: [] };
  };
  const statement = (placeId: string, topic: string, text: string, extra: { until?: string; replaces?: number; repeats?: number } = {}) => ({
    placeId,
    topic,
    text,
    until: extra.until ?? null,
    replaces: extra.replaces ?? null,
    repeats: extra.repeats ?? null,
  });
  return { app: createApp({ model }), queue, prompts, statement };
}

describe("Haunts reading its own notes", () => {
  it("knows nothing of a place never added, and drops what a note says about one", async () => {
    const { app, queue, statement } = stand();
    assert.equal(await app.known("ana", "luna"), null);
    await app.addPlace("ana", { id: "luna", name: "Café Luna" });
    queue.push({ statements: [statement("luna", "KIND", "A café"), statement("corner", "KIND", "A record shop")] });
    await app.addNote("ana", "luna", "Luna's a café; the corner shop sells records.");
    await app.addPlace("ana", { id: "corner", name: "Corner Records" });
    assert.deepEqual(await app.known("ana", "luna"), [{ topic: "KIND", text: "A café" }]);
    assert.deepEqual(await app.known("ana", "corner"), []);
  });

  it("shows the model what is held, applies a correction as of when it was said, and keeps a repeat once", async () => {
    const { app, queue, prompts, statement } = stand();
    await app.addPlace("ana", { id: "nine", name: "Bar Nine" });
    queue.push({ statements: [statement("nine", "HOURS", "Open 8 till 6")] });
    await app.addNote("ana", "nine", "Open 8 till 6.", { at: daysAgo(20) });
    queue.push({ statements: [statement("nine", "HOURS", "Opens at 10", { replaces: 0 })] });
    await app.addNote("ana", "nine", "It opens at 10 now.", { at: daysAgo(5) });
    assert.match(prompts[1]!, /0 \| nine \| HOURS \| Open 8 till 6/);
    queue.push({ statements: [statement("nine", "HOURS", "Opens at ten", { repeats: 0 })] });
    await app.addNote("ana", "nine", "Still opens at ten.", { at: daysAgo(1) });
    assert.deepEqual(await app.known("ana", "nine"), [{ topic: "HOURS", text: "Opens at 10" }]);
    assert.deepEqual(await app.known("ana", "nine", { asOf: daysAgo(10) }), [{ topic: "HOURS", text: "Open 8 till 6" }]);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createApp, type Statement } from "../src/app.ts";

const DAY_MS = 86_400_000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS);

/** A reader that answers each note with the statements queued for it. */
function haunts() {
  const queue: Statement[][] = [];
  const app = createApp({ read: async () => queue.shift() ?? [] });
  const says = (...statements: Array<Partial<Statement> & Pick<Statement, "placeId" | "topic" | "text">>) =>
    queue.push(statements.map((statement) => ({ until: null, replaces: null, repeats: null, ...statement })));
  return { app, says };
}

describe("Haunts on its own store", () => {
  it("starts with what kind of place it is, and knows nothing of a place never added", async () => {
    const { app } = haunts();
    assert.equal(await app.known("ana", "luna"), null);
    await app.addPlace("ana", { id: "luna", name: "Café Luna" });
    assert.deepEqual(await app.nextToLearn("ana", "luna"), { about: "What kind of place it is", recheck: [] });
  });

  it("keeps a correction's history, and asks to re-check hours gone quiet", async () => {
    const { app, says } = haunts();
    await app.addPlace("ana", { id: "nine", name: "Bar Nine" });
    says({ placeId: "nine", topic: "HOURS", text: "Open 8 to 6" });
    await app.addNote("ana", "nine", "Open eight till six.", { at: daysAgo(60) });
    says(
      { placeId: "nine", topic: "HOURS", text: "Opens at 10 now", replaces: "Open 8 to 6" },
      { placeId: "nine", topic: "KIND", text: "A bar" },
      { placeId: "nine", topic: "VIBE", text: "Loud" },
      { placeId: "nine", topic: "ORDER", text: "Negroni" },
    );
    await app.addNote("ana", "nine", "Opens at ten now. A loud bar; get the negroni.", { at: daysAgo(40) });
    assert.deepEqual((await app.known("ana", "nine"))?.sort(), ["A bar", "Loud", "Negroni", "Opens at 10 now"]);
    assert.deepEqual(await app.known("ana", "nine", { asOf: daysAgo(50) }), ["Open 8 to 6"]);
    assert.deepEqual(await app.nextToLearn("ana", "nine"), { about: "When it is open", recheck: ["Opens at 10 now"] });
  });

  it("keeps a repeat once, and drops what a note says about a place nobody added", async () => {
    const { app, says } = haunts();
    await app.addPlace("ana", { id: "luna", name: "Café Luna" });
    says({ placeId: "luna", topic: "KIND", text: "A café" }, { placeId: "corner", topic: "KIND", text: "A record shop" });
    await app.addNote("ana", "luna", "Luna's a café; the corner place sells records.");
    says({ placeId: "luna", topic: "KIND", text: "A café", repeats: "A café" });
    await app.addNote("ana", "luna", "Still a café.");
    await app.addPlace("ana", { id: "corner", name: "Corner Records" });
    assert.deepEqual(await app.known("ana", "luna"), ["A café"]);
    assert.deepEqual(await app.known("ana", "corner"), []);
  });

  it("plans tonight from the hours, what it's like and the price, and asks the price last on a visit", async () => {
    const { app, says } = haunts();
    await app.addPlace("ana", { id: "luna", name: "Café Luna" });
    assert.deepEqual(await app.nextTonight("ana", "luna"), { about: "When it is open", recheck: [] });
    says({ placeId: "luna", topic: "HOURS", text: "Open 8 to 6" }, { placeId: "luna", topic: "VIBE", text: "Quiet" });
    await app.addNote("ana", "luna", "Open eight till six, and quiet.");
    assert.deepEqual(await app.nextTonight("ana", "luna"), { about: "How much it costs", recheck: [] });
    says({ placeId: "luna", topic: "KIND", text: "A café" }, { placeId: "luna", topic: "ORDER", text: "The cardamom bun" });
    await app.addNote("ana", "luna", "A café; get the cardamom bun.");
    assert.deepEqual(await app.nextToLearn("ana", "luna"), { about: "How much it costs", recheck: [] });
  });
});

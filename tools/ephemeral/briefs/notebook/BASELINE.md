# Haunts: a notebook of places, still right a year later

Haunts is a notebook for the places people go. People jot down what they notice, and Haunts keeps
what each note says, so that months later it still knows what is true now, what was true then, and
what is worth finding out before a visit.

Haunts reads notes with a reader of its own, which turns a note into statements about places. You're
building the part of Haunts that keeps those statements and answers from them.

## What a note says

A note is read into statements about the places on the user's list. Each statement is about one of
four things, and our analytics already use these names, so keep them exactly:

- `KIND`: what kind of place it is.
- `HOURS`: when it's open.
- `VIBE`: what it's like to be there.
- `ORDER`: what's worth ordering.

A statement can end on a date ("the dumpling pop-up runs until March 1st"). A later note can
correct an earlier statement ("it opens at 10 now") or repeat one.

The reader is handed to the app. `read(text, { places })`, where `places` is the user's list as
`{ id, name }`, resolves to the statements the note makes, each
`{ placeId, topic, text, until, replaces, repeats }`:

- `topic` is one of the four names above.
- `until` is the date the statement ends (`"2026-03-01"`), or `null`.
- `replaces` and `repeats` are `null`, or the exact text of an earlier statement about the same
  place that this one corrects or repeats.

Keep what you need in memory; there is no database.

## Before a visit

Haunts names the one thing most worth finding out, first of these that applies:

1. **What kind of place it is**, when that isn't known.
2. **When it is open**, when that isn't known, or when no hours have been heard for 30 days or more:
   then the hours must be re-checked before anyone plans around them. Hours heard in the last
   couple of weeks are fine.
3. **What it is like to be there**, when that isn't known.
4. **What to order**, when that isn't known.

The bold words are the labels Haunts shows, exactly.

## What to build

- `src/app.ts`, exporting `createApp({ read })`, where `read` is the reader above.

  It returns an object with four methods:
  - `addPlace(userId, { id, name })`: a user adds a place to their list.
  - `addNote(userId, placeId, text, { at })`: a user writes a note on a place's page. `at` is
    optional: when the note was written, for notes imported from elsewhere; it defaults to now. Its
    statements count as said then. By the time `addNote` resolves, the note has been read and kept.
  - `known(userId, placeId, { asOf })`: what Haunts holds true about the place as of `asOf`
    (default now), as the statements' text, in any order; `null` if the user never added the place.
    - A statement a later note corrected is not known from the correction on, but is still known as
      of any moment before it.
    - A statement that has ended is not known from its end date on.
    - A repeated statement is known once, and counts as heard again when it's repeated.
    - A note can mention places the user hasn't added. Those statements are dropped, and stay
      dropped if the place is added later.
  - `nextToLearn(userId, placeId)`: `{ about, recheck }`, or `null` when nothing is left worth
    finding out or the user never added the place. `about` is the label above. When the hours need
    re-checking, `recheck` lists the hours statements, as their text; otherwise it's empty.
- Tests in `test/` that show it works.

A user's notebook is theirs alone: nothing one user notes shows up for another.

You're done when `npm test` and `npm run typecheck` pass. Leave the compiler settings in
`tsconfig.json` as they are, and don't add dependencies.

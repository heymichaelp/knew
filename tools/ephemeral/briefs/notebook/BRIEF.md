# Haunts: a notebook of places, still right a year later

Haunts is a notebook for the places people go. People jot down what they notice, and Haunts keeps
what each note says, so that months later it still knows what is true now, what was true then, and
what is worth finding out before a visit.

Haunts is built on knew, the `@popjoker/knew` package, which is installed. knew reads each note
into what's known about the places on a user's list. You're building the part of Haunts that works
with it.

## What a note says

A note is read into statements about the places on the user's list. Each statement is about one of
four things, and our analytics already use these names, so keep them exactly:

- `KIND`: what kind of place it is.
- `HOURS`: when it's open.
- `VIBE`: what it's like to be there.
- `ORDER`: what's worth ordering.

A statement can end on a date ("the dumpling pop-up runs until March 1st"). A later note can
correct an earlier statement ("it opens at 10 now") or repeat one.

knew does the reading. The four kinds of statement are the kinds of fact in a vocabulary you write
for Haunts, called `notebook`, and the planning view below is a lens called `visit`.

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

- `definitions/vocabulary.json` and `definitions/lenses/visit.json`.
- `src/app.ts`, exporting `createApp(engine)`. `engine` is Haunts' connection to knew, made once at
  startup and handed in.

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

A user's notebook is theirs alone: nothing one user notes shows up for another. knew knows Haunts as the client `haunts`.

You're done when `npm test` and `npm run typecheck` pass. Leave the compiler settings in
`tsconfig.json` as they are, and don't add dependencies.

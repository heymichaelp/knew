# Haunts: notes on places, for planning a visit

Haunts is a notebook for the places people go: cafés, bars, bookshops, music venues, galleries.
People jot down what they notice ("Luna's a café with a reading room upstairs", "closed Mondays",
"too loud to work in after lunch"). When they plan a visit, Haunts tells them the one thing worth
finding out first.

Haunts is built on knew, the `@popjoker/knew` package, which is installed. knew turns notes into
what's known about each place and says what's still worth learning. You're building the part of
Haunts that works with it.

## What there is to know about a place

knew ships a starting vocabulary for places, but Haunts' notes don't fit it, so write Haunts' own
from scratch rather than extending knew's. Call it `places`. Haunts cares about at least three kinds of note. Our analytics already use their
names, so keep them exactly:

- `KIND`: what kind of place it is, such as a café, a wine bar or a record shop.
- `HOURS`: when it's open.
- `VIBE`: what it's like to be there: quiet or loud, good for working, good for a first date.

Add whatever else a visit planner needs, such as what to order or how busy it gets. That's your
call.

## Planning a visit

The planning view is a lens called `visit`. Its purpose is to help someone decide when to go and
know what to expect when they get there. It needs to know:

- **What kind of place it is.** Don't ask what a place is like before you know what kind of place
  it is. "Is it good for working?" means one thing for a library and another for a bar. As soon
  as the kind is known, what it's like is fair to ask.
- **When it's open.** Hours change. Re-check hours noted more than about a month ago before anyone
  plans around them. Hours noted in the last couple of weeks are fine.
- **What it's like.**

## What to build

- `definitions/vocabulary.json` and `definitions/lenses/visit.json`.
- `src/app.ts`, exporting `createApp(engine)`. `engine` is Haunts' connection to knew, made once at
  startup and handed in. `createApp` returns an object with three methods:
  - `addPlace(userId, { id, name })`: a user adds a place to their list. Adding it again with a
    new name renames it.
  - `addNote(userId, placeId, text, { at })`: a user writes a note on a place's page. `at` is
    optional. It's when the note was written, for notes imported from elsewhere, and it defaults
    to now. By the time `addNote` resolves, the note has been read, so the next question already
    takes it into account.
  - `nextQuestion(userId, placeId)`: the one thing worth finding out next before a visit, as
    `{ question, recheck }`.
    - `question` is worded exactly as the `visit` lens words it.
    - When the most useful thing is to re-check something already noted, `recheck` lists those
      notes, in the words knew used for what it took from them. Otherwise `recheck` is empty.
    - It returns `null` when there's nothing left worth finding out, or when the user never added
      the place.
- Tests in `test/` that show it works without a running knew service.

A user's notebook is theirs alone: nothing one user notes shows up for another. knew knows Haunts
as the client `haunts`.

You're done when `npm test` and `npm run typecheck` pass. Leave the compiler settings in
`tsconfig.json` as they are, and don't add dependencies.

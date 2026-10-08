# Haunts: a notebook of places that reads what people write

Haunts is a notebook for the places people go. People jot down notes in their own words ("Nine's
open 8 till 6", "Nine changed its hours, it opens at 10 now"), and Haunts works out what each note
says about the places on their list, and keeps it right as things change.

Haunts has a language model to read notes with. It's handed to the app as `model`:
`model({ system, prompt, schema })` sends one request and resolves to the model's answer as JSON
matching the JSON Schema you pass. Use it to read the notes; don't call any other model or
service. You're building the part of Haunts that reads notes and keeps what they say.

## What Haunts keeps

Statements about places, each about one of four things. Our analytics already use these names, so
keep them exactly:

- `KIND`: what kind of place it is.
- `HOURS`: when it's open.
- `VIBE`: what it's like to be there.
- `ORDER`: what's worth ordering.

Notes are casual, and reading them right is the job:

- A note can **correct** something said before ("it opens at 10 now"). The old statement stops
  being true from then on, but it was true before.
- A note can **repeat** something already known, in other words. It's still one statement.
- A note can **add** something new about a topic that's already known: "quiet before eight" next
  to "loud after ten". Both are true.
- A note can say **when something ends** ("a pop-up until the end of February").
- News about one thing doesn't change another: a café that starts serving wine is still a café.
- A note can mention places that aren't on the user's list. Ignore those, and don't bring them back
  if the place is added later.

## What to build

- `src/app.ts`, exporting `createApp({ model })`, where `model` is the language model above.

  It returns an object with three methods:
  - `addPlace(userId, { id, name })`: a user adds a place to their list.
  - `addNote(userId, placeId, text, { at })`: a user writes a note on a place's page. `at` is
    optional: when the note was written, for notes imported from elsewhere; it defaults to now. By
    the time `addNote` resolves, the note has been read and kept.
  - `known(userId, placeId, { asOf })`: what Haunts holds true about the place as of `asOf`
    (default now), as `{ topic, text }` statements, in any order; `null` if the user never added
    the place.
- Tests in `test/` that show it works without a real model: hand it a stand-in.

A user's notebook is theirs alone: nothing one user notes shows up for another.

You're done when `npm test` and `npm run typecheck` pass. Leave the compiler settings in
`tsconfig.json` as they are, and don't add dependencies.
